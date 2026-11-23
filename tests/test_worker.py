import time

import pytest

from mago import db, fetch, jobs, library, pipeline, thumbs
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
    monkeypatch.setattr(instance, "_wait_between", lambda platform: None)
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


def test_other_errors_fail_after_retries_and_can_be_retried(conn, worker, monkeypatch):
    source_id = library.add_source(conn, URL)
    jobs.enqueue_list(conn, source_id)
    worker.step()
    monkeypatch.setattr(pipeline, "process_video", fake_process([RuntimeError("boom")] * jobs.MAX_ATTEMPTS + ["ok", "ok"]))
    worker.step()
    assert statuses(conn)[0] == "queued"  # waiting to retry, not due yet
    for _ in range(jobs.MAX_ATTEMPTS - 1):
        conn.execute("UPDATE jobs SET next_try_at = datetime('now', '-1 second') WHERE state = 'pending' AND video_id = 1")
        worker.step()
    video = library.get_video(conn, 1)
    assert (video["status"], video["error"]) == ("failed", "boom")
    worker.step(), worker.step()
    assert statuses(conn) == ["failed", "done", "done"]
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


def test_rate_limit_pauses_the_whole_platform_without_using_up_tries(conn, worker, monkeypatch):
    source_id = library.add_source(conn, URL)
    jobs.enqueue_list(conn, source_id)
    worker.step()
    tiktok = library.add_source(conn, "https://www.tiktok.com/@a/video/123")
    tiktok_video, _ = library.upsert_video(conn, tiktok, "tiktok", {"platform_video_id": "123", "url": "u"})
    jobs.enqueue_transcribe(conn, tiktok_video)
    outcomes = [fetch.RateLimited("429"), "ok", fetch.RateLimited("429"), "ok"]
    monkeypatch.setattr(pipeline, "process_video", fake_process(outcomes))

    def held():
        rows = conn.execute(
            "SELECT v.platform, count(*) AS n, max(j.attempts) AS tries, "
            "max(strftime('%s', j.next_try_at) - strftime('%s', 'now')) AS wait FROM jobs j JOIN videos v ON v.id = j.video_id "
            "WHERE j.state = 'pending' AND j.next_try_at > datetime('now') GROUP BY v.platform").fetchall()
        return [(row["platform"], row["n"], row["tries"], row["wait"]) for row in rows]

    worker.step()  # the first YouTube video is refused
    assert [h[:3] for h in held()] == [("youtube", 3, 0)] and 100 < held()[0][3] <= 120
    assert "slow down" in library.get_video(conn, 1)["error"]
    assert int(db.get_runtime(conn)["pause_youtube_until"]) > time.time()
    worker.step()  # TikTok is not held back
    assert library.get_video(conn, tiktok_video)["status"] == "done"
    conn.execute("UPDATE jobs SET next_try_at = datetime('now', '-1 second') WHERE state = 'pending'")
    worker.step()  # refused again: a longer pause, and still no try used
    assert [h[:3] for h in held()] == [("youtube", 3, 0)] and 200 < held()[0][3] <= 240
    conn.execute("UPDATE jobs SET next_try_at = datetime('now', '-1 second') WHERE state = 'pending'")
    worker.step()  # works again: the pause is cleared
    assert statuses(conn)[0] == "done" and db.get_runtime(conn)["pause_youtube_until"] == "0"


def test_youtube_hourly_budget(conn, worker, monkeypatch):
    source_id = library.add_source(conn, URL)
    jobs.enqueue_list(conn, source_id)
    worker.step()
    db.set_setting(conn, "youtube_per_hour", "2")
    monkeypatch.setattr(pipeline, "process_video", fake_process(["ok", "ok", "ok"]))
    worker.step(), worker.step(), worker.step()
    assert statuses(conn) == ["done", "done", "queued"]  # the third waits for the hour to roll over
    runtime = db.get_runtime(conn)
    assert runtime["pause_youtube_reason"] == "budget" and int(runtime["pause_youtube_until"]) > time.time() + 3000
    assert conn.execute("SELECT attempts FROM jobs WHERE state = 'pending'").fetchone()[0] == 0
