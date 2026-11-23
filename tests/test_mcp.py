import asyncio
import json
import os
import sys

import pytest

from mago import db, library


def call(tool: str, **arguments):
    """Start the real server over stdio and call one tool, as Claude would."""
    from mcp.client.session import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    async def run():
        params = StdioServerParameters(command=sys.executable, args=["-m", "mago.mcp_server"], env=dict(os.environ))
        async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
            await session.initialize()
            if tool == "tools/list":
                return sorted(t.name for t in (await session.list_tools()).tools)
            result = await session.call_tool(tool, arguments)
            text = result.content[0].text
            return ("error", text) if getattr(result, "is_error", False) or getattr(result, "isError", False) else json.loads(text)

    return asyncio.run(run())


@pytest.fixture
def seeded():
    conn = db.connect()
    conn.executescript("DELETE FROM sources; DELETE FROM jobs;")
    source_id = library.add_source(conn, "https://www.youtube.com/@jawed")
    video_id, _ = library.upsert_video(conn, source_id, "youtube", {
        "platform_video_id": "jNQXAC9IVRw", "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "title": "Me at the zoo"})
    library.save_transcript(conn, video_id, [
        {"start": 1.2, "end": 3.0, "text": "Here we are in front of the elephants."},
        {"start": 12.0, "end": 14.0, "text": "They have really long trunks."}], "captions", "en")
    yield source_id, video_id
    conn.close()


def test_reading_adding_and_running_mago_over_stdio(seeded):
    source_id, video_id = seeded
    assert set(call("tools/list")) >= {
        "search", "get_transcript", "get_channel_transcripts", "list_sources", "list_videos", "transcribe", "add_source",
        "sync_source", "retry", "queue_status", "queue_control", "get_settings", "update_settings", "export_channel",
        "remove_source", "remove_video", "services", "update_ytdlp"}

    # reading
    hit = call("search", query="elephants", source="@jawed")["hits"][0]
    assert (hit["video_id"], hit["at"], hit["match"]) == (video_id, "0:01", "all words")
    assert hit["url"] == "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=1s"
    assert "Do not guess" in call("search", query="xylophone")["notice"]
    by_link = call("get_transcript", video="https://youtu.be/jNQXAC9IVRw", timestamps=True)
    assert by_link["transcript"] == "[0:01] Here we are in front of the elephants.\n[0:12] They have really long trunks."
    assert call("get_transcript", video=str(video_id), start_s=10)["transcript"] == "[0:12] They have really long trunks."
    assert call("get_transcript", video="nope")[0] == "error"
    channel = call("get_channel_transcripts", source="jawed")
    assert (channel["transcribed_videos"], channel["returned"]) == (1, 1) and "elephants" in channel["videos"][0]["transcript"]
    assert "next_offset" not in channel
    assert call("list_sources")["sources"][0]["transcribed"] == 1
    assert call("list_videos", source=str(source_id), status="done")["videos"][0]["title"] == "Me at the zoo"
    assert call("list_videos", status="failed")["total"] == 0

    # adding: a known video comes straight back; a channel is queued; nothing runs without the worker
    assert "elephants" in call("transcribe", url="https://youtu.be/jNQXAC9IVRw")["transcript"]
    added = call("transcribe", url="https://www.tiktok.com/@tiktok")
    assert (added["kind"], added["already_in_library"]) == ("profile", False)
    assert any("worker is not running" in note for note in added["blockers"])
    waiting = call("transcribe", url="https://youtu.be/aaaaaaaaaaa", wait_seconds=0)
    assert waiting["transcript"] is None and waiting["blockers"]
    assert call("transcribe", url="https://vimeo.com/1")[0] == "error"
    assert call("sync_source", source="@jawed")["source"]["source_id"] == source_id

    # running
    assert call("queue_control", action="stop", platform="youtube") == {"stopped": ["youtube"]}
    status = call("queue_status")
    assert status["stopped_by_owner"] == ["youtube"] and status["worker_running"] is False
    assert call("queue_control", action="resume") == {"stopped": []}
    assert call("update_settings", youtube_delay_s=9, skip_repeats=False)["youtube_delay_s"] == "9"
    assert call("update_settings", youtube_delay_s=999)[0] == "error"
    exported = call("export_channel", source="@jawed", format="txt")
    assert exported["videos"] == 1 and "elephants" in open(exported["path"]).read()
    assert call("services")["ok"] is True
    assert call("retry", video=str(video_id))["queued"] == 1  # back in the queue (no worker here to run it)

    # deleting needs an explicit confirm
    assert call("remove_video", video=str(video_id))["would_delete"]["video_id"] == video_id
    assert call("list_videos", source="@jawed")["total"] == 1
    assert call("remove_source", source="@jawed", confirm=True)["deleted"]["source_id"] == source_id
    assert all(s["handle"] != "@jawed" for s in call("list_sources")["sources"])
