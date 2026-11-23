"""Spot the same content under different video ids: re-uploads, cross-posts
between YouTube and TikTok, and short clips cut from a longer video.

Each transcript is reduced to a sample of its 6-word sequences. Two videos
that share most of that sample say the same words.
"""

import hashlib
import re
import sqlite3

SHINGLE_WORDS = 6
KEEP_ONE_IN = 3  # sampling: keeps the table small, still thousands of chances to match
MIN_WORDS = 40  # shorter transcripts ("thanks for watching") match by accident
SAME_SHARE = 0.8
SAME_LENGTH = 0.15  # durations within 15%: a repeat; otherwise the shorter one is a clip


def fingerprint(text: str) -> set[int]:
    words = re.findall(r"\w+", text.lower())
    if len(words) < MIN_WORDS:
        return set()
    hashes = set()
    for index in range(len(words) - SHINGLE_WORDS + 1):
        digest = hashlib.blake2b(" ".join(words[index:index + SHINGLE_WORDS]).encode(), digest_size=8).digest()
        value = int.from_bytes(digest, "big", signed=True)
        if value % KEEP_ONE_IN == 0:
            hashes.add(value)
    return hashes


def store(conn: sqlite3.Connection, video_id: int, text: str) -> set[int]:
    hashes = fingerprint(text)
    conn.execute("DELETE FROM fingerprints WHERE video_id = ?", (video_id,))
    conn.executemany("INSERT OR IGNORE INTO fingerprints(video_id, hash) VALUES (?, ?)", [(video_id, h) for h in hashes])
    return hashes


def _shared(conn: sqlite3.Connection, video_id: int, hashes: set[int]) -> dict[int, int]:
    counts: dict[int, int] = {}
    ordered = list(hashes)
    for start in range(0, len(ordered), 500):
        chunk = ordered[start:start + 500]
        marks = ",".join("?" * len(chunk))
        for row in conn.execute(
            f"SELECT video_id, count(*) AS n FROM fingerprints WHERE hash IN ({marks}) AND video_id != ? GROUP BY video_id",
            (*chunk, video_id),
        ):
            counts[row["video_id"]] = counts.get(row["video_id"], 0) + row["n"]
    return counts


def _kind(a: dict, b: dict) -> str:
    longer = max(a["duration_s"] or 0, b["duration_s"] or 0)
    if not longer:
        return "repeat"
    return "repeat" if abs((a["duration_s"] or 0) - (b["duration_s"] or 0)) <= SAME_LENGTH * longer else "clip"


def mark(conn: sqlite3.Connection, video_id: int, hashes: set[int]) -> dict | None:
    """Compare a freshly transcribed video with the library, both ways.
    Returns {"duplicate_of", "kind"} if this video repeats another one."""
    conn.execute("UPDATE videos SET duplicate_of = NULL, duplicate_kind = NULL WHERE id = ?", (video_id,))
    if not hashes:
        return None
    me = dict(conn.execute("SELECT id, duration_s, published_at FROM videos WHERE id = ?", (video_id,)).fetchone())
    found = None
    for other_id, shared in sorted(_shared(conn, video_id, hashes).items(), key=lambda item: -item[1]):
        other = dict(conn.execute("SELECT id, duration_s, published_at, duplicate_of FROM videos WHERE id = ?", (other_id,)).fetchone())
        theirs = conn.execute("SELECT count(*) FROM fingerprints WHERE video_id = ?", (other_id,)).fetchone()[0]
        mine_in_theirs, theirs_in_mine = shared / len(hashes), shared / max(theirs, 1)
        if mine_in_theirs < SAME_SHARE and theirs_in_mine < SAME_SHARE:
            continue
        kind = _kind(me, other)
        # Which one is the copy? A clip is the shorter one; of two equal videos, the later upload.
        if kind == "clip":
            i_am_the_copy = (me["duration_s"] or 0) < (other["duration_s"] or 0)
        else:
            i_am_the_copy = (me["published_at"] or "9", me["id"]) > (other["published_at"] or "9", other["id"])
        if i_am_the_copy and found is None:
            original = other["duplicate_of"] or other_id
            conn.execute("UPDATE videos SET duplicate_of = ?, duplicate_kind = ? WHERE id = ?", (original, kind, video_id))
            found = {"duplicate_of": original, "kind": kind}
        elif not i_am_the_copy and other["duplicate_of"] is None:
            conn.execute("UPDATE videos SET duplicate_of = ?, duplicate_kind = ? WHERE id = ?", (video_id, kind, other_id))
    return found


def repeat_upload(conn: sqlite3.Connection, video_id: int) -> int | None:
    """Before spending time on a newly listed video: is it a re-upload in the same
    channel (same title, same length to the second)? Returns the earlier video's id."""
    video = conn.execute("SELECT source_id, title, duration_s FROM videos WHERE id = ?", (video_id,)).fetchone()
    if not video or not video["duration_s"] or len((video["title"] or "").strip()) < 8:
        return None
    row = conn.execute(
        "SELECT id FROM videos WHERE source_id = ? AND id != ? AND lower(trim(title)) = lower(trim(?)) "
        "AND abs(duration_s - ?) <= 1 AND duplicate_of IS NULL ORDER BY id LIMIT 1",
        (video["source_id"], video_id, video["title"], video["duration_s"]),
    ).fetchone()
    return row["id"] if row else None
