"""The job queue: a table in the same database, so jobs survive restarts."""

import sqlite3

MAX_ATTEMPTS = 4
RATE_LIMIT_ATTEMPTS = 8


def enqueue_list(conn: sqlite3.Connection, source_id: int) -> int:
    """Queue a (re)listing of a source, unless one is already waiting."""
    row = conn.execute(
        "SELECT id FROM jobs WHERE source_id = ? AND kind = 'list' AND state IN ('pending','running')", (source_id,)
    ).fetchone()
    if row:
        return row["id"]
    return conn.execute("INSERT INTO jobs(source_id, kind, priority) VALUES (?, 'list', 100)", (source_id,)).lastrowid


def enqueue_transcribe(conn: sqlite3.Connection, video_id: int, priority: int = 0) -> int:
    row = conn.execute(
        "SELECT id FROM jobs WHERE video_id = ? AND kind = 'transcribe' AND state IN ('pending','running')", (video_id,)
    ).fetchone()
    if row:
        return row["id"]
    conn.execute("UPDATE videos SET status = 'queued', error = NULL, progress = 0 WHERE id = ?", (video_id,))
    return conn.execute(
        "INSERT INTO jobs(video_id, kind, priority) VALUES (?, 'transcribe', ?)", (video_id, priority)
    ).lastrowid


def claim(conn: sqlite3.Connection) -> dict | None:
    """Take the next job that is due. Listings and single videos go first."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            "SELECT * FROM jobs WHERE state = 'pending' AND next_try_at <= datetime('now') "
            "ORDER BY priority DESC, id LIMIT 1"
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE jobs SET state = 'running', attempts = attempts + 1, started_at = datetime('now') WHERE id = ?",
                (row["id"],),
            )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return {**dict(row), "attempts": row["attempts"] + 1} if row else None


def finish(conn: sqlite3.Connection, job_id: int, log: str = "") -> None:
    conn.execute("UPDATE jobs SET state = 'done', finished_at = datetime('now'), log = ? WHERE id = ?", (log[:2000], job_id))


def retry_later(conn: sqlite3.Connection, job: dict, delay_s: int, log: str) -> None:
    conn.execute(
        "UPDATE jobs SET state = 'pending', next_try_at = datetime('now', ?), log = ? WHERE id = ?",
        (f"+{int(delay_s)} seconds", log[:2000], job["id"]),
    )
    if job.get("video_id"):
        conn.execute("UPDATE videos SET status = 'queued', error = ?, progress = 0 WHERE id = ?", (log[:500], job["video_id"]))


def fail(conn: sqlite3.Connection, job: dict, log: str) -> None:
    conn.execute("UPDATE jobs SET state = 'failed', finished_at = datetime('now'), log = ? WHERE id = ?", (log[:2000], job["id"]))
    if job.get("video_id"):
        conn.execute("UPDATE videos SET status = 'failed', error = ?, progress = 0 WHERE id = ?", (log[:500], job["video_id"]))


def recover(conn: sqlite3.Connection) -> int:
    """After a crash or restart, jobs left 'running' go back in the queue."""
    conn.execute(
        "UPDATE videos SET status = 'queued', progress = 0 WHERE status IN ('captions','downloading','transcribing')"
    )
    return conn.execute("UPDATE jobs SET state = 'pending', next_try_at = datetime('now') WHERE state = 'running'").rowcount


def backoff_s(attempts: int, rate_limited: bool) -> int:
    base = 60 if rate_limited else 20
    return min(base * 2 ** (attempts - 1), 1800)
