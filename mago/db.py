"""SQLite storage: schema, connection and settings. Full-text search uses FTS5."""

import sqlite3
from pathlib import Path

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY,
    platform TEXT NOT NULL CHECK (platform IN ('youtube','tiktok')),
    kind TEXT NOT NULL CHECK (kind IN ('video','channel','playlist','profile')),
    url TEXT NOT NULL UNIQUE,
    handle TEXT,
    title TEXT,
    avatar_path TEXT,
    banner_path TEXT,
    video_count INTEGER,
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    platform_video_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    published_at TEXT,
    duration_s REAL,
    view_count INTEGER,
    thumb_path TEXT,
    thumb_url_original TEXT,
    thumb_blur TEXT,
    shape TEXT NOT NULL DEFAULT 'wide' CHECK (shape IN ('wide','tall')),
    language TEXT,
    status TEXT NOT NULL DEFAULT 'listed' CHECK (status IN
        ('listed','queued','captions','downloading','transcribing','done','failed','skipped')),
    error TEXT,
    method TEXT CHECK (method IN ('captions','whisper')),
    progress REAL NOT NULL DEFAULT 0,
    transcribed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (platform, platform_video_id)
);
CREATE INDEX IF NOT EXISTS videos_source ON videos(source_id, published_at);
CREATE INDEX IF NOT EXISTS videos_status ON videos(status);
CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    start_s REAL NOT NULL,
    end_s REAL NOT NULL,
    text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS segments_video ON segments(video_id, start_s);
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
    text, content='segments', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
    INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('list','transcribe')),
    priority INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','done','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_try_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT,
    log TEXT
);
CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state, next_try_at);
CREATE INDEX IF NOT EXISTS jobs_video ON jobs(video_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- What the worker is doing right now (device, heartbeat), for the Activity screen.
CREATE TABLE IF NOT EXISTS runtime (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    """Open the database (creating it if needed). The API and the worker are
    separate processes, so use WAL and wait on locks instead of failing."""
    if path is None:
        config.ensure_dirs()
        path = config.DB_PATH
    conn = sqlite3.connect(str(path), timeout=15, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=15000")
    conn.executescript(SCHEMA)
    return conn


def get_settings(conn: sqlite3.Connection) -> dict[str, str]:
    values = dict(config.DEFAULT_SETTINGS)
    values.update({row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM settings")})
    return values


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    if key not in config.DEFAULT_SETTINGS:
        raise KeyError(f"unknown setting: {key}")
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )


def set_runtime(conn: sqlite3.Connection, **values: object) -> None:
    conn.executemany(
        "INSERT INTO runtime(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [(key, str(value)) for key, value in values.items()],
    )


def get_runtime(conn: sqlite3.Connection) -> dict[str, str]:
    return {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM runtime")}
