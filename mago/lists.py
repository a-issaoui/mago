"""Import a list of links, usually written by an AI after researching a topic.

The list names sections and the links in each. Mago creates a collection for the list, one
inside it per section, queues every link and files the videos where the list put them.
The text comes from outside (an AI's answer), so it is checked like any other input.
"""

import json
import sqlite3

from pydantic import BaseModel, Field, ValidationError, field_validator

from . import jobs, library
from .links import UnsupportedLink, detect

MAX_LINKS = 500
MAX_TEXT = 400_000

PROMPT = """\
I use Mago, a tool that transcribes videos so that AI models can read them. Build me a list for it.

Topic: {topic}

Research the best material on this topic: YouTube videos, playlists and channels (TikTok links and \
podcast feed addresses also work). Put it in the order it should be followed and group it into sections.

Rules:
- Only use links you have checked exist. Never guess or invent a link. If you cannot browse the web, \
tell me so instead of answering.
- For a course, give its playlist link. For one talk, give the video link.
- Give a whole channel link only when every video on that channel belongs in the list: every video of a \
channel or playlist gets transcribed.
- Keep section titles short and start them with a number so they stay in order.
- Reply with one JSON object and nothing else, in exactly this shape:

{{
  "title": "Name of the whole list",
  "sections": [
    {{
      "title": "1. First section",
      "items": [
        {{"url": "https://www.youtube.com/playlist?list=...", "note": "One line: what it is and why it is here"}},
        {{"url": "https://www.youtube.com/watch?v=...", "note": "..."}}
      ]
    }}
  ]
}}
"""


class BadList(ValueError):
    """The text isn't a list Mago can read. The message says what is wrong, for the person to fix."""


def _clean(value: str) -> str:
    return " ".join(str(value).split())


class Item(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    note: str = Field(default="", max_length=500)

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, value):
        return _clean(value or "")[:500]


class Section(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    items: list[Item] = Field(max_length=MAX_LINKS)

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, value):
        return _clean(value or "")[:80]

    @field_validator("items", mode="before")
    @classmethod
    def _items(cls, value):  # a bare link is as good as {"url": link}
        return [{"url": item} if isinstance(item, str) else item for item in value] if isinstance(value, list) else value


class LinkList(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    sections: list[Section] = Field(min_length=1, max_length=40)

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, value):
        return _clean(value or "")[:80]


def parse(text: str) -> LinkList:
    """Read the list out of an AI's answer. Text around the JSON (a code fence, a sentence) is ignored."""
    if len(text) > MAX_TEXT:
        raise BadList("That text is too long to be a list.")
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise BadList("There is no list in that text. It should be the JSON the AI answered with, starting with {.")
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError as error:
        raise BadList(f"The list is cut off or broken (line {error.lineno}). Ask the AI to send the complete JSON again.") from error
    if isinstance(data, dict) and "sections" not in data and isinstance(data.get("items"), list):
        data = {**data, "sections": [{"title": data.get("title") or "List", "items": data["items"]}]}  # a flat list
    try:
        found = LinkList.model_validate(data)
    except ValidationError as error:
        first = error.errors()[0]
        where = " > ".join(str(part) for part in first["loc"])
        raise BadList(f"The list isn't in the expected shape ({where}: {first['msg']}).") from error
    if sum(len(section.items) for section in found.sections) > MAX_LINKS:
        raise BadList(f"A list can hold {MAX_LINKS} links at most. Split it in two.")
    return found


def _link(url: str):
    """The link, or the reason Mago can't use it. Files on this computer are never taken from a list."""
    try:
        link = detect(url)
    except UnsupportedLink:
        return None, "Not a YouTube, TikTok or podcast link"
    if link.platform == "file":
        return None, "Not a YouTube, TikTok or podcast link"
    return link, None


def check(conn: sqlite3.Connection, found: LinkList) -> dict:
    """What importing the list would do. Nothing is changed and nothing is fetched."""
    sections, seen = [], set()
    totals = {"links": 0, "videos": 0, "whole": 0, "known": 0, "unusable": 0, "repeated": 0}
    for section in found.sections:
        items = []
        for item in section.items:
            link, problem = _link(item.url)
            entry = {"url": link.url if link else item.url, "note": item.note, "platform": link.platform if link else None,
                     "kind": link.kind if link else None, "state": "new", "problem": problem}
            if link is None:
                entry["state"] = "unusable"
                totals["unusable"] += 1
            elif link.url in seen:
                entry["state"] = "repeated"
                totals["repeated"] += 1
            else:
                seen.add(link.url)
                totals["links"] += 1
                totals["videos" if link.kind == "video" else "whole"] += 1
                known = library.find_video(conn, link.key) if link.kind == "video" else conn.execute(
                    "SELECT id FROM sources WHERE url = ?", (link.url,)).fetchone()
                if known:
                    entry["state"] = "known"
                    totals["known"] += 1
            items.append(entry)
        sections.append({"title": section.title, "items": items})
    return {"title": found.title, "sections": sections, "totals": totals}


def _collection(conn: sqlite3.Connection, name: str, parent_id: int | None, list_title: str) -> int:
    """The collection with this name in this place, made if needed. Names are unique across the
    library, so a section whose name is taken elsewhere gets the list's title added."""
    for candidate in (name, f"{name} ({list_title})"[:80]):
        row = conn.execute("SELECT id, parent_id FROM collections WHERE name = ?", (candidate,)).fetchone()
        if row is None:
            return int(conn.execute("INSERT INTO collections(name, parent_id) VALUES (?, ?)", (candidate, parent_id)).lastrowid or 0)
        if row["parent_id"] == parent_id:
            return row["id"]
    raise BadList(f"There is already a collection called {name} somewhere else. Rename it or the section, then import again.")


def apply(conn: sqlite3.Connection, found: LinkList) -> dict:
    """Create the collections, queue every usable link and file the videos. Safe to run twice."""
    top = conn.execute("SELECT id, parent_id FROM collections WHERE name = ?", (found.title,)).fetchone()
    if top and top["parent_id"] is not None and len(found.sections) > 1:
        raise BadList(f"There is already a collection called {found.title} inside another one. Rename it or the list, then import again.")
    queued = filed = place = 0
    skipped: list[dict] = []
    seen: set[str] = set()
    conn.execute("BEGIN IMMEDIATE")
    try:
        top_id = top["id"] if top else conn.execute("INSERT INTO collections(name) VALUES (?)", (found.title,)).lastrowid
        for section in found.sections:
            # One section needs no folder of its own: its links go straight into the list's collection.
            collection_id = top_id if len(found.sections) == 1 else _collection(conn, section.title, top_id, found.title)
            for item in section.items:
                link, problem = _link(item.url)
                if link is None:
                    skipped.append({"url": item.url, "problem": problem})
                    continue
                if link.url in seen:
                    continue
                seen.add(link.url)
                place += 1  # the list's order is kept; importing again moves things to where the list now puts them
                note = item.note or None
                video = library.find_video(conn, link.key) if link.kind == "video" else None
                if video:  # already transcribed or waiting, perhaps inside a channel: just file it
                    conn.execute(
                        "INSERT INTO collection_videos(collection_id, video_id, position, note) VALUES (?, ?, ?, ?) "
                        "ON CONFLICT(collection_id, video_id) DO UPDATE SET position = excluded.position, note = coalesce(excluded.note, note)",
                        (collection_id, video["id"], place * library.LIST_STEP, note))
                    filed += 1
                    continue
                source_id = library.add_source(conn, link.url)
                conn.execute(
                    "INSERT INTO collection_sources(collection_id, source_id, position, note) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(collection_id, source_id) DO UPDATE SET position = excluded.position, note = coalesce(excluded.note, note)",
                    (collection_id, source_id, place, note))
                jobs.enqueue_list(conn, source_id)  # listing it (again) is what files its videos
                queued += 1
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return {"collection_id": top_id, "title": found.title, "queued": queued, "filed": filed, "skipped": skipped}
