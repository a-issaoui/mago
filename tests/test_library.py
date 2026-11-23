import json

import pytest

from mago import db, export, library

SEGMENTS = [
    {"start": 0.0, "end": 2.0, "text": "Welcome to the zoo."},
    {"start": 2.0, "end": 4.5, "text": "The elephants have really long trunks."},
    {"start": 10.0, "end": 12.0, "text": "And that's pretty much all there is to say."},
]


def add_video(conn, url="https://www.youtube.com/watch?v=jNQXAC9IVRw", video_id="jNQXAC9IVRw", title="Me at the zoo"):
    source_id = library.add_source(conn, url)
    return source_id, library.upsert_video(conn, source_id, "youtube", {"platform_video_id": video_id, "url": url, "title": title})[0]


def test_add_source_is_idempotent(conn):
    first = library.add_source(conn, "youtu.be/jNQXAC9IVRw")
    assert library.add_source(conn, "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=1") == first
    assert len(library.list_sources(conn)) == 1


def test_upsert_keeps_known_values_and_transcript(conn):
    source_id, video_id = add_video(conn)
    library.save_transcript(conn, video_id, SEGMENTS, "captions", "en")
    same_id, is_new = library.upsert_video(conn, source_id, "youtube", {"platform_video_id": "jNQXAC9IVRw", "url": "u", "title": None, "view_count": 5})
    video = library.get_video(conn, video_id)
    assert (same_id, is_new) == (video_id, False)
    assert (video["title"], video["view_count"], video["status"]) == ("Me at the zoo", 5, "done")
    assert len(library.get_segments(conn, video_id)) == 3


def test_single_video_moves_into_its_channel(conn):
    _, video_id = add_video(conn)
    channel_id = library.add_source(conn, "https://www.youtube.com/@jawed")
    library.upsert_video(conn, channel_id, "youtube", {"platform_video_id": "jNQXAC9IVRw", "url": "u"})
    assert library.get_video(conn, video_id)["source_id"] == channel_id
    assert [s["kind"] for s in library.list_sources(conn)] == ["channel"]


def test_search_highlights_and_filters(conn):
    _, video_id = add_video(conn)
    library.save_transcript(conn, video_id, SEGMENTS, "captions", "en")
    hits = library.search(conn, "elephant")  # prefix of "elephants"
    assert len(hits) == 1 and hits[0]["start"] == 2.0
    assert "<mark>elephants</mark>" in hits[0]["snippet"]
    assert library.search(conn, 'long "really long"')[0]["video_id"] == video_id
    assert library.search(conn, "elephants", platform="tiktok") == []
    assert library.search(conn, "giraffe") == []
    for odd in ['"', "AND OR", "a* (b", "trunks -zoo", "that's"]:
        library.search(conn, odd)  # never a syntax error


def test_retranscribing_replaces_the_search_index(conn):
    _, video_id = add_video(conn)
    library.save_transcript(conn, video_id, SEGMENTS, "captions", "en")
    library.save_transcript(conn, video_id, [{"start": 0, "end": 1, "text": "Only giraffes now."}], "whisper", "en")
    assert library.search(conn, "elephants") == []
    assert len(library.search(conn, "giraffes")) == 1


def test_deleting_a_source_removes_everything(conn):
    source_id, video_id = add_video(conn)
    library.save_transcript(conn, video_id, SEGMENTS, "captions", "en")
    conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
    assert conn.execute("SELECT count(*) FROM segments").fetchone()[0] == 0
    assert library.search(conn, "elephants") == []


def test_find_video_by_id_platform_id_or_link(conn):
    _, video_id = add_video(conn)
    for reference in (video_id, str(video_id), "jNQXAC9IVRw", "https://youtu.be/jNQXAC9IVRw"):
        assert library.find_video(conn, reference)["id"] == video_id
    assert library.get_transcript(conn, "nope") is None


def test_exports(conn):
    _, video_id = add_video(conn)
    library.save_transcript(conn, video_id, SEGMENTS, "captions", "en")
    video, segments = library.get_video(conn, video_id), library.get_segments(conn, video_id)
    assert export.render(video, segments, "txt").split("\n\n")[0] == "Welcome to the zoo. The elephants have really long trunks."
    assert "2\n00:00:02,000 --> 00:00:04,500\nThe elephants have really long trunks.\n" in export.render(video, segments, "srt")
    assert export.render(video, segments, "vtt").startswith("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n")
    assert len(json.loads(export.render(video, segments, "json"))["segments"]) == 3
    assert "**[0:10](https://www.youtube.com/watch?v=jNQXAC9IVRw&t=10s)**" in export.render(video, segments, "md")
    with pytest.raises(ValueError):
        export.render(video, segments, "pdf")


def test_settings(conn):
    assert db.get_settings(conn)["whisper_model"] == "small"
    db.set_setting(conn, "whisper_model", "medium")
    assert db.get_settings(conn)["whisper_model"] == "medium"
    with pytest.raises(KeyError):
        db.set_setting(conn, "nope", "1")
