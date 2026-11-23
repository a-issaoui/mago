import pytest

from mago import fetch, jobs, library, pipeline, thumbs
from mago.worker import Worker

URL = "https://www.youtube.com/@jawed"
LISTING = [{"platform_video_id": f"vid{i:08d}", "url": f"https://www.youtube.com/watch?v=vid{i:08d}", "title": f"Video {i}"} for i in range(3)]


@pytest.fixture
def worker(conn, monkeypatch):
    monkeypatch.setattr(fetch, "probe", lambda link: {"title": "jawed", "handle": "@jawed", "avatar_url": None, "banner_url": None})
    monkeypatch.setattr(fetch, "list_videos", lambda link, limit=None: iter(LISTING))
    monkeypatch.setattr(thumbs, "save_missing_thumbs", lambda conn, source_id=None: 0)
    monkeypatch.setattr(thumbs, "save_video_thumb", lambda conn, video: False)
    instance = Worker(conn)
    monkeypatch.setattr(instance, "_pause", lambda platform: None)
    return instance


def fake_process(outcomes):
    def process(conn, video_id, engine, audio_dir=None):
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        library.save_transcript(conn, video_id, [{"start": 0, "end": 1, "text": "hello"}], "captions", "en")
        return {"status": "done", "method": "captions", "segments": 1, "device": None}
    return process


def statuses(conn):
    return [row["status"] for row in conn.execute("SELECT status FROM videos ORDER BY id")]


def test_listing_queues_every_new_video_once(conn, worker):
    source_id = library.add_source(conn, URL)
    jobs.enqueue_list(conn, source_id)
    assert jobs.enqueue_list(conn, source_id) == 1  # no duplicate listing job
    assert worker.step()
    assert statuses(conn) == ["queued"] * 3
    jobs.enqueue_list(conn, source_id)  # re-sync
    worker.step()
    assert conn.execute("SELECT count(*) FROM jobs WHERE kind = 'transcribe'").fetchone()[0] == 3


def test_rate_limit_waits_then_other_errors_fail_after_retries(conn, worker, monkeypatch):
    source_id = library.add_source(conn, URL)
    jobs.enqueue_list(conn, source_id)
    worker.step()
    outcomes = [fetch.RateLimited("HTTP Error 429"), "ok", "ok"] + [RuntimeError("boom")] * jobs.MAX_ATTEMPTS
    monkeypatch.setattr(pipeline, "process_video", fake_process(outcomes))
    worker.step()  # video 1: rate limited → back in the queue, not due yet
    assert statuses(conn)[0] == "queued"
    assert conn.execute("SELECT next_try_at > datetime('now') FROM jobs WHERE video_id = 1").fetchone()[0] == 1
    worker.step(), worker.step()
    assert statuses(conn) == ["queued", "done", "done"]
    assert not worker.step()  # nothing due
    for _ in range(jobs.MAX_ATTEMPTS):
        conn.execute("UPDATE jobs SET next_try_at = datetime('now', '-1 second') WHERE state = 'pending'")
        worker.step()
    video = library.get_video(conn, 1)
    assert (video["status"], video["error"]) == ("failed", "boom")
    jobs.enqueue_transcribe(conn, 1)  # Retry button
    assert library.get_video(conn, 1)["status"] == "queued"


def test_restart_recovers_interrupted_jobs(conn, worker):
    source_id = library.add_source(conn, URL)
    jobs.enqueue_list(conn, source_id)
    worker.step()
    job = jobs.claim(conn)
    library.set_status(conn, job["video_id"], "transcribing", progress=0.4)
    assert jobs.recover(conn) == 1
    assert statuses(conn) == ["queued"] * 3 and jobs.claim(conn)["id"] == job["id"]


def test_scheduled_resync_only_queues_stale_channels(conn):
    channel = library.add_source(conn, URL)
    single = library.add_source(conn, "https://youtu.be/jNQXAC9IVRw")
    fresh = library.add_source(conn, "https://www.youtube.com/@fresh")
    conn.execute("UPDATE sources SET last_synced_at = datetime('now', '-30 hours') WHERE id IN (?, ?)", (channel, single))
    conn.execute("UPDATE sources SET last_synced_at = datetime('now', '-1 hours') WHERE id = ?", (fresh,))
    assert jobs.enqueue_due_resyncs(conn, 0) == 0  # off
    assert jobs.enqueue_due_resyncs(conn, 24) == 1
    assert conn.execute("SELECT source_id FROM jobs").fetchall()[0]["source_id"] == channel
    assert jobs.enqueue_due_resyncs(conn, 24) == 0  # already queued
