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


def test_thumbnail_links_must_be_public_https():
    from mago import thumbs

    for bad in ("http://i.ytimg.com/a.jpg", "https://127.0.0.1/a.jpg", "https://localhost/a.jpg", "file:///etc/passwd", "https://192.168.1.1/x"):
        with pytest.raises(ValueError):
            thumbs._check_public(bad)
    assert thumbs._make_thumb({"id": 1, "platform": "youtube", "platform_video_id": "../../x", "thumb_url_original": "https://i.ytimg.com/a.jpg"}) is None


def test_no_duplicate_active_jobs(conn):
    from mago import jobs

    _, video_id = add_video(conn)
    assert jobs.enqueue_transcribe(conn, video_id) == jobs.enqueue_transcribe(conn, video_id)
    with pytest.raises(Exception):
        conn.execute("INSERT INTO jobs(video_id, kind) VALUES (?, 'transcribe')", (video_id,))


LONG = ("the quick brown fox jumps over the lazy dog while seven wise owls watch from an old oak tree and "
        "count every star that falls into the quiet river below the hill where nobody ever goes at night").split()


def lines(words, start=0.0):
    return [{"start": start + i, "end": start + i + 1, "text": " ".join(words[i:i + 6])} for i in range(0, len(words), 6)]


def test_same_words_under_another_id_are_marked_and_left_out_of_search(conn):
    source_id = library.add_source(conn, "https://www.youtube.com/@jawed")
    ids = []
    for key, duration, published in (("aaaaaaaaaa1", 600, "2024-01-01"), ("aaaaaaaaaa2", 600, "2025-01-01"), ("aaaaaaaaaa3", 30, "2025-02-01")):
        ids.append(library.upsert_video(conn, source_id, "youtube", {
            "platform_video_id": key, "url": f"https://www.youtube.com/watch?v={key}", "title": key,
            "duration_s": duration, "published_at": published})[0])
    full = LONG * 3 + "and then a part that only the long video has which goes on for quite a while longer than that".split() * 4
    library.save_transcript(conn, ids[0], lines(full), "captions", "en")
    library.save_transcript(conn, ids[1], lines(full), "captions", "en")  # re-upload
    library.save_transcript(conn, ids[2], lines(LONG * 3), "captions", "en")  # a clip of it
    marks = {row["id"]: (row["duplicate_of"], row["duplicate_kind"]) for row in conn.execute("SELECT id, duplicate_of, duplicate_kind FROM videos")}
    assert marks == {ids[0]: (None, None), ids[1]: (ids[0], "repeat"), ids[2]: (ids[0], "clip")}
    assert {hit["video_id"] for hit in library.search(conn, "owls")} == {ids[0]}
    assert len({hit["video_id"] for hit in library.search(conn, "owls", include_duplicates=True)}) == 3
    library.save_transcript(conn, ids[1], lines("something entirely different now " .split() * 20), "whisper", "en")
    assert library.get_video(conn, ids[1])["duplicate_of"] is None  # re-transcribed: no longer a copy


def test_reuploads_are_not_transcribed_twice(conn, monkeypatch):
    from mago import fetch

    listing = [
        {"platform_video_id": "1", "url": "u1", "title": "How to plant a tree in spring", "duration_s": 61},
        {"platform_video_id": "2", "url": "u2", "title": "how to plant a tree in spring ", "duration_s": 61.4},
        {"platform_video_id": "3", "url": "u3", "title": "How to plant a tree in spring", "duration_s": 95},  # same title, other video
        {"platform_video_id": "4", "url": "u4", "title": "Part 2", "duration_s": 61},
        {"platform_video_id": "5", "url": "u5", "title": "Part 2", "duration_s": 61},  # too short a title to judge
    ]
    monkeypatch.setattr(fetch, "list_videos", lambda link, limit=None, **_: iter(listing))
    source_id = library.add_source(conn, "https://www.tiktok.com/@gardener")
    result = library.sync_source(conn, source_id)
    assert (result["new"], result["repeats"], len(result["new_video_ids"])) == (5, 1, 4)
    repeat = conn.execute("SELECT status, duplicate_of, error FROM videos WHERE platform_video_id = '2'").fetchone()
    assert repeat["status"] == "skipped" and repeat["duplicate_of"] and "not transcribed again" in repeat["error"]
    db.set_setting(conn, "skip_repeats", "0")
    listing.append({"platform_video_id": "6", "url": "u6", "title": "How to plant a tree in spring", "duration_s": 61})
    assert library.sync_source(conn, source_id)["repeats"] == 0


def test_passage_search_finds_phrases_across_lines_and_ranks_loosely(conn):
    _, video_id = add_video(conn)
    library.save_transcript(conn, video_id, [
        {"start": 0, "end": 2, "text": "The cool thing about these guys is that they have really"},
        {"start": 2, "end": 4, "text": "really long trunks and that is cool."}], "captions", "en")
    assert library.search(conn, "guys trunks") == []  # the two words are in different caption lines
    hit = library.search_passages(conn, "guys trunks")[0]
    assert (hit["video_id"], hit["match"]) == (video_id, "all words")
    assert library.search_passages(conn, "zoo")[0]["video_id"] == video_id  # the title is searched too
    assert library.search_passages(conn, "trunk giraffes")[0]["match"] == "some words"  # stemmed, any word
    assert library.search_passages(conn, "trunks", published_after="2030-01-01") == []
    assert library.search_passages(conn, "xylophone") == []


def test_whisper_hint_carries_the_names():
    from mago.pipeline import whisper_hint

    hint = whisper_hint({"channel_name": "TikTok", "title": "one TikTok DM sent @Chef Moe to the grocery store",
                         "description": "#fyp see https://example.com/x for more"})
    assert "Chef Moe" in hint and "http" not in hint and "#" not in hint and "@" not in hint
    assert whisper_hint({"title": None, "description": ""}) is None
