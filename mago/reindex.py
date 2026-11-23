"""Rebuild passages, fingerprints and duplicate marks for every transcribed video.

Run with:  python -m mago.reindex     (safe to repeat)
"""

from . import db, duplicates, library


def main() -> None:
    conn = db.connect()
    ids = [row["id"] for row in conn.execute("SELECT id FROM videos WHERE status = 'done' ORDER BY published_at IS NULL, published_at, id")]
    prints = {}
    for video_id in ids:
        prints[video_id] = library.index_video(conn, video_id, library.get_segments(conn, video_id))
    conn.execute("UPDATE videos SET duplicate_of = NULL, duplicate_kind = NULL WHERE status = 'done'")
    found = sum(1 for video_id in ids if duplicates.mark(conn, video_id, prints[video_id]))
    marked = conn.execute("SELECT count(*) FROM videos WHERE duplicate_of IS NOT NULL AND status = 'done'").fetchone()[0]
    print(f"{len(ids)} videos indexed, {marked} marked as a repeat or clip of another ({found} found on their own pass)")


if __name__ == "__main__":
    main()
