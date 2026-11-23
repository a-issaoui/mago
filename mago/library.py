"""The library: sources, videos, transcripts and search over one SQLite file.

The web API and the MCP server both call these functions, so they behave the same.
"""

import re
import sqlite3

from . import fetch
from .links import Link, detect

_VIDEO_COLUMNS = ("url", "title", "description", "published_at", "duration_s", "view_count", "thumb_url_original", "language")


def add_source(conn: sqlite3.Connection, raw_url: str, preview: dict | None = None) -> int:
    """Register a link (idempotent). Listing its videos is a separate step."""
    link = detect(raw_url)
    existing = conn.execute("SELECT id FROM sources WHERE url = ?", (link.url,)).fetchone()
    if existing:
        return existing["id"]
    preview = preview or {}
    cursor = conn.execute(
        "INSERT INTO sources(platform, kind, url, handle, title, video_count) VALUES (?,?,?,?,?,?)",
        (link.platform, link.kind, link.url, preview.get("handle") or (link.key if link.kind != "video" else None),
         preview.get("channel") if link.kind == "video" else preview.get("title"), preview.get("video_count")),
    )
    return cursor.lastrowid


def source_link(conn: sqlite3.Connection, source_id: int) -> Link:
    row = conn.execute("SELECT url FROM sources WHERE id = ?", (source_id,)).fetchone()
    if row is None:
        raise LookupError(f"no source {source_id}")
    return detect(row["url"])


def upsert_video(conn: sqlite3.Connection, source_id: int, platform: str, fields: dict) -> tuple[int, bool]:
    """Insert a listed video, or refresh the metadata of a known one.
    Returns (video id, True if it is new). A known video keeps its transcript."""
    row = conn.execute(
        "SELECT v.id, v.source_id, s.kind FROM videos v JOIN sources s ON s.id = v.source_id "
        "WHERE v.platform = ? AND v.platform_video_id = ?",
        (platform, fields["platform_video_id"]),
    ).fetchone()
    if row is None:
        cursor = conn.execute(
            "INSERT INTO videos(source_id, platform, platform_video_id, url, title, description, published_at, "
            "duration_s, view_count, thumb_url_original, language, shape) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (source_id, platform, fields["platform_video_id"], *(fields.get(c) for c in _VIDEO_COLUMNS),
             fields.get("shape") or ("tall" if platform == "tiktok" else "wide")),
        )
        return cursor.lastrowid, True
    update_video(conn, row["id"], fields)
    if row["source_id"] != source_id and row["kind"] == "video":
        # First pasted alone, now found in its channel: it belongs to the channel.
        conn.execute("UPDATE videos SET source_id = ? WHERE id = ?", (source_id, row["id"]))
        conn.execute("DELETE FROM sources WHERE id = ? AND NOT EXISTS (SELECT 1 FROM videos WHERE source_id = ?)",
                     (row["source_id"], row["source_id"]))
    return row["id"], False


def update_video(conn: sqlite3.Connection, video_id: int, fields: dict) -> None:
    """Fill in metadata; a missing value never erases one we already have."""
    known = {c: fields[c] for c in _VIDEO_COLUMNS if fields.get(c) not in (None, "")}
    if known:
        assignments = ", ".join(f"{column} = ?" for column in known)
        conn.execute(f"UPDATE videos SET {assignments} WHERE id = ?", (*known.values(), video_id))


def sync_source(conn: sqlite3.Connection, source_id: int, limit: int | None = None) -> dict:
    """List the source again and add the videos we don't have yet. A listing
    cut short (TikTok 429) can only add videos, never remove any."""
    link = source_link(conn, source_id)
    listed = new = 0
    new_ids = []
    for fields in fetch.list_videos(link, limit=limit):
        video_id, is_new = upsert_video(conn, source_id, link.platform, fields)
        listed += 1
        if is_new:
            new += 1
            new_ids.append(video_id)
    total = conn.execute("SELECT count(*) FROM videos WHERE source_id = ?", (source_id,)).fetchone()[0]
    conn.execute("UPDATE sources SET video_count = ?, last_synced_at = datetime('now') WHERE id = ?", (total, source_id))
    return {"listed": listed, "new": new, "new_video_ids": new_ids, "total": total}


def set_status(conn: sqlite3.Connection, video_id: int, status: str, error: str | None = None, progress: float = 0) -> None:
    conn.execute("UPDATE videos SET status = ?, error = ?, progress = ? WHERE id = ?", (status, error, progress, video_id))


def save_transcript(conn: sqlite3.Connection, video_id: int, segments: list[dict], method: str, language: str | None) -> None:
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM segments WHERE video_id = ?", (video_id,))
        conn.executemany(
            "INSERT INTO segments(video_id, start_s, end_s, text) VALUES (?,?,?,?)",
            [(video_id, s["start"], s["end"], s["text"]) for s in segments],
        )
        conn.execute(
            "UPDATE videos SET status = 'done', method = ?, language = coalesce(?, language), error = NULL, "
            "progress = 1, transcribed_at = datetime('now') WHERE id = ?",
            (method, language, video_id),
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def list_sources(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT s.*, count(v.id) AS videos_total, "
        "coalesce(sum(v.status = 'done'), 0) AS videos_done, "
        "coalesce(sum(v.status IN ('failed','skipped')), 0) AS videos_failed "
        "FROM sources s LEFT JOIN videos v ON v.source_id = s.id GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC"
    )
    return [dict(row) for row in rows]


def get_video(conn: sqlite3.Connection, video_id: int) -> dict | None:
    row = conn.execute(
        "SELECT v.*, s.title AS source_title, s.handle AS source_handle, s.kind AS source_kind "
        "FROM videos v JOIN sources s ON s.id = v.source_id WHERE v.id = ?", (video_id,),
    ).fetchone()
    return dict(row) if row else None


def find_video(conn: sqlite3.Connection, reference: str | int) -> dict | None:
    """Look a video up by Mago id, platform id or link."""
    text = str(reference).strip()
    if text.isdigit() and len(text) < 12:
        found = get_video(conn, int(text))
        if found:
            return found
    try:
        text = detect(text).key
    except ValueError:
        pass
    row = conn.execute("SELECT id FROM videos WHERE platform_video_id = ?", (text,)).fetchone()
    return get_video(conn, row["id"]) if row else None


def get_segments(conn: sqlite3.Connection, video_id: int) -> list[dict]:
    rows = conn.execute("SELECT start_s AS start, end_s AS \"end\", text FROM segments WHERE video_id = ? ORDER BY start_s, id", (video_id,))
    return [dict(row) for row in rows]


def get_transcript(conn: sqlite3.Connection, reference: str | int) -> dict | None:
    video = find_video(conn, reference)
    if video is None:
        return None
    segments = get_segments(conn, video["id"])
    return {"video": video, "segments": segments, "text": " ".join(s["text"] for s in segments)}


def _fts_query(query: str) -> str:
    """Plain words → a safe FTS5 query: every word must appear, the last one
    may be a prefix (search-as-you-type). Quoted phrases are kept as phrases."""
    phrases = re.findall(r'"([^"]+)"', query)
    words = re.findall(r"[\w']+", re.sub(r'"[^"]*"', " ", query), re.UNICODE)
    terms = [f'"{phrase}"' for phrase in phrases if phrase.strip()]
    terms += [f'"{word}"' for word in words]
    if words and terms:
        terms[-1] += "*"
    return " AND ".join(terms)


def search(conn: sqlite3.Connection, query: str, platform: str | None = None, source_id: int | None = None,
           limit: int = 30, offset: int = 0) -> list[dict]:
    """Search every transcript. Each hit is one timed line, with the match
    wrapped in <mark> and enough video detail to show a result card."""
    match = _fts_query(query)
    if not match:
        return []
    filters, params = "", [match]
    if platform:
        filters += " AND v.platform = ?"
        params.append(platform)
    if source_id:
        filters += " AND v.source_id = ?"
        params.append(source_id)
    rows = conn.execute(
        "SELECT v.id AS video_id, v.platform, v.platform_video_id, v.url, v.title, v.thumb_path, v.duration_s, "
        "v.published_at, v.source_id, s.title AS source_title, s.handle AS source_handle, "
        "g.start_s AS start, g.end_s AS \"end\", g.text, "
        "snippet(segments_fts, 0, '<mark>', '</mark>', '…', 24) AS snippet "
        "FROM segments_fts JOIN segments g ON g.id = segments_fts.rowid "
        "JOIN videos v ON v.id = g.video_id JOIN sources s ON s.id = v.source_id "
        f"WHERE segments_fts MATCH ?{filters} ORDER BY bm25(segments_fts), v.published_at DESC LIMIT ? OFFSET ?",
        (*params, max(1, min(limit, 200)), max(0, offset)),
    )
    return [dict(row) for row in rows]


def timestamp_url(video: dict, seconds: float) -> str:
    """A link that opens the video at that moment (YouTube only supports it)."""
    if video["platform"] == "youtube":
        return f"https://www.youtube.com/watch?v={video['platform_video_id']}&t={int(seconds)}s"
    return video["url"]
