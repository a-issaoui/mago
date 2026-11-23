"""End-to-end checks against real links. Run with:  pytest -m network"""

import itertools

import pytest

from mago import fetch, library, pipeline
from mago.links import detect
from mago.whisper_engine import Engine

pytestmark = pytest.mark.network

YT_VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # "Me at the zoo", 19 s, manual captions
YT_CHANNEL = "https://www.youtube.com/@jawed"
TT_PROFILE = "https://www.tiktok.com/@gobigsystems"


@pytest.fixture(scope="module")
def engine():
    return Engine("small", "auto")


def test_youtube_video_probe():
    preview = fetch.probe(detect(YT_VIDEO))
    assert preview["title"] == "Me at the zoo" and preview["thumb_url"].startswith("https://")
    assert preview["duration_s"] == 19


def test_youtube_channel_probe_and_listing(conn):
    preview = fetch.probe(detect(YT_CHANNEL))
    assert preview["title"] == "jawed" and preview["avatar_url"]
    source_id = library.add_source(conn, YT_CHANNEL, preview)
    result = library.sync_source(conn, source_id)
    assert result["new"] >= 1
    assert library.find_video(conn, "jNQXAC9IVRw")["title"] == "Me at the zoo"
    assert library.sync_source(conn, source_id)["new"] == 0  # re-sync adds nothing twice


def test_youtube_captions_end_to_end(conn, engine, tmp_path):
    source_id = library.add_source(conn, YT_VIDEO)
    video_id = library.sync_source(conn, source_id)["new_video_ids"][0]
    result = pipeline.process_video(conn, video_id, engine, tmp_path)
    assert (result["status"], result["method"]) == ("done", "captions")
    video = library.get_video(conn, video_id)
    assert video["published_at"].startswith("2005-04-2") and video["language"] == "en"
    assert library.search(conn, "elephants")[0]["video_id"] == video_id


def test_unavailable_video_is_skipped_not_retried(conn, engine, tmp_path):
    source_id = library.add_source(conn, "https://www.youtube.com/watch?v=aaaaaaaaaaa")
    video_id, _ = library.upsert_video(conn, source_id, "youtube", {"platform_video_id": "aaaaaaaaaaa", "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa"})
    assert pipeline.process_video(conn, video_id, engine, tmp_path)["status"] == "skipped"
    assert library.get_video(conn, video_id)["error"]


@pytest.mark.gpu
def test_tiktok_profile_listing_and_whisper(conn, engine, tmp_path):
    link = detect(TT_PROFILE)
    preview = fetch.probe(link)
    assert preview["handle"] == "@gobigsystems" and preview["thumb_url"]
    source_id = library.add_source(conn, TT_PROFILE, preview)
    listed = library.sync_source(conn, source_id, limit=8)
    assert listed["new"] == 8
    rows = conn.execute("SELECT id, duration_s FROM videos WHERE duration_s BETWEEN 5 AND 90 ORDER BY duration_s LIMIT 1").fetchall()
    result = pipeline.process_video(conn, rows[0]["id"], engine, tmp_path)
    assert (result["status"], result["method"]) == ("done", "whisper")
    assert result["segments"] >= 1 and not list(tmp_path.glob("*.mp4"))  # audio deleted
    print("device:", result["device"], "| text:", library.get_transcript(conn, rows[0]["id"])["text"][:200])
