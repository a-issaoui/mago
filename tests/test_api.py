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
