"""Podcasts: a feed (RSS) is a channel, each episode's audio file is a "video".

Feeds and audio come from addresses the owner pasted, so every request goes
through the same public-address check as thumbnails (no fetching from this
machine or the home network).
"""

import hashlib
import json
import re
import urllib.request
from datetime import timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree

from .thumbs import _HEADERS, _check_public, _opener

ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
MAX_FEED_BYTES = 30 * 1024 * 1024
MAX_AUDIO_BYTES = 1024 * 1024 * 1024


class NotAFeed(ValueError):
    pass


def _get(url: str, limit: int) -> bytes:
    _check_public(url)
    with _opener.open(urllib.request.Request(url, headers=_HEADERS), timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("that file is too large")
    return data


def resolve(url: str) -> str:
    """An Apple Podcasts page link → the show's real feed address."""
    match = re.search(r"podcasts\.apple\.com/.*?/id(\d+)", url)
    if not match:
        return url
    found = json.loads(_get(f"https://itunes.apple.com/lookup?id={match.group(1)}&entity=podcast", 2_000_000))
    feed = next((item.get("feedUrl") for item in found.get("results", []) if item.get("feedUrl")), None)
    if not feed:
        raise NotAFeed("Apple Podcasts has no public feed for that show.")
    return feed


def _seconds(text: str | None) -> float | None:
    """itunes:duration is "3723", "62:03" or "1:02:03"."""
    if not text:
        return None
    try:
        parts = [float(part) for part in text.strip().split(":")]
    except ValueError:
        return None
    total = 0.0
    for part in parts:
        total = total * 60 + part
    return total or None


def _date(text: str | None) -> str | None:
    try:
        return parsedate_to_datetime(text).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if text else None
    except (TypeError, ValueError):
        return None


def _clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def parse(data: bytes) -> tuple[dict, list[dict]]:
    """(show, episodes). Raises NotAFeed if this isn't a podcast feed."""
    try:
        root = ElementTree.fromstring(data)  # noqa: S314 - stdlib parser, no external entities
    except ElementTree.ParseError as error:
        raise NotAFeed("That address isn't a podcast feed.") from error
    channel = root.find("channel")
    if channel is None:
        raise NotAFeed("That address isn't a podcast feed.")
    image = channel.find(f"{ITUNES}image")
    cover = image.get("href") if image is not None else channel.findtext("image/url")
    show = {"title": _clean(channel.findtext("title")) or "Podcast", "image": cover, "author": _clean(channel.findtext(f"{ITUNES}author"))}
    episodes = []
    for item in channel.findall("item"):
        enclosure = item.find("enclosure")
        audio = enclosure.get("url") if enclosure is not None else None
        if not audio or not audio.startswith("https://"):
            continue  # no audio, or not over https
        guid = item.findtext("guid") or audio
        picture = item.find(f"{ITUNES}image")
        episodes.append({
            "platform_video_id": hashlib.sha1(guid.encode()).hexdigest()[:20],  # noqa: S324 - an id, not security
            "url": audio,
            "title": _clean(item.findtext("title"))[:300] or None,
            "description": _clean(item.findtext("description") or item.findtext(f"{ITUNES}summary"))[:4000] or None,
            "published_at": _date(item.findtext("pubDate")),
            "duration_s": _seconds(item.findtext(f"{ITUNES}duration")),
            "view_count": None,
            "thumb_url_original": (picture.get("href") if picture is not None else None) or cover,
            "language": None,
            "shape": "wide",
            "channel_name": show["title"],
            "channel_url": None,
            "channel_uid": None,
            "chapters": None,
        })
    if not episodes:
        raise NotAFeed("That feed has no audio episodes.")
    return show, episodes


def probe(url: str) -> dict:
    show, episodes = parse(_get(resolve(url), MAX_FEED_BYTES))
    return {
        "platform": "podcast", "kind": "channel", "url": url, "title": show["title"], "handle": show["author"] or None,
        "channel": show["title"], "thumb_url": show["image"], "avatar_url": show["image"], "banner_url": None,
        "video_count": len(episodes), "duration_s": None, "channel_url": None,
    }


def list_episodes(url: str, limit: int | None = None):
    _, episodes = parse(_get(resolve(url), MAX_FEED_BYTES))
    yield from episodes[:limit] if limit else episodes


def download(url: str, folder: Path, name: str) -> Path:
    """Fetch one episode's audio to a temporary file (deleted after transcription)."""
    _check_public(url)
    suffix = re.search(r"\.(mp3|m4a|aac|ogg|opus|wav|mp4)(?:\?|$)", url.lower())
    path = folder / f"podcast_{name}.{suffix.group(1) if suffix else 'mp3'}"
    with _opener.open(urllib.request.Request(url, headers=_HEADERS), timeout=60) as response, open(path, "wb") as out:
        written = 0
        while chunk := response.read(1024 * 256):
            written += len(chunk)
            if written > MAX_AUDIO_BYTES:
                out.close()
                path.unlink(missing_ok=True)
                raise ValueError("that episode's audio is larger than 1 GB")
            out.write(chunk)
    return path
