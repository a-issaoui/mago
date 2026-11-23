"""Podcasts and local files."""

import subprocess

import pytest
from fastapi.testclient import TestClient

from mago import api, db, fetch, files, library, pipeline, podcasts
from mago.links import UnsupportedLink, detect

FEED = b"""<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
<title>The Test Show</title><itunes:author>Ada</itunes:author><itunes:image href="https://example.com/cover.jpg"/>
<item><title>Episode two</title><guid>ep-2</guid><pubDate>Tue, 03 Nov 2026 10:00:00 +0000</pubDate>
  <itunes:duration>1:02:03</itunes:duration><description>&lt;p&gt;About &lt;b&gt;things&lt;/b&gt;&lt;/p&gt;</description>
  <enclosure url="https://example.com/audio/two.mp3?x=1" type="audio/mpeg"/></item>
<item><title>Episode one</title><guid>ep-1</guid><itunes:duration>125</itunes:duration>
  <enclosure url="https://example.com/audio/one.m4a" type="audio/mp4"/></item>
<item><title>No audio here</title><guid>ep-0</guid></item>
<item><title>Not https</title><guid>ep-x</guid><enclosure url="http://example.com/x.mp3"/></item>
</channel></rss>"""


def test_feed_parsing():
    show, episodes = podcasts.parse(FEED)
    assert show == {"title": "The Test Show", "image": "https://example.com/cover.jpg", "author": "Ada"}
    assert [e["title"] for e in episodes] == ["Episode two", "Episode one"]
    first = episodes[0]
    assert (first["duration_s"], first["published_at"], first["description"]) == (3723.0, "2026-11-03T10:00:00Z", "About things")
    assert first["url"].startswith("https://example.com/audio/two.mp3") and len(first["platform_video_id"]) == 20
    assert episodes[1]["duration_s"] == 125 and episodes[1]["thumb_url_original"] == "https://example.com/cover.jpg"
    for junk in (b"<html></html>", b"not xml", b"<rss><channel><title>x</title></channel></rss>"):
        with pytest.raises(podcasts.NotAFeed):
            podcasts.parse(junk)


def test_podcast_links_and_private_addresses():
    assert detect("https://feeds.example.com/show/rss").platform == "podcast"
    assert detect("https://podcasts.apple.com/us/podcast/some-show/id123456").kind == "channel"
    assert detect("https://example.com/podcast.xml").key == "https://example.com/podcast.xml"
    with pytest.raises(UnsupportedLink):
        detect("https://example.com/some/page")
    with pytest.raises(ValueError):
        podcasts.download("https://127.0.0.1/secret.mp3", files.uploads_dir(), "x")  # never fetch from this machine


def test_podcast_becomes_a_channel_of_episodes(conn, monkeypatch):
    monkeypatch.setattr(podcasts, "_get", lambda url, limit: FEED)
    link = detect("https://feeds.example.com/show/rss")
    preview = fetch.probe(link)
    assert (preview["platform"], preview["title"], preview["video_count"]) == ("podcast", "The Test Show", 2)
    source_id = library.add_source(conn, link.url, preview)
    result = library.sync_source(conn, source_id)
    assert result["new"] == 2 and library.sync_source(conn, source_id)["new"] == 0
    video = library.get_video(conn, result["new_video_ids"][0])
    assert (video["platform"], video["source_title"]) == ("podcast", "The Test Show")
    assert library.timestamp_url(video, 65).endswith(f"/v/{video['id']}?t=65")


@pytest.fixture
def tone(tmp_path):
    """A two-second sound file made with ffmpeg."""
    path = tmp_path / "My  recording_one.wav"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", str(path)], capture_output=True, check=True)
    return path


class FakeEngine:
    def transcribe(self, audio, language=None, translate=False, on_progress=None, hint=None):
        assert audio.exists()
        return {"segments": [{"start": 0.0, "end": 2.0, "text": "A test tone was heard."}], "language": "en", "device": "cpu"}


def test_upload_in_pieces_then_transcribe(tone):
    with db.connect() as conn:
        conn.executescript("DELETE FROM sources; DELETE FROM jobs;")
    client = TestClient(api.app, headers={"x-mago": "1"})
    data = tone.read_bytes()
    assert client.post("/api/files", json={"name": "notes.txt", "size": 5}).status_code == 422
    upload = client.post("/api/files", json={"name": tone.name, "size": len(data)}).json()
    half = len(data) // 2
    assert client.put(f"/api/files/{upload['upload_id']}/chunk", params={"offset": 0}, content=data[:half]).status_code == 204
    assert client.put(f"/api/files/{upload['upload_id']}/chunk", params={"offset": 0}, content=data[:half]).status_code == 409  # sent twice
    assert client.post(f"/api/files/{upload['upload_id']}/finish", json={"name": tone.name, "size": len(data)}).status_code == 409  # not all there yet
    assert client.put(f"/api/files/{upload['upload_id']}/chunk", params={"offset": half}, content=data[half:]).status_code == 204
    assert client.put("/api/files/..%2F..%2Fmago.db/chunk", params={"offset": 0}, content=b"x").status_code == 404
    video_id = client.post(f"/api/files/{upload['upload_id']}/finish", json={"name": tone.name, "size": len(data)}).json()["video_id"]

    conn = db.connect()
    video = library.get_video(conn, video_id)
    assert (video["platform"], video["title"], video["status"], round(video["duration_s"])) == ("file", "My recording one", "queued", 2)
    stored = files.path_of(video)
    assert stored.read_bytes() == data
    assert pipeline.process_video(conn, video_id, FakeEngine())["method"] == "whisper"
    assert stored.exists()  # kept for playback, unlike downloaded audio
    assert client.get(f"/media/files/{stored.name}").status_code == 200
    assert client.get("/api/search", params={"q": "tone", "platform": "file"}).json()["items"][0]["video_id"] == video_id
    assert client.get("/api/activity").json()["platforms"]["file"] == {"total": 1, "done": 1, "working": 0, "failed": 0}
    assert client.delete(f"/api/videos/{video_id}").status_code == 204
    assert not stored.exists() and client.get("/api/sources").json() == []
    conn.close()
