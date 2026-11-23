"""The HTTP API the web interface talks to. Local only: bind it to 127.0.0.1.

Run with:  uvicorn mago.api:app --host 127.0.0.1 --port 8010
"""

import asyncio
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, db, export, fetch, jobs, library
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

_preview_cache: dict[str, tuple[float, dict]] = {}
_VIDEO_LIST_COLUMNS = (
    "v.id, v.source_id, v.platform, v.platform_video_id, v.url, v.title, v.published_at, v.duration_s, v.view_count, "
    "v.thumb_path, v.thumb_blur, v.shape, v.language, v.status, v.error, v.method, v.progress, v.transcribed_at"
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
    whisper_model: Literal["tiny", "base", "small", "medium"] | None = None
    device: Literal["auto", "cuda", "cpu"] | None = None
    language: str | None = Field(default=None, pattern=r"^[a-z]{0,3}$")
    translate: Literal["0", "1"] | None = None
    tiktok_delay_s: float | None = Field(default=None, ge=0, le=120)
    youtube_delay_s: float | None = Field(default=None, ge=0, le=120)
    youtube_per_hour: int | None = Field(default=None, ge=0, le=2000)
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
    _source(conn, source_id)
    conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))


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
    sort: Literal["newest", "oldest", "views", "longest", "recent"] = "newest",
    platform: Literal["youtube", "tiktok"] | None = None,
    single: bool = False,
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=60, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    where, params = ["1=1"], []
    if source_id is not None:
        where.append("v.source_id = ?")
        params.append(source_id)
    if platform:
        where.append("v.platform = ?")
        params.append(platform)
    if single:  # videos added on their own, not as part of a channel
        where.append("s.kind = 'video'")
    if status:
        marks = ",".join("?" * len(_STATUS_GROUPS[status]))
        where.append(f"v.status IN ({marks})")
        params += _STATUS_GROUPS[status]
    if q.strip():
        where.append("v.title LIKE ? ESCAPE '\\'")
        params.append("%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    order = "v.transcribed_at DESC, v.id DESC" if sort == "recent" else _SORTS[sort]
    if sort == "recent":
        where.append("v.status = 'done'")
    clause = " AND ".join(where)
    total = conn.execute(f"SELECT count(*) FROM videos v JOIN sources s ON s.id = v.source_id WHERE {clause}", params).fetchone()[0]
    rows = conn.execute(
        f"SELECT {_VIDEO_LIST_COLUMNS}, s.title AS source_title, s.handle AS source_handle FROM videos v "
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
    return {"video": found, "segments": segments, "channel": channel}


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
    platform: Literal["youtube", "tiktok"] | None = None,
    source_id: int | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conn: sqlite3.Connection = Conn,
):
    hits = library.search(conn, q, platform, source_id, limit, offset)
    blurs = {}
    if hits:
        marks = ",".join("?" * len({h["video_id"] for h in hits}))
        rows = conn.execute(f"SELECT id, thumb_blur, shape FROM videos WHERE id IN ({marks})", list({h["video_id"] for h in hits}))
        blurs = {row["id"]: row for row in rows}
    for hit in hits:
        hit["thumb_blur"], hit["shape"] = blurs[hit["video_id"]]["thumb_blur"], blurs[hit["video_id"]]["shape"]
    return {"query": q, "items": hits}


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
    platforms = {name: {"total": 0, "done": 0, "working": 0, "failed": 0} for name in ("youtube", "tiktok")}
    for row in conn.execute("SELECT platform, status, count(*) AS n FROM videos GROUP BY platform, status"):
        bucket = "done" if row["status"] == "done" else "failed" if row["status"] in ("failed", "skipped") else "working"
        if row["status"] != "listed":
            platforms[row["platform"]][bucket] += row["n"]
        platforms[row["platform"]]["total"] += row["n"]
    return {
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
def activity(conn: sqlite3.Connection = Conn):
    snapshot = activity_snapshot(conn)
    up_next = conn.execute(
        f"SELECT {_VIDEO_LIST_COLUMNS}, s.title AS source_title FROM jobs j JOIN videos v ON v.id = j.video_id "
        "JOIN sources s ON s.id = v.source_id WHERE j.state = 'pending' AND j.kind = 'transcribe' "
        "ORDER BY j.priority DESC, j.id LIMIT 30"
    )
    failed = conn.execute(
        f"SELECT {_VIDEO_LIST_COLUMNS}, s.title AS source_title FROM videos v JOIN sources s ON s.id = v.source_id "
        "WHERE v.status IN ('failed','skipped') ORDER BY v.id DESC LIMIT 100"
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
                await asyncio.sleep(1)
                idle += 1
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

    return {"accounts": {name: fetch.account_file(name) is not None for name in ("youtube", "tiktok")},
            "cookies_dir": str(config.COOKIES_DIR),
            "ytdlp_version": fetch.ytdlp_installed_version(), "gpu_free_mb": free_vram_mb(),
            "gpu_lock_busy": gpu_lock_busy(), **activity_snapshot(conn)["worker"]}


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
