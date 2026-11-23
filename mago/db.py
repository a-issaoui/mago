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
    channel_name TEXT,
    channel_url TEXT,
    channel_uid TEXT,
    duplicate_of INTEGER REFERENCES videos(id) ON DELETE SET NULL,
    duplicate_kind TEXT CHECK (duplicate_kind IN ('repeat','clip')),
    chapters TEXT,
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
-- Passages: a few caption lines joined, searched together with the video title. A phrase that
-- runs across two caption lines is found here, and plain-language questions rank better.
CREATE TABLE IF NOT EXISTS passages (
    id INTEGER PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    start_s REAL NOT NULL,
    end_s REAL NOT NULL,
    kind TEXT NOT NULL DEFAULT 'speech' CHECK (kind IN ('speech','description')),
    title TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS passages_video ON passages(video_id, start_s);
CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
    title, text, content='passages', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN
    INSERT INTO passages_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
END;
CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN
    INSERT INTO passages_fts(passages_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
END;
-- A sample of each transcript's word sequences, to spot the same content under another video id.
CREATE TABLE IF NOT EXISTS fingerprints (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    hash INTEGER NOT NULL,
    PRIMARY KEY (hash, video_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS fingerprints_video ON fingerprints(video_id);
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
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_per_video ON jobs(video_id)
    WHERE kind = 'transcribe' AND state IN ('pending','running');
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_per_source ON jobs(source_id)
    WHERE kind = 'list' AND state IN ('pending','running');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Where the owner stopped in each video. Its own table (no trigger), so saving the position every
-- few seconds while watching doesn't make every screen refresh.
CREATE TABLE IF NOT EXISTS positions (
    video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    seconds REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- A counter bumped by every change to what the screens show (not by the worker's heartbeat), so the
-- interface can refresh the moment something changes, whoever changed it.
CREATE TABLE IF NOT EXISTS revision (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL);
INSERT OR IGNORE INTO revision(id, n) VALUES (1, 0);
CREATE TRIGGER IF NOT EXISTS revision_sources_insert AFTER INSERT ON sources BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_sources_update AFTER UPDATE ON sources BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_sources_delete AFTER DELETE ON sources BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_videos_insert AFTER INSERT ON videos BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_videos_update AFTER UPDATE ON videos BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_videos_delete AFTER DELETE ON videos BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_settings_insert AFTER INSERT ON settings BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_settings_update AFTER UPDATE ON settings BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_settings_delete AFTER DELETE ON settings BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
-- Collections group videos across channels; highlights are passages the owner saved, with a note.
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collection_videos (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, video_id)
);
CREATE INDEX IF NOT EXISTS collection_videos_video ON collection_videos(video_id);
CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    start_s REAL NOT NULL,
    end_s REAL NOT NULL,
    text TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS highlights_video ON highlights(video_id, start_s);
CREATE TRIGGER IF NOT EXISTS revision_collections_insert AFTER INSERT ON collections BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_collections_update AFTER UPDATE ON collections BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_collections_delete AFTER DELETE ON collections BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_collection_videos_insert AFTER INSERT ON collection_videos BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_collection_videos_update AFTER UPDATE ON collection_videos BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_collection_videos_delete AFTER DELETE ON collection_videos BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_highlights_insert AFTER INSERT ON highlights BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_highlights_update AFTER UPDATE ON highlights BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS revision_highlights_delete AFTER DELETE ON highlights BEGIN UPDATE revision SET n = n + 1 WHERE id = 1; END;
-- One row per running MCP server (each Claude session starts its own), so the interface can show
-- whether Claude is connected and what it last asked for.
CREATE TABLE IF NOT EXISTS mcp_sessions (
    pid INTEGER PRIMARY KEY,
    started_at INTEGER NOT NULL,
    last_call_at INTEGER,
    last_tool TEXT,
    calls INTEGER NOT NULL DEFAULT 0
);
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
    _migrate(conn)
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Columns added after the first version (CREATE TABLE IF NOT EXISTS won't add them)."""
    have = {row["name"] for row in conn.execute("PRAGMA table_info(videos)")}
    for column, kind in (("channel_name", "TEXT"), ("channel_url", "TEXT"), ("channel_uid", "TEXT"),
                         ("duplicate_of", "INTEGER REFERENCES videos(id) ON DELETE SET NULL"), ("duplicate_kind", "TEXT"),
                         ("chapters", "TEXT")):
        if column not in have:
            try:
                conn.execute(f"ALTER TABLE videos ADD COLUMN {column} {kind}")
            except sqlite3.OperationalError:  # the other process added it first
                pass


def backup(conn: sqlite3.Connection, keep: int = 7) -> Path | None:
    """One copy of the library per day in data/backups, keeping the newest `keep`.
    Returns the new file, or None if today's copy already exists."""
    import datetime

    config.BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    target = config.BACKUPS_DIR / f"mago-{datetime.date.today():%Y%m%d}.db"
    if target.exists():
        return None
    partial = target.with_suffix(".partial")
    copy = sqlite3.connect(str(partial))
    try:
        conn.backup(copy)  # a consistent snapshot, even while the worker is writing
    finally:
        copy.close()
    partial.rename(target)
    for old in sorted(config.BACKUPS_DIR.glob("mago-*.db"))[:-keep]:
        old.unlink()
    return target


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
