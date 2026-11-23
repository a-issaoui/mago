"""Recognise a pasted link: which platform, and is it one video or a collection."""

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote, urlparse

YOUTUBE_HOSTS = {"youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"}
TIKTOK_SHORT_HOSTS = {"vm.tiktok.com", "vt.tiktok.com"}
_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_HANDLE = re.compile(r"^@[\w.\-]+$")  # handles can be non-Latin (\w is Unicode-aware)


@dataclass(frozen=True)
class Link:
    platform: str  # youtube | tiktok | podcast | file
    kind: str  # video | channel | playlist | profile
    url: str  # canonical form, safe to store and compare
    key: str  # video id, playlist id, channel path or @handle


class UnsupportedLink(ValueError):
    pass


def detect(raw: str) -> Link:
    text = (raw or "").strip()
    if not text:
        raise UnsupportedLink("Paste a YouTube or TikTok link.")
    if text.startswith("file://"):
        pass
    elif not re.match(r"^https?://", text, re.I):
        text = "https://" + text
    parsed = urlparse(text)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    parts = [unquote(p) for p in parsed.path.split("/") if p]
    query = parse_qs(parsed.query)

    if host == "youtu.be":
        return _youtube_video(parts[0] if parts else "")
    if host in YOUTUBE_HOSTS:
        return _youtube(parts, query)
    if host in TIKTOK_SHORT_HOSTS and parts:
        return Link("tiktok", "video", f"https://{host}/{parts[0]}", parts[0])
    if host in {"tiktok.com", "m.tiktok.com"}:
        return _tiktok(parts)
    if text.startswith("file://") and re.fullmatch(r"file://[0-9a-f]{16}\.\w{2,5}", raw.strip()):
        return Link("file", "video", raw.strip(), raw.strip().removeprefix("file://"))
    # A podcast: an Apple Podcasts page, or a feed address.
    looks_like_feed = re.search(r"(\.xml|\.rss|/feed|/rss|feeds?\.|podcast)", f"{host}{parsed.path}", re.I)
    if parsed.scheme == "https" and host and (host == "podcasts.apple.com" or looks_like_feed):
        return Link("podcast", "channel", text.split("#")[0], text.split("#")[0])
    raise UnsupportedLink("Paste a YouTube or TikTok link, or a podcast feed.")


def _youtube_video(video_id: str) -> Link:
    if not _YT_ID.match(video_id):
        raise UnsupportedLink("That doesn't look like a YouTube video link.")
    return Link("youtube", "video", f"https://www.youtube.com/watch?v={video_id}", video_id)


def _youtube(parts: list[str], query: dict) -> Link:
    first = parts[0] if parts else ""
    if first == "watch":
        return _youtube_video((query.get("v") or [""])[0])
    if first in {"shorts", "live", "embed", "v"} and len(parts) > 1:
        return _youtube_video(parts[1])
    if first == "playlist":
        list_id = (query.get("list") or [""])[0]
        if not re.match(r"^[A-Za-z0-9_-]{10,}$", list_id):
            raise UnsupportedLink("That playlist link has no list id.")
        return Link("youtube", "playlist", f"https://www.youtube.com/playlist?list={list_id}", list_id)
    if _HANDLE.match(first):
        handle = first.lower()  # handles are case-insensitive: one channel, one source
        return Link("youtube", "channel", f"https://www.youtube.com/{handle}", handle)
    if first in {"channel", "c", "user"} and len(parts) > 1:
        key = f"{first}/{parts[1]}"
        return Link("youtube", "channel", f"https://www.youtube.com/{key}", key)
    raise UnsupportedLink("That YouTube link isn't a video, channel or playlist.")


def _tiktok(parts: list[str]) -> Link:
    first = parts[0] if parts else ""
    if first == "t" and len(parts) > 1:
        return Link("tiktok", "video", f"https://www.tiktok.com/t/{parts[1]}", parts[1])
    if _HANDLE.match(first):
        handle = first.lower()
        if len(parts) >= 3 and parts[1] in {"video", "photo"} and parts[2].isdigit():
            return Link("tiktok", "video", f"https://www.tiktok.com/{handle}/video/{parts[2]}", parts[2])
        if len(parts) == 1:
            return Link("tiktok", "profile", f"https://www.tiktok.com/{handle}", handle)
    raise UnsupportedLink("That TikTok link isn't a video or a profile.")
