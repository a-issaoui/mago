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


def test_the_four_tools_work_over_stdio(seeded):
    source_id, video_id = seeded
    assert call("tools/list") == ["add_source", "get_transcript", "list_sources", "search"]

    hit = call("search", query="elephants")["hits"][0]
    assert (hit["video_id"], hit["at"], hit["match"]) == (video_id, "0:01", "all words")
    assert "Do not guess" in call("search", query="xylophone")["notice"]
    assert hit["url"] == "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=1s"

    by_link = call("get_transcript", video="https://youtu.be/jNQXAC9IVRw", timestamps=True)
    assert by_link["transcript"] == "[0:01] Here we are in front of the elephants.\n[0:12] They have really long trunks."
    assert call("get_transcript", video=str(video_id), start_s=10)["transcript"] == "[0:12] They have really long trunks."
    assert call("get_transcript", video="nope")[0] == "error"

    listed = call("list_sources")["sources"]
    assert (listed[0]["source_id"], listed[0]["transcribed"]) == (source_id, 1)
    assert call("list_sources", source_id=source_id)["videos"][0]["title"] == "Me at the zoo"

    assert call("add_source", url="https://youtu.be/jNQXAC9IVRw")["already_in_library"] is True
    added = call("add_source", url="https://www.tiktok.com/@tiktok")
    assert (added["kind"], added["already_in_library"]) == ("profile", False)
    queued = db.connect().execute("SELECT count(*) FROM jobs WHERE kind = 'list' AND source_id = ?", (added["source_id"],)).fetchone()[0]
    assert queued == 1
    assert call("add_source", url="https://vimeo.com/1")[0] == "error"
