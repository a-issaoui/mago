import pytest
from fastapi.testclient import TestClient

from mago import api, db, fetch, library


@pytest.fixture
def client(monkeypatch):
    with db.connect() as conn:
        conn.executescript("DELETE FROM sources; DELETE FROM jobs; DELETE FROM settings; DELETE FROM runtime;")
    api._preview_cache.clear()
    monkeypatch.setattr(fetch, "probe", lambda link: {
        "platform": link.platform, "kind": link.kind, "url": link.url, "title": "jawed", "handle": "@jawed",
        "channel": "jawed", "thumb_url": None, "avatar_url": None, "banner_url": None, "video_count": 1, "duration_s": None})
    return TestClient(api.app, headers={"x-mago": "1"})


def seed(text="The elephants have really long trunks."):
    conn = db.connect()
    source_id = library.add_source(conn, "https://www.youtube.com/@jawed")
    video_id, _ = library.upsert_video(conn, source_id, "youtube", {
        "platform_video_id": "jNQXAC9IVRw", "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "title": "Me at the zoo"})
    library.save_transcript(conn, video_id, [{"start": 2.0, "end": 4.5, "text": text}], "captions", "en")
    conn.close()
    return source_id, video_id


def test_preview_then_add_queues_a_listing(client):
    assert client.post("/api/preview", json={"url": "https://vimeo.com/1"}).status_code == 422
    preview = client.post("/api/preview", json={"url": "youtube.com/@jawed"}).json()
    assert (preview["kind"], preview["title"], preview["existing_source_id"]) == ("channel", "jawed", None)
    added = client.post("/api/sources", json={"url": "youtube.com/@jawed"})
    assert added.status_code == 201 and added.json()["listing"] is True
    again = client.post("/api/sources", json={"url": "https://www.youtube.com/@jawed/videos"}).json()
    assert again["id"] == added.json()["id"]
    assert client.post("/api/preview", json={"url": "youtube.com/@jawed"}).json()["existing_source_id"] == again["id"]
    assert client.get("/api/activity").json()["listing"][0]["id"] == again["id"]


def test_library_video_search_and_export(client):
    source_id, video_id = seed()
    assert client.get("/api/sources").json()[0]["videos_done"] == 1
    assert client.get(f"/api/sources/{source_id}").json()["counts"] == {"done": 1}
    listed = client.get("/api/videos", params={"source_id": source_id, "status": "done", "q": "zoo"}).json()
    assert listed["total"] == 1 and listed["items"][0]["id"] == video_id
    assert client.get("/api/videos", params={"q": "100%_"}).json()["total"] == 0
    assert client.get("/api/videos", params={"sort": "recent"}).json()["total"] == 1
    page = client.get(f"/api/videos/{video_id}").json()
    assert page["video"]["title"] == "Me at the zoo" and page["segments"][0]["start"] == 2.0
    hit = client.get("/api/search", params={"q": "elephants"}).json()["items"][0]
    assert hit["video_id"] == video_id and "<mark>" in hit["snippet"]
    srt = client.get(f"/api/videos/{video_id}/export", params={"format": "srt"})
    assert "00:00:02,000 --> 00:00:04,500" in srt.text and "youtube_jNQXAC9IVRw.srt" in srt.headers["content-disposition"]
    assert client.get(f"/api/videos/{video_id}/export", params={"format": "exe"}).status_code == 422
    assert client.get("/api/videos/999").status_code == 404


def test_retry_sync_delete(client):
    source_id, video_id = seed()
    assert client.post(f"/api/videos/{video_id}/retry").status_code == 200
    assert client.get("/api/activity").json()["up_next"][0]["id"] == video_id
    assert client.post(f"/api/sources/{source_id}/sync").status_code == 200
    assert client.delete(f"/api/sources/{source_id}").status_code == 204
    assert client.get("/api/sources").json() == []
    assert client.get("/api/search", params={"q": "elephants"}).json()["items"] == []
    assert client.post("/api/sources/999/sync").status_code == 404


def test_system_gives_the_mcp_command_for_this_install(client):
    import sys

    command = client.get("/api/system").json()["mcp_command"]
    assert command.endswith(f"-- {sys.executable} -m mago.mcp_server")


def test_env_file_fills_in_only_what_is_not_set(tmp_path, monkeypatch):
    from mago import config

    monkeypatch.setenv("MAGO_TEST_SET", "kept")
    monkeypatch.delenv("MAGO_TEST_NEW", raising=False)
    env = tmp_path / ".env"
    env.write_text("# a comment\nMAGO_TEST_SET=changed\nMAGO_TEST_NEW='from file'\n\nnot a setting\n")
    config._load_env_file(env)
    import os

    assert os.environ["MAGO_TEST_SET"] == "kept" and os.environ.pop("MAGO_TEST_NEW") == "from file"


def test_settings_are_validated(client):
    assert client.put("/api/settings", json={"whisper_model": "medium", "tiktok_delay_s": 6}).json()["tiktok_delay_s"] == "6"
    assert client.put("/api/settings", json={"whisper_model": "large-v3"}).status_code == 422
    assert client.put("/api/settings", json={"tiktok_delay_s": -1}).status_code == 422


def test_media_does_not_expose_the_database(client):
    assert client.get("/media/mago.db").status_code == 404
    assert client.get("/media/thumbs/../mago.db").status_code == 404


def test_writes_need_the_app_header_and_a_known_host(client):
    assert TestClient(api.app).post("/api/retry-failed").status_code == 403  # what a cross-site page could send
    assert client.post("/api/retry-failed", headers={"x-mago": "1"}).status_code == 200
    assert client.get("/api/sources", headers={"host": "evil.example"}).status_code == 400  # DNS rebinding


def test_adding_a_video_already_in_a_channel_returns_that_channel(client):
    source_id, _ = seed()
    added = client.post("/api/sources", json={"url": "https://youtu.be/jNQXAC9IVRw"}).json()
    assert added["id"] == source_id and len(client.get("/api/sources").json()) == 1


def test_pause_and_channel_export(client):
    source_id, video_id = seed()
    assert client.post("/api/queue/pause", json={"platform": "all", "paused": True}).json() == {"paused": ["tiktok", "youtube"]}
    assert client.get("/api/activity").json()["paused"] == ["tiktok", "youtube"]
    assert client.post("/api/queue/pause", json={"platform": "tiktok", "paused": False}).json() == {"paused": ["youtube"]}
    client.post("/api/queue/pause", json={"platform": "all", "paused": False})
    text = client.get(f"/api/sources/{source_id}/export", params={"format": "txt"})
    assert "Me at the zoo" in text.text and "elephants" in text.text and "jawed.txt" in text.headers["content-disposition"]
    assert client.get(f"/api/sources/{source_id}/export", params={"format": "md"}).text.startswith("# @jawed")
    assert len(client.get(f"/api/sources/{source_id}/export", params={"format": "json"}).json()["videos"]) == 1
    archive = client.get(f"/api/sources/{source_id}/export", params={"format": "zip"})
    import io, zipfile
    names = zipfile.ZipFile(io.BytesIO(archive.content)).namelist()
    assert len(names) == 2 and all(name.startswith("jawed/") and ".." not in name for name in names)


def test_long_lists_come_in_pages(client):
    conn = db.connect()
    source_id = library.add_source(conn, "https://www.youtube.com/@jawed")
    for index in range(25):
        video_id, _ = library.upsert_video(conn, source_id, "youtube", {
            "platform_video_id": f"vid{index:08d}", "url": f"https://www.youtube.com/watch?v=vid{index:08d}", "title": f"Video {index}"})
        library.save_transcript(conn, video_id, [{"start": float(index), "end": index + 1.0, "text": f"walrus number {index}"}], "captions", "en")
        from mago import jobs
        jobs.enqueue_transcribe(conn, video_id)
    conn.close()
    first = client.get("/api/videos", params={"source_id": source_id, "limit": 10}).json()
    last = client.get("/api/videos", params={"source_id": source_id, "limit": 10, "offset": 20}).json()
    assert (first["total"], len(first["items"]), len(last["items"])) == (25, 10, 5)
    assert not {v["id"] for v in first["items"]} & {v["id"] for v in last["items"]}
    page1 = client.get("/api/search", params={"q": "walrus", "limit": 10, "include": 1}).json()
    page3 = client.get("/api/search", params={"q": "walrus", "limit": 10, "offset": 20}).json()
    assert (len(page1["items"]), page1["has_more"], len(page3["items"]), page3["has_more"]) == (10, True, 5, False)
    queue = client.get("/api/activity", params={"next_limit": 10, "next_offset": 20}).json()
    assert (queue["queued"], len(queue["up_next"])) == (25, 5)


def test_revision_moves_on_real_changes_only(client):
    read = lambda: client.get("/api/activity").json()["revision"]
    start = read()
    conn = db.connect()
    db.set_runtime(conn, heartbeat=123)  # the worker's heartbeat is not a change worth a refresh
    assert read() == start
    source_id, video_id = seed()
    after_seed = read()
    assert after_seed > start
    client.put("/api/settings", json={"youtube_delay_s": 7})
    after_setting = read()
    assert after_setting > after_seed
    library.set_status(conn, video_id, "transcribing", progress=0.5)
    assert read() > after_setting
    conn.close()


def test_position_continue_chapters_and_stats(client):
    source_id, video_id = seed()
    conn = db.connect()
    conn.execute("UPDATE videos SET duration_s = 600, chapters = ? WHERE id = ?",
                 ('[{"start": 0, "title": "Intro"}, {"start": 120, "title": "Trunks"}]', video_id))
    conn.close()
    assert client.get("/api/videos", params={"sort": "continue"}).json()["total"] == 0
    assert client.put(f"/api/videos/{video_id}/position", json={"seconds": 130.5}).status_code == 204
    page = client.get(f"/api/videos/{video_id}").json()["video"]
    assert page["position_s"] == 130.5 and [c["title"] for c in page["chapters"]] == ["Intro", "Trunks"]
    going = client.get("/api/videos", params={"sort": "continue"}).json()
    assert going["total"] == 1 and going["items"][0]["position_s"] == 130.5
    client.put(f"/api/videos/{video_id}/position", json={"seconds": 595})  # watched to the end: no longer "continue"
    assert client.get("/api/videos", params={"sort": "continue"}).json()["total"] == 0
    assert client.put("/api/videos/999/position", json={"seconds": 1}).status_code == 404
    numbers = client.get("/api/stats").json()
    assert numbers["totals"]["videos"] == 1 and numbers["totals"]["words"] == 6 and numbers["totals"]["from_captions"] == 1
    assert numbers["channels"][0]["done"] == 1 and any(term["term"] == "elephants" for term in numbers["terms"])


def test_backup_once_a_day(tmp_path, monkeypatch):
    from mago import config

    monkeypatch.setattr(config, "BACKUPS_DIR", tmp_path)
    conn = db.connect()
    made = db.backup(conn)
    assert made and made.stat().st_size > 0 and db.backup(conn) is None
    import sqlite3
    assert sqlite3.connect(made).execute("SELECT count(*) FROM sources").fetchone()[0] >= 0
    conn.close()


def test_collections_and_highlights(client):
    source_id, video_id = seed()
    made = client.post("/api/collections", json={"name": "  Local   SEO "})
    assert made.status_code == 201 and made.json()["name"] == "Local SEO"
    collection_id = made.json()["id"]
    assert client.post("/api/collections", json={"name": "local seo"}).json()["id"] == collection_id  # same name, same collection
    assert client.post(f"/api/collections/{collection_id}/videos", json={"video_id": video_id}).status_code == 204
    client.post(f"/api/collections/{collection_id}/videos", json={"video_id": video_id})  # twice is harmless
    assert client.get("/api/collections").json()[0]["videos"] == 1
    assert client.get("/api/videos", params={"collection_id": collection_id}).json()["total"] == 1
    assert client.get(f"/api/videos/{video_id}").json()["video"]["collection_ids"] == [collection_id]
    assert client.put(f"/api/collections/{collection_id}", json={"name": "Zoo"}).json()["name"] == "Zoo"
    assert client.post(f"/api/collections/999/videos", json={"video_id": video_id}).status_code == 404

    # A collection can hold other collections, one level deep, and counts their videos as its own.
    folder = client.post("/api/collections", json={"name": "Learning"}).json()
    assert client.put(f"/api/collections/{collection_id}", json={"parent_id": folder["id"]}).json()["parent_id"] == folder["id"]
    listed = {c["name"]: c for c in client.get("/api/collections").json()}
    assert listed["Learning"]["videos"] == 1 and listed["Learning"]["children"] == 1 and listed["Zoo"]["name"] == "Zoo"
    assert client.get("/api/videos", params={"collection_id": folder["id"]}).json()["total"] == 1
    inner = client.post("/api/collections", json={"name": "Inner", "parent_id": folder["id"]}).json()
    assert inner["parent_id"] == folder["id"]
    assert client.put(f"/api/collections/{folder['id']}", json={"parent_id": folder["id"]}).status_code == 422  # inside itself
    assert client.put(f"/api/collections/{folder['id']}", json={"parent_id": inner["id"]}).status_code == 422   # a second level
    assert client.post("/api/collections", json={"name": "Deeper", "parent_id": inner["id"]}).status_code == 422
    assert client.put(f"/api/collections/{inner['id']}", json={"parent_id": 999}).status_code == 404
    assert client.put(f"/api/collections/{inner['id']}", json={"parent_id": None}).json()["parent_id"] is None  # back to the top
    assert client.put(f"/api/collections/{inner['id']}", json={"name": "Renamed"}).json()["parent_id"] is None
    assert client.delete(f"/api/collections/{folder['id']}").status_code == 204  # what was inside moves to the top
    assert client.get(f"/api/collections/{collection_id}").json()["parent_id"] is None

    saved = client.post(f"/api/videos/{video_id}/highlights", json={"start_s": 2, "end_s": 4.5, "text": "really   long trunks", "note": "use this"})
    highlight_id = saved.json()["id"]
    page = client.get(f"/api/videos/{video_id}").json()["video"]["highlights"]
    assert page == [{"id": highlight_id, "start_s": 2.0, "end_s": 4.5, "text": "really long trunks", "note": "use this"}]
    assert client.get("/api/highlights", params={"q": "trunks"}).json()[0]["title"] == "Me at the zoo"
    assert client.get("/api/highlights", params={"q": "100%"}).json() == []
    assert client.put(f"/api/highlights/{highlight_id}", json={"note": "changed"}).status_code == 204
    exported = client.get("/api/highlights/export").text
    assert "> really long trunks" in exported and "&t=2s" in exported and "changed" in exported
    assert client.delete(f"/api/highlights/{highlight_id}").status_code == 204
    assert client.get("/api/highlights").json() == []
    assert client.delete(f"/api/collections/{collection_id}").status_code == 204
    assert client.get(f"/api/videos/{video_id}").status_code == 200  # the video stays


LIST = """Here is your list:
```json
{"title": "Learn  Zoology", "sections": [
  {"title": "1. Basics", "items": [
    {"url": "https://www.youtube.com/playlist?list=PLabcdefghijklmnop", "note": "The course"},
    "https://youtu.be/aaaaaaaaaaa",
    {"url": "https://youtu.be/aaaaaaaaaaa"},
    {"url": "file://0123456789abcdef.mp4"},
    {"url": "https://example.com/not-a-video"}]},
  {"title": "2. Deeper", "items": [{"url": "https://www.youtube.com/watch?v=bbbbbbbbbbb"}]}
]}
```
Enjoy!"""


def test_import_a_list_made_by_an_ai(client, monkeypatch):
    with db.connect() as conn:
        conn.execute("DELETE FROM collections")
    checked = client.post("/api/lists/check", json={"text": LIST})
    assert checked.status_code == 200 and checked.json()["title"] == "Learn Zoology"
    assert checked.json()["totals"] == {"links": 3, "videos": 2, "whole": 1, "known": 0, "unusable": 2, "repeated": 1}
    assert client.get("/api/collections").json() == []  # checking changes nothing

    made = client.post("/api/lists", json={"text": LIST})
    assert made.status_code == 201 and made.json()["queued"] == 3 and len(made.json()["skipped"]) == 2
    names = {c["name"]: c for c in client.get("/api/collections").json()}
    top = names["Learn Zoology"]
    assert top["children"] == 2 and names["1. Basics"]["parent_id"] == top["id"] == made.json()["collection_id"]

    # The worker lists the playlist: its videos land in the section the list put the playlist in.
    conn = db.connect()
    playlist = conn.execute("SELECT id FROM sources WHERE kind = 'playlist'").fetchone()["id"]
    monkeypatch.setattr(fetch, "list_videos", lambda link, limit=None, **_: iter(
        [{"platform_video_id": "ccccccccccc", "url": "https://www.youtube.com/watch?v=ccccccccccc", "title": "Lecture 1"}]))
    library.sync_source(conn, playlist)
    conn.close()
    assert client.get("/api/videos", params={"collection_id": names["1. Basics"]["id"]}).json()["total"] == 1
    assert client.get("/api/videos", params={"collection_id": top["id"]}).json()["total"] == 1  # the outer one shows it too

    again = client.post("/api/lists", json={"text": LIST}).json()  # importing twice adds nothing new
    assert again["collection_id"] == top["id"] and len(client.get("/api/collections").json()) == 3
    assert conn_count("sources") == 3


def conn_count(table):
    conn = db.connect()
    try:
        return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]  # noqa: S608 - a fixed name from the test
    finally:
        conn.close()


def test_a_list_that_cannot_be_read_says_why(client):
    assert client.post("/api/lists/check", json={"text": "I could not browse the web."}).status_code == 422
    assert "cut off" in client.post("/api/lists/check", json={"text": '{"title": "x", "sections": [{]}'}).json()["detail"]
    assert client.post("/api/lists/check", json={"text": '{"title": "x"}'}).status_code == 422
    flat = client.post("/api/lists/check", json={"text": '{"title": "Talks", "items": ["https://youtu.be/aaaaaaaaaaa"]}'}).json()
    assert flat["sections"][0]["title"] == "Talks" and flat["totals"]["videos"] == 1
    assert "{topic}" in client.get("/api/lists/prompt").json()["prompt"]
