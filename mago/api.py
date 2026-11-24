"""The HTTP API the web interface talks to. Local only: bind it to 127.0.0.1.

Run with:  uvicorn mago.api:app --host 127.0.0.1 --port 8010
"""

import asyncio
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import zipfile
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, db, export, fetch, files, jobs, library, lists, meaning
from .links import UnsupportedLink, detect

config.ensure_dirs()
app = FastAPI(title="Mago", docs_url="/api/docs", openapi_url="/api/openapi.json")
# No accounts, so two cheap guards against a hostile web page open in the same browser:
# - only answer to our own host names (stops DNS rebinding);
# - writes need a custom header, which a cross-site page cannot send without a CORS
#   preflight that we never approve (stops cross-site form/fetch posts).
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])


@app.middleware("http")
async def require_mago_header(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-mago") != "1":
        return JSONResponse({"detail": "Missing X-Mago header."}, status_code=403)
    return await call_next(request)


for folder in ("thumbs", "avatars"):  # never the whole data directory: the database lives there
    app.mount(f"/media/{folder}", StaticFiles(directory=config.DATA_DIR / folder), name=folder)
app.mount("/media/files", StaticFiles(directory=files.media_dir()), name="files")  # the owner's own audio and video files

_preview_cache: dict[str, tuple[float, dict]] = {}
_VIDEO_LIST_COLUMNS = (
    "v.id, v.source_id, v.platform, v.platform_video_id, v.url, v.title, v.published_at, v.duration_s, v.view_count, "
    "v.thumb_path, v.thumb_blur, v.shape, v.language, v.status, v.error, v.method, v.progress, v.transcribed_at, v.duplicate_of, v.duplicate_kind"
)
_SORTS = {
    "newest": "v.published_at IS NULL, v.published_at DESC, v.id",
    "oldest": "v.published_at IS NULL, v.published_at, v.id DESC",
    "views": "v.view_count DESC, v.id",
    "longest": "v.duration_s DESC, v.id",
}
_STATUS_GROUPS = {
    "done": ("done",), "working": ("queued", "captions", "downloading", "transcribing"),
    "failed": ("failed", "skipped"), "listed": ("listed",),
}


def get_conn():
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


Conn = Depends(get_conn)


class UrlBody(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


class SettingsBody(BaseModel):
    whisper_model: Literal["tiny", "base", "small", "medium", "large-v3-turbo"] | None = None
    device: Literal["auto", "cuda", "cpu"] | None = None
    language: str | None = Field(default=None, pattern=r"^[a-z]{0,3}$")
    translate: Literal["0", "1"] | None = None
    tiktok_delay_s: float | None = Field(default=None, ge=0, le=120)
    youtube_delay_s: float | None = Field(default=None, ge=0, le=120)
    youtube_per_hour: int | None = Field(default=None, ge=0, le=2000)
    skip_repeats: Literal["0", "1"] | None = None
    whisper_for_auto_captions: Literal["0", "1"] | None = None
    whisper_when_refused: Literal["0", "1"] | None = None


class PositionBody(BaseModel):
    seconds: float = Field(ge=0, le=200_000)


class CollectionBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    parent_id: int | None = None  # the collection this one sits inside; null puts it at the top


class ListBody(BaseModel):
    text: str = Field(min_length=2, max_length=lists.MAX_TEXT)


class MemberBody(BaseModel):
    video_id: int


class HighlightBody(BaseModel):
    start_s: float = Field(ge=0)
    end_s: float = Field(ge=0)
    text: str = Field(min_length=1, max_length=8000)
    note: str = Field(default="", max_length=4000)


class NoteBody(BaseModel):
    note: str = Field(max_length=4000)


class UploadBody(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    size: int = Field(gt=0, le=files.MAX_BYTES)


class PauseBody(BaseModel):
    platform: Literal["all", "youtube", "tiktok"]
    paused: bool
    resync_hours: float | None = Field(default=None, ge=0, le=720)


def _detect(url: str):
    try:
        return detect(url)
    except UnsupportedLink as error:
        raise HTTPException(422, str(error)) from error


def _source(conn: sqlite3.Connection, source_id: int) -> dict:
    found = next((s for s in library.list_sources(conn) if s["id"] == source_id), None)
    if found is None:
        raise HTTPException(404, "No such source.")
    return found


def _with_covers(conn: sqlite3.Connection, sources: list[dict]) -> list[dict]:
    """A few thumbnails per source, for cards (TikTok profiles have no banner)."""
    for source in sources:
        rows = conn.execute(
            "SELECT thumb_path, thumb_blur, shape FROM videos WHERE source_id = ? AND thumb_path IS NOT NULL "
            "ORDER BY published_at IS NULL, published_at DESC, id LIMIT 4", (source["id"],),
        )
        source["covers"] = [dict(row) for row in rows]
        source["listing"] = bool(conn.execute(
            "SELECT 1 FROM jobs WHERE source_id = ? AND kind = 'list' AND state IN ('pending','running')", (source["id"],)
        ).fetchone())
    return sources


@app.post("/api/preview")
def preview(body: UrlBody, conn: sqlite3.Connection = Conn):
    """What a pasted link is, before anything is started."""
    link = _detect(body.url)
    cached = _preview_cache.get(link.url)
    if cached and time.time() - cached[0] < 600:
        result = cached[1]
    else:
        try:
            result = fetch.probe(link)
        except fetch.NeedsOneVideo as error:
            raise HTTPException(422, str(error)) from error
        except fetch.Unavailable as error:
            raise HTTPException(404, f"That link isn't available: {error}") from error
        except fetch.RateLimited as error:
            raise HTTPException(429, f"{link.platform.title()} is asking us to slow down. Try again in a minute.") from error
        except fetch.FetchError as error:
            raise HTTPException(502, f"Couldn't read that link: {error}") from error
        _preview_cache[link.url] = (time.time(), result)
    existing = conn.execute("SELECT id FROM sources WHERE url = ?", (link.url,)).fetchone()
    video = library.find_video(conn, link.key) if link.kind == "video" else None
    return {**result, "existing_source_id": existing["id"] if existing else None, "existing_video_id": video["id"] if video else None}


@app.post("/api/sources", status_code=201)
def add_source(body: UrlBody, conn: sqlite3.Connection = Conn):
    link = _detect(body.url)
    known = library.find_video(conn, link.key) if link.kind == "video" else None
    if known:  # already in the library (perhaps inside a channel): don't create an empty twin
        return _with_covers(conn, [_source(conn, known["source_id"])])[0]
    cached = _preview_cache.get(link.url)
    source_id = library.add_source(conn, link.url, cached[1] if cached else None)
    jobs.enqueue_list(conn, source_id)
    return _with_covers(conn, [_source(conn, source_id)])[0]


# Uploading a file from this computer. The web server in front buffers request bodies in memory
# (10 MB at most), so the browser sends the file in pieces and Mago puts them back together.
_UPLOAD_ID = r"^[0-9a-f]{16}\.\w{2,5}$"


@app.post("/api/files", status_code=201)
def start_upload(body: UploadBody):
    try:
        upload_id = files.new_name(body.name)
    except files.BadFile as error:
        raise HTTPException(422, str(error)) from error
    (files.uploads_dir() / upload_id).write_bytes(b"")
    return {"upload_id": upload_id, "chunk_bytes": 6 * 1024 * 1024}


@app.put("/api/files/{upload_id}/chunk", status_code=204)
async def upload_chunk(upload_id: str, request: Request, offset: int = Query(ge=0)):
    import re

    if not re.fullmatch(_UPLOAD_ID, upload_id):
        raise HTTPException(404, "No such upload.")
    path = files.uploads_dir() / upload_id
    if not path.is_file():
        raise HTTPException(404, "No such upload.")
    if path.stat().st_size != offset:  # a piece arrived twice or out of order: tell the browser where we are
        raise HTTPException(409, f"expected offset {path.stat().st_size}")
    data = await request.body()
    if offset + len(data) > files.MAX_BYTES:
        path.unlink(missing_ok=True)
        raise HTTPException(413, "That file is larger than 8 GB.")
    with open(path, "ab") as out:
        out.write(data)


@app.post("/api/files/{upload_id}/finish", status_code=201)
def finish_upload(upload_id: str, body: UploadBody, conn: sqlite3.Connection = Conn):
    import re

    path = files.uploads_dir() / upload_id
    if not re.fullmatch(_UPLOAD_ID, upload_id) or not path.is_file():
        raise HTTPException(404, "No such upload.")
    if path.stat().st_size != body.size:
        raise HTTPException(409, "The upload is incomplete. Try again.")
    stored = files.media_dir() / upload_id
    path.rename(stored)
    try:
        video_id = files.register(conn, stored, body.name)
    except files.BadFile as error:
        raise HTTPException(422, str(error)) from error
    return {"video_id": video_id}


@app.get("/api/sources")
def sources(conn: sqlite3.Connection = Conn):
    return _with_covers(conn, library.list_sources(conn))


@app.get("/api/sources/{source_id}")
def source(source_id: int, conn: sqlite3.Connection = Conn):
    found = _with_covers(conn, [_source(conn, source_id)])[0]
    found["counts"] = {
        row["status"]: row["n"]
        for row in conn.execute("SELECT status, count(*) AS n FROM videos WHERE source_id = ? GROUP BY status", (source_id,))
    }
    return found


@app.delete("/api/sources/{source_id}", status_code=204)
def delete_source(source_id: int, conn: sqlite3.Connection = Conn):
    found = _source(conn, source_id)
    if found["platform"] == "file":  # the library's copy of the owner's file goes with it
        try:
            files.path_of(found).unlink(missing_ok=True)
        except files.BadFile:
            pass
    conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))


@app.get("/api/sources/{source_id}/export")
def export_source(source_id: int, format: Literal["txt", "md", "json", "zip"] = "txt", conn: sqlite3.Connection = Conn):
    """Every finished transcript of a channel, newest first, as one file (or a zip with one file per video)."""
    found = _source(conn, source_id)
    rows = conn.execute(
        "SELECT id FROM videos WHERE source_id = ? AND status = 'done' ORDER BY published_at IS NULL, published_at DESC, id", (source_id,)
    ).fetchall()
    videos = [(library.get_video(conn, row["id"]), library.get_segments(conn, row["id"])) for row in rows]
    name = export.safe_name(found["title"] or found["handle"] or "channel", "channel")
    if format == "zip":
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for video, segments in videos:
                stem = f"{(video['published_at'] or '')[:10] or 'undated'}_{export.safe_name(video['title'] or '')}_{video['platform_video_id']}"
                archive.writestr(f"{name}/{stem}.md", export.render(video, segments, "md"))
                archive.writestr(f"{name}/{stem}.srt", export.render(video, segments, "srt"))
        return Response(buffer.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{name}.zip"'})
    body = export.render_many(found, videos, format)
    return Response(body, media_type=f"{export.FORMATS[format]}; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}.{format}"'})


@app.post("/api/queue/pause")
def pause_queue(body: PauseBody, conn: sqlite3.Connection = Conn):
    """Stop (or resume) downloads for one platform or both. The video in progress finishes first."""
    current = {name for name in db.get_settings(conn)["paused"].split(",") if name}
    names = {"youtube", "tiktok"} if body.platform == "all" else {body.platform}
    current = current | names if body.paused else current - names
    db.set_setting(conn, "paused", ",".join(sorted(current)))
    return {"paused": sorted(current)}


@app.post("/api/sources/{source_id}/sync")
def sync(source_id: int, conn: sqlite3.Connection = Conn):
    """Look for new videos. Runs in the worker; watch /api/events."""
    _source(conn, source_id)
    return {"job_id": jobs.enqueue_list(conn, source_id)}


@app.get("/api/videos")
def videos(
    conn: sqlite3.Connection = Conn,
    source_id: int | None = None,
    status: Literal["done", "working", "failed", "listed"] | None = None,
    sort: Literal["newest", "oldest", "views", "longest", "recent", "continue"] = "newest",
    platform: Literal["youtube", "tiktok", "podcast", "file"] | None = None,
    single: bool = False,
    collection_id: int | None = None,
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=60, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
):
    where, params = ["1=1"], []
    if source_id is not None:
        where.append("v.source_id = ?")
        params.append(source_id)
    if platform:
        where.append("v.platform = ?")
        params.append(platform)
    if collection_id is not None:
        where.append(f"v.id IN (SELECT video_id FROM collection_videos WHERE collection_id IN ({_FAMILY}))")
        params += [collection_id, collection_id]
    if single:  # videos added on their own, not as part of a channel
        where.append("s.kind = 'video'")
    if status:
        marks = ",".join("?" * len(_STATUS_GROUPS[status]))
        where.append(f"v.status IN ({marks})")
        params += _STATUS_GROUPS[status]
    if q.strip():
        where.append("v.title LIKE ? ESCAPE '\\'")
        params.append("%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    order = "v.transcribed_at DESC, v.id DESC" if sort == "recent" else _SORTS.get(sort, "v.id")
    if sort == "recent":
        where.append("v.status = 'done'")
    if sort == "continue":  # started, not finished: "continue where you left off"
        where.append("v.id IN (SELECT video_id FROM positions p WHERE p.seconds > 5 AND p.seconds < coalesce(v.duration_s, 1e9) - 15)")
        order = "(SELECT updated_at FROM positions WHERE video_id = v.id) DESC"
    clause = " AND ".join(where)
    total = conn.execute(f"SELECT count(*) FROM videos v JOIN sources s ON s.id = v.source_id WHERE {clause}", params).fetchone()[0]
    rows = conn.execute(
        f"SELECT {_VIDEO_LIST_COLUMNS}, s.title AS source_title, s.handle AS source_handle, "
        "(SELECT seconds FROM positions WHERE video_id = v.id) AS position_s FROM videos v "
        f"JOIN sources s ON s.id = v.source_id WHERE {clause} ORDER BY {order} LIMIT ? OFFSET ?",
        (*params, limit, offset),
    )
    return {"total": total, "items": [dict(row) for row in rows]}


@app.get("/api/videos/{video_id}")
def video(video_id: int, conn: sqlite3.Connection = Conn):
    found = library.get_video(conn, video_id)
    if found is None:
        raise HTTPException(404, "No such video.")
    segments = library.get_segments(conn, video_id)
    channel = None
    if found["source_kind"] == "video" and found.get("channel_url"):
        # Added on its own: say which channel it comes from, and whether that channel is in the library.
        try:
            link = detect(found["channel_url"])
            known = conn.execute("SELECT id FROM sources WHERE url = ?", (link.url,)).fetchone()
            channel = {"name": found["channel_name"] or link.key, "handle": link.key, "url": link.url,
                       "source_id": known["id"] if known else None}
        except UnsupportedLink:
            channel = None
    original = library.get_video(conn, found["duplicate_of"]) if found.get("duplicate_of") else None
    copies = conn.execute(
        "SELECT id, title, platform, duplicate_kind FROM videos WHERE duplicate_of = ? ORDER BY id LIMIT 20", (video_id,)
    ).fetchall()
    position = conn.execute("SELECT seconds FROM positions WHERE video_id = ?", (video_id,)).fetchone()
    found["position_s"] = position["seconds"] if position else None
    try:
        found["chapters"] = json.loads(found.get("chapters") or "[]")
    except ValueError:
        found["chapters"] = []
    found["collection_ids"] = [row["collection_id"] for row in conn.execute(
        "SELECT collection_id FROM collection_videos WHERE video_id = ?", (video_id,))]
    found["highlights"] = [dict(row) for row in conn.execute(
        "SELECT id, start_s, end_s, text, note FROM highlights WHERE video_id = ? ORDER BY start_s, id", (video_id,))]
    return {"video": found, "segments": segments, "channel": channel,
            "original": {"id": original["id"], "title": original["title"], "platform": original["platform"]} if original else None,
            "copies": [dict(row) for row in copies]}


@app.delete("/api/videos/{video_id}", status_code=204)
def delete_video(video_id: int, conn: sqlite3.Connection = Conn):
    """Remove one video and its transcript. A local file's stored copy is deleted too."""
    found = library.get_video(conn, video_id)
    if found is None:
        raise HTTPException(404, "No such video.")
    if found["platform"] == "file":
        try:
            files.path_of(found).unlink(missing_ok=True)
        except files.BadFile:
            pass
    conn.execute("DELETE FROM videos WHERE id = ?", (video_id,))
    conn.execute("DELETE FROM sources WHERE id = ? AND kind = 'video' AND NOT EXISTS (SELECT 1 FROM videos WHERE source_id = ?)",
                 (found["source_id"], found["source_id"]))


@app.get("/api/videos/{video_id}/source")
def video_source(video_id: int, conn: sqlite3.Connection = Conn):
    """Which channel a video belongs to (the menu highlights it); far lighter than the whole transcript."""
    row = conn.execute("SELECT source_id FROM videos WHERE id = ?", (video_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No such video.")
    return {"source_id": row["source_id"]}


@app.put("/api/videos/{video_id}/position", status_code=204)
def save_position(video_id: int, body: PositionBody, conn: sqlite3.Connection = Conn):
    """Remember where the owner stopped, to continue there next time."""
    if conn.execute("SELECT 1 FROM videos WHERE id = ?", (video_id,)).fetchone() is None:
        raise HTTPException(404, "No such video.")
    conn.execute(
        "INSERT INTO positions(video_id, seconds) VALUES (?, ?) ON CONFLICT(video_id) DO UPDATE SET "
        "seconds = excluded.seconds, updated_at = datetime('now')", (video_id, body.seconds),
    )


_STOP_WORDS = frozenset("""a about after again all also am an and any are as at be because been before being but by can could did do does
doing don down during each even for from get go going got had has have having he her here hers him his how i if in into is it its just know
like ll me more most much my no not now of off on once one only or other our out over own re really right s said same say see she so some
such t than that the their them then there these they thing things think this those through to too under up us ve very was way we well were
what when where which while who why will with would yeah you your um uh okay oh actually kind lot make made want gonna going people time
back little something two first new good look need come many these been""".split())


# A collection and the collections inside it (takes the collection id twice).
_FAMILY = "SELECT id FROM collections WHERE id = ? OR parent_id = ?"


def _collections(conn: sqlite3.Connection) -> list[dict]:
    """Every collection. One that holds others counts their videos as its own."""
    rows = [dict(row) for row in conn.execute(
        "SELECT c.id, c.name, c.created_at, c.parent_id, "
        "(SELECT count(*) FROM collections k WHERE k.parent_id = c.id) AS children, "
        "(SELECT count(DISTINCT m.video_id) FROM collection_videos m WHERE m.collection_id IN "
        "(SELECT id FROM collections k WHERE k.id = c.id OR k.parent_id = c.id)) AS videos "
        "FROM collections c ORDER BY c.name COLLATE NOCASE")]
    for row in rows:
        row["covers"] = [dict(cover) for cover in conn.execute(
            "SELECT v.thumb_path, v.thumb_blur, v.shape FROM videos v WHERE v.thumb_path IS NOT NULL AND v.id IN "
            f"(SELECT video_id FROM collection_videos WHERE collection_id IN ({_FAMILY})) ORDER BY v.id DESC LIMIT 4",
            (row["id"], row["id"]))]
    return rows


def _collection(conn: sqlite3.Connection, collection_id: int) -> dict:
    found = next((c for c in _collections(conn) if c["id"] == collection_id), None)
    if found is None:
        raise HTTPException(404, "No such collection.")
    return found


def _check_parent(conn: sqlite3.Connection, parent_id: int | None, child: dict | None = None) -> None:
    """Collections nest one level deep: a collection inside another can't hold collections itself."""
    if parent_id is None:
        return
    parent = _collection(conn, parent_id)
    if child and child["id"] == parent_id:
        raise HTTPException(422, "A collection can't be put inside itself.")
    if parent["parent_id"] is not None:
        raise HTTPException(422, f"{parent['name']} is already inside another collection, so it can't hold collections.")
    if child and child["children"]:
        raise HTTPException(422, f"{child['name']} holds other collections, so it can't go inside one.")


@app.get("/api/collections")
def collections(conn: sqlite3.Connection = Conn):
    return _collections(conn)


@app.post("/api/collections", status_code=201)
def create_collection(body: CollectionBody, conn: sqlite3.Connection = Conn):
    name = " ".join((body.name or "").split())
    if not name:
        raise HTTPException(422, "Give the collection a name.")
    existing = conn.execute("SELECT id FROM collections WHERE name = ?", (name,)).fetchone()
    if existing:
        return _collection(conn, existing["id"])
    _check_parent(conn, body.parent_id)
    return _collection(conn, conn.execute("INSERT INTO collections(name, parent_id) VALUES (?, ?)", (name, body.parent_id)).lastrowid)


@app.get("/api/collections/{collection_id}")
def collection(collection_id: int, conn: sqlite3.Connection = Conn):
    return _collection(conn, collection_id)


@app.put("/api/collections/{collection_id}")
def change_collection(collection_id: int, body: CollectionBody, conn: sqlite3.Connection = Conn):
    """Rename it (`name`), move it into another collection or back to the top (`parent_id`), or both."""
    found = _collection(conn, collection_id)
    if "parent_id" in body.model_fields_set:
        _check_parent(conn, body.parent_id, found)
        conn.execute("UPDATE collections SET parent_id = ? WHERE id = ?", (body.parent_id, collection_id))
    name = " ".join((body.name or "").split())
    if name:
        try:
            conn.execute("UPDATE collections SET name = ? WHERE id = ?", (name, collection_id))
        except sqlite3.IntegrityError as error:
            raise HTTPException(409, "Another collection already has that name.") from error
    return _collection(conn, collection_id)


@app.delete("/api/collections/{collection_id}", status_code=204)
def delete_collection(collection_id: int, conn: sqlite3.Connection = Conn):
    """Deletes the grouping only; the videos and transcripts stay in the library, and any
    collections inside it move to the top."""
    _collection(conn, collection_id)
    conn.execute("DELETE FROM collections WHERE id = ?", (collection_id,))


@app.post("/api/collections/{collection_id}/videos", status_code=204)
def add_to_collection(collection_id: int, body: MemberBody, conn: sqlite3.Connection = Conn):
    _collection(conn, collection_id)
    if library.get_video(conn, body.video_id) is None:
        raise HTTPException(404, "No such video.")
    conn.execute("INSERT OR IGNORE INTO collection_videos(collection_id, video_id) VALUES (?, ?)", (collection_id, body.video_id))


@app.delete("/api/collections/{collection_id}/videos/{video_id}", status_code=204)
def remove_from_collection(collection_id: int, video_id: int, conn: sqlite3.Connection = Conn):
    conn.execute("DELETE FROM collection_videos WHERE collection_id = ? AND video_id = ?", (collection_id, video_id))


_HIGHLIGHT_COLUMNS = (
    "h.id, h.video_id, h.start_s, h.end_s, h.text, h.note, h.created_at, v.title, v.platform, v.platform_video_id, v.url, "
    "v.thumb_path, v.thumb_blur, v.shape, v.published_at, s.title AS source_title"
)


def highlight_rows(conn: sqlite3.Connection, q: str = "", video_id: int | None = None, limit: int = 500) -> list[dict]:
    where, params = ["1=1"], []
    if video_id is not None:
        where.append("h.video_id = ?")
        params.append(video_id)
    for word in q.split()[:8]:
        where.append("(h.text LIKE ? ESCAPE '\\' OR h.note LIKE ? ESCAPE '\\' OR v.title LIKE ? ESCAPE '\\')")
        like = "%" + word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        params += [like, like, like]
    rows = conn.execute(
        f"SELECT {_HIGHLIGHT_COLUMNS} FROM highlights h JOIN videos v ON v.id = h.video_id JOIN sources s ON s.id = v.source_id "
        f"WHERE {' AND '.join(where)} ORDER BY h.created_at DESC, h.id DESC LIMIT ?", (*params, limit))
    return [dict(row) for row in rows]


@app.get("/api/lists/prompt")
def list_prompt():
    """What to give an AI so that it answers with a list Mago can import. {topic} is filled in by the reader."""
    return {"prompt": lists.PROMPT.replace("{{", "{").replace("}}", "}")}


def _read_list(text: str) -> lists.LinkList:
    try:
        return lists.parse(text)
    except lists.BadList as error:
        raise HTTPException(422, str(error)) from error


@app.post("/api/lists/check")
def check_list(body: ListBody, conn: sqlite3.Connection = Conn):
    """What importing this list would do. Changes nothing."""
    return lists.check(conn, _read_list(body.text))


@app.post("/api/lists", status_code=201)
def import_list(body: ListBody, conn: sqlite3.Connection = Conn):
    """Create the list's collections and queue its links."""
    found = _read_list(body.text)
    try:
        return lists.apply(conn, found)
    except lists.BadList as error:
        raise HTTPException(409, str(error)) from error


@app.get("/api/highlights")
def highlights(q: str = Query(default="", max_length=200), video_id: int | None = None, conn: sqlite3.Connection = Conn):
    return highlight_rows(conn, q, video_id)


@app.get("/api/highlights/export")
def export_highlights(conn: sqlite3.Connection = Conn):
    """Every highlight as one Markdown file, grouped by video, each with a link to its moment."""
    lines, current = ["# Highlights", ""], None
    for row in sorted(highlight_rows(conn, limit=5000), key=lambda r: (r["video_id"], r["start_s"])):
        if row["video_id"] != current:
            current = row["video_id"]
            lines += [f"## {row['title'] or row['url']}", "", f"{row['source_title'] or ''} {row['url']}".strip(), ""]
        lines.append(f"> {row['text']}")
        lines.append(f"> [{export.clock(row['start_s'])}]({library.timestamp_url(row, row['start_s'])})")
        if row["note"]:
            lines += ["", row["note"]]
        lines.append("")
    return Response("\n".join(lines), media_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="mago-highlights.md"'})


@app.post("/api/videos/{video_id}/highlights", status_code=201)
def add_highlight(video_id: int, body: HighlightBody, conn: sqlite3.Connection = Conn):
    if library.get_video(conn, video_id) is None:
        raise HTTPException(404, "No such video.")
    highlight_id = conn.execute(
        "INSERT INTO highlights(video_id, start_s, end_s, text, note) VALUES (?,?,?,?,?)",
        (video_id, body.start_s, max(body.end_s, body.start_s), " ".join(body.text.split()), body.note.strip())).lastrowid
    return {"id": highlight_id}


@app.put("/api/highlights/{highlight_id}", status_code=204)
def edit_highlight(highlight_id: int, body: NoteBody, conn: sqlite3.Connection = Conn):
    if conn.execute("UPDATE highlights SET note = ? WHERE id = ?", (body.note.strip(), highlight_id)).rowcount == 0:
        raise HTTPException(404, "No such highlight.")


@app.delete("/api/highlights/{highlight_id}", status_code=204)
def delete_highlight(highlight_id: int, conn: sqlite3.Connection = Conn):
    conn.execute("DELETE FROM highlights WHERE id = ?", (highlight_id,))


@app.get("/api/stats")
def stats(conn: sqlite3.Connection = Conn):
    """What the library holds: hours, words, how it was transcribed, per channel, and the words said most."""
    totals = dict(conn.execute(
        "SELECT count(*) AS videos, coalesce(sum(duration_s), 0) AS seconds, "
        "coalesce(sum(method = 'captions'), 0) AS from_captions, coalesce(sum(method = 'whisper'), 0) AS from_whisper, "
        "coalesce(sum(duplicate_of IS NOT NULL), 0) AS duplicates FROM videos WHERE status = 'done'").fetchone())
    totals["words"] = conn.execute(
        "SELECT coalesce(sum(length(text) - length(replace(text, ' ', '')) + 1), 0) FROM segments").fetchone()[0]
    totals["all_videos"] = conn.execute("SELECT count(*) FROM videos").fetchone()[0]
    channels = conn.execute(
        "SELECT s.id, s.title, s.handle, s.platform, s.kind, count(v.id) AS videos, coalesce(sum(v.status = 'done'), 0) AS done, "
        "coalesce(sum(CASE WHEN v.status = 'done' THEN v.duration_s END), 0) AS seconds, "
        "(SELECT coalesce(sum(length(g.text) - length(replace(g.text, ' ', '')) + 1), 0) FROM segments g "
        " JOIN videos v2 ON v2.id = g.video_id WHERE v2.source_id = s.id) AS words "
        "FROM sources s LEFT JOIN videos v ON v.source_id = s.id WHERE s.kind != 'video' GROUP BY s.id ORDER BY seconds DESC")
    by_month = conn.execute(
        "SELECT substr(published_at, 1, 7) AS month, count(*) AS videos FROM videos WHERE status = 'done' AND published_at IS NOT NULL "
        "GROUP BY 1 ORDER BY 1 DESC LIMIT 24")
    conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.segment_terms USING fts5vocab(main, segments_fts, row)")
    terms = [dict(row) for row in conn.execute("SELECT term, doc AS lines, cnt AS times FROM temp.segment_terms ORDER BY cnt DESC LIMIT 400")
             if len(row["term"]) > 3 and row["term"] not in _STOP_WORDS and not row["term"].isdigit()][:40]
    return {"totals": totals, "channels": [dict(row) for row in channels],
            "by_month": [dict(row) for row in by_month][::-1], "terms": terms}


@app.post("/api/videos/{video_id}/retry")
def retry(video_id: int, conn: sqlite3.Connection = Conn):
    if library.get_video(conn, video_id) is None:
        raise HTTPException(404, "No such video.")
    return {"job_id": jobs.enqueue_transcribe(conn, video_id, priority=10)}


@app.post("/api/retry-failed")
def retry_failed(source_id: int | None = None, conn: sqlite3.Connection = Conn):
    query, params = "SELECT id FROM videos WHERE status = 'failed'", ()
    if source_id is not None:
        query, params = query + " AND source_id = ?", (source_id,)
    ids = [row["id"] for row in conn.execute(query, params)]
    for video_id in ids:
        jobs.enqueue_transcribe(conn, video_id)
    return {"queued": len(ids)}


@app.get("/api/videos/{video_id}/export")
def export_video(video_id: int, format: Literal["txt", "srt", "vtt", "json", "md"] = "txt", conn: sqlite3.Connection = Conn):
    found = library.get_video(conn, video_id)
    if found is None:
        raise HTTPException(404, "No such video.")
    body = export.render(found, library.get_segments(conn, video_id), format)
    name = f"{found['platform']}_{found['platform_video_id']}.{format}"
    return Response(body, media_type=f"{export.FORMATS[format]}; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/search")
def search(
    q: str = Query(max_length=300),
    platform: Literal["youtube", "tiktok", "podcast", "file"] | None = None,
    source_id: int | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    mode: Literal["words", "meaning"] = "words",
    published_after: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    include_duplicates: bool = False,
    conn: sqlite3.Connection = Conn,
):
    if mode == "meaning":
        hits = meaning.search(conn, q, platform, source_id, published_after, limit=limit, include_duplicates=include_duplicates)
        return {"query": q, "items": hits, "loose": False, "has_more": False, "index": meaning.coverage(conn)}
    hits = library.search(conn, q, platform, source_id, limit + 1, offset)  # one extra: is there a next page?
    has_more = len(hits) > limit
    hits = hits[:limit]
    loose = False
    if not hits and offset == 0:
        # Nothing in a single caption line: look in passages (a phrase can run across lines).
        hits = library.search_passages(conn, q, platform, source_id, limit=limit, per_video=3)
        loose = any(hit["match"] == "some words" for hit in hits)
    blurs = {}
    if hits:
        marks = ",".join("?" * len({h["video_id"] for h in hits}))
        rows = conn.execute(f"SELECT id, thumb_blur, shape FROM videos WHERE id IN ({marks})", list({h["video_id"] for h in hits}))
        blurs = {row["id"]: row for row in rows}
    for hit in hits:
        hit["thumb_blur"], hit["shape"] = blurs[hit["video_id"]]["thumb_blur"], blurs[hit["video_id"]]["shape"]
    return {"query": q, "items": hits, "loose": loose, "has_more": has_more}


def mcp_status(conn: sqlite3.Connection) -> dict:
    """Is any Claude session connected through the MCP server, and what did it last ask for?"""
    alive = []
    for row in conn.execute("SELECT * FROM mcp_sessions").fetchall():
        try:
            os.kill(row["pid"], 0)  # signal 0: only checks that the process exists
            with open(f"/proc/{row['pid']}/cmdline", "rb") as handle:
                if b"mago" not in handle.read():
                    raise ProcessLookupError  # the pid was reused by something else
            alive.append(dict(row))
        except (ProcessLookupError, FileNotFoundError):
            conn.execute("DELETE FROM mcp_sessions WHERE pid = ?", (row["pid"],))
        except PermissionError:
            alive.append(dict(row))
    last = max((s for s in alive if s["last_call_at"]), key=lambda s: s["last_call_at"], default=None)
    return {
        "sessions": len(alive),
        "calls": sum(s["calls"] for s in alive),
        "last_tool": last["last_tool"] if last else None,
        "last_call_at": last["last_call_at"] if last else None,
        "busy": bool(last and time.time() - last["last_call_at"] < 15),  # Claude used a tool moments ago
    }


def activity_snapshot(conn: sqlite3.Connection) -> dict:
    counts = {row["status"]: row["n"] for row in conn.execute("SELECT status, count(*) AS n FROM videos GROUP BY status")}
    active = conn.execute(
        f"SELECT {_VIDEO_LIST_COLUMNS}, s.title AS source_title FROM videos v JOIN sources s ON s.id = v.source_id "
        "WHERE v.status IN ('captions','downloading','transcribing') ORDER BY v.id LIMIT 5"
    )
    listing = conn.execute(
        "SELECT s.id, s.title, s.handle, s.url FROM jobs j JOIN sources s ON s.id = j.source_id "
        "WHERE j.kind = 'list' AND j.state IN ('pending','running')"
    )
    runtime = db.get_runtime(conn)
    heartbeat = int(runtime.get("heartbeat", 0))
    now = int(time.time())
    pauses = [
        {"platform": name, "until": int(runtime.get(f"pause_{name}_until", 0)), "reason": runtime.get(f"pause_{name}_reason", "refused")}
        for name in ("youtube", "tiktok")
        if int(runtime.get(f"pause_{name}_until", 0)) > now
    ]
    platforms = {name: {"total": 0, "done": 0, "working": 0, "failed": 0} for name in ("youtube", "tiktok", "podcast", "file")}
    for row in conn.execute("SELECT platform, status, count(*) AS n FROM videos GROUP BY platform, status"):
        bucket = "done" if row["status"] == "done" else "failed" if row["status"] in ("failed", "skipped") else "working"
        if row["status"] != "listed":
            platforms[row["platform"]][bucket] += row["n"]
        platforms[row["platform"]]["total"] += row["n"]
    finished = conn.execute(
        "SELECT id, title, platform FROM videos WHERE status = 'done' AND transcribed_at IS NOT NULL "
        "ORDER BY transcribed_at DESC, id DESC LIMIT 3"
    )
    return {
        "revision": conn.execute("SELECT n FROM revision WHERE id = 1").fetchone()[0],
        "mcp": mcp_status(conn),
        "finished": [dict(row) for row in finished],
        "paused": [name for name in db.get_settings(conn)["paused"].split(",") if name],
        "pauses": pauses,
        "platforms": platforms,
        "counts": counts,
        "queued": counts.get("queued", 0),
        "active": [dict(row) for row in active],
        "listing": [dict(row) for row in listing],
        # The heartbeat only ticks between jobs, so a job in progress also counts as alive.
        "worker": {"alive": time.time() - heartbeat < 15 or bool(conn.execute("SELECT 1 FROM jobs WHERE state = 'running'").fetchone()),
                   "device": runtime.get("device"), "model": runtime.get("model")},
    }


@app.get("/api/activity")
def activity(next_offset: int = Query(default=0, ge=0), next_limit: int = Query(default=20, ge=1, le=100),
             conn: sqlite3.Connection = Conn):
    snapshot = activity_snapshot(conn)
    up_next = conn.execute(
        f"SELECT {_VIDEO_LIST_COLUMNS}, s.title AS source_title FROM jobs j JOIN videos v ON v.id = j.video_id "
        "JOIN sources s ON s.id = v.source_id WHERE j.state = 'pending' AND j.kind = 'transcribe' "
        "ORDER BY j.priority DESC, j.id LIMIT ? OFFSET ?", (next_limit, next_offset),
    )
    failed = conn.execute(
        f"SELECT {_VIDEO_LIST_COLUMNS}, s.title AS source_title FROM videos v JOIN sources s ON s.id = v.source_id "
        "WHERE v.status IN ('failed','skipped') ORDER BY v.id DESC LIMIT 2000"
    )
    failed_sources = conn.execute(
        "SELECT s.id, s.title, s.handle, s.url, j.log AS error FROM sources s JOIN jobs j ON j.id = "
        "(SELECT max(id) FROM jobs WHERE source_id = s.id AND kind = 'list') WHERE j.state = 'failed'"
    )
    # Rough time left: how long recent videos took on each platform, plus the pause between videos.
    settings = db.get_settings(conn)
    eta = 0.0
    for name in ("youtube", "tiktok"):
        waiting = snapshot["platforms"][name]["working"]
        if not waiting:
            continue
        average = conn.execute(
            "SELECT avg(s) FROM (SELECT (julianday(j.finished_at) - julianday(j.started_at)) * 86400 AS s FROM jobs j "
            "JOIN videos v ON v.id = j.video_id WHERE j.kind = 'transcribe' AND j.state = 'done' AND v.platform = ? "
            "ORDER BY j.id DESC LIMIT 20)", (name,),
        ).fetchone()[0]
        per_video = (average if average is not None else (3 if name == "youtube" else 15)) + float(settings[f"{name}_delay_s"])
        if name == "youtube" and float(settings["youtube_per_hour"]) > 0:
            per_video = max(per_video, 3600 / float(settings["youtube_per_hour"]))
        eta += waiting * per_video
        eta += max((pause["until"] - time.time() for pause in snapshot["pauses"] if pause["platform"] == name), default=0)
    snapshot["eta_s"] = round(eta)
    return {**snapshot, "up_next": [dict(row) for row in up_next], "failed": [dict(row) for row in failed],
            "failed_sources": [dict(row) for row in failed_sources]}


@app.get("/api/events")
async def events():
    """Server-Sent Events: a fresh activity snapshot whenever something changes."""

    async def stream():
        conn = db.connect()
        last = None
        idle = 0.0
        try:
            while True:
                payload = json.dumps(await asyncio.to_thread(activity_snapshot, conn), sort_keys=True)
                if payload != last:
                    last, idle = payload, 0.0
                    yield f"data: {payload}\n\n"
                elif idle >= 15:
                    idle = 0.0
                    yield ": keep-alive\n\n"
                await asyncio.sleep(0.4)
                idle += 0.4
        finally:
            conn.close()

    # No "; charset" on the content type: Caddy only streams (instead of buffering) an exact text/event-stream.
    response = StreamingResponse(stream(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    response.raw_headers.append((b"content-type", b"text/event-stream"))
    return response


@app.get("/api/settings")
def read_settings(conn: sqlite3.Connection = Conn):
    return db.get_settings(conn)


@app.put("/api/settings")
def write_settings(body: SettingsBody, conn: sqlite3.Connection = Conn):
    for key, value in body.model_dump(exclude_none=True).items():
        db.set_setting(conn, key, value if isinstance(value, str) else f"{value:g}")
    return db.get_settings(conn)


@app.get("/api/system")
def system(conn: sqlite3.Connection = Conn):
    from .whisper_engine import free_vram_mb, gpu_lock_busy

    return {"meaning_index": meaning.coverage(conn), "ytdlp_version": fetch.ytdlp_installed_version(), "gpu_free_mb": free_vram_mb(),
            "gpu_lock_busy": gpu_lock_busy(), "mcp_command": f"claude mcp add mago --scope user -- {sys.executable} -m mago.mcp_server",
            **activity_snapshot(conn)["worker"]}


@app.post("/api/system/update-ytdlp")
def update_ytdlp(conn: sqlite3.Connection = Conn):
    """Install the newest yt-dlp (TikTok and YouTube break old versions often),
    then tell the worker to reload it. The command is fixed: nothing from the request reaches it."""
    before = fetch.ytdlp_installed_version()
    uv = shutil.which("uv")
    if uv is None:
        raise HTTPException(500, "The uv tool isn't installed, so yt-dlp can't be updated from here.")
    result = subprocess.run(
        [uv, "pip", "install", "--python", sys.executable, "--upgrade", "yt-dlp", "yt-dlp-ejs"],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        raise HTTPException(502, f"The update failed: {result.stderr.strip()[-300:]}")
    after = fetch.ytdlp_installed_version()
    if after != before:
        db.set_runtime(conn, reload="1")  # the worker restarts itself between jobs
        # This process has the old yt-dlp loaded too (used for previews): restart it once the reply is sent.
        if os.path.basename(sys.argv[0]) == "uvicorn":
            threading.Timer(1.0, lambda: os.execv(sys.argv[0], sys.argv)).start()
    return {"before": before, "after": after, "updated": after != before}
