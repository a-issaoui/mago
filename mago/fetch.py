"""Everything that talks to YouTube and TikTok, through yt-dlp.

No video is ever downloaded for captions; audio is fetched only when a video
has no captions and Whisper has to listen to it.
"""

import itertools
import json
from datetime import datetime, timezone
from pathlib import Path

import yt_dlp
from yt_dlp.utils import DownloadError

from . import captions, config
from .links import Link



class _Silent:
    """yt-dlp prints errors to stderr on top of raising them; we only want the exception."""

    def debug(self, message: str) -> None: ...
    def warning(self, message: str) -> None: ...
    def error(self, message: str) -> None: ...


_QUIET = {"quiet": True, "no_warnings": True, "noprogress": True, "socket_timeout": 30, "logger": _Silent()}
_YOUTUBE_TABS = ("videos", "shorts", "streams")

_UNAVAILABLE = (
    "private", "unavailable", "removed", "deleted", "not available", "members-only",
    "members only", "confirm your age", "age-restricted", "copyright", "terminated",
    "does not exist", "no longer available", "this live event", "premieres in",
    "geo restrict", "in your country", "status code 404", "status_code 10204",
)
_RATE_LIMITED = ("429", "too many requests", "rate limit", "rate-limit", "rate-limited", "not a bot", "captcha", "try again later")


def account_file(platform: str) -> Path | None:
    """The cookies file for a platform, if the owner has put one there. Signing in is optional:
    it raises YouTube's hourly limit and opens age-restricted or private videos, but the account
    can be banned for it, so use one you can afford to lose."""
    path = config.COOKIES_DIR / f"{platform}.txt"
    return path if path.is_file() and path.stat().st_size > 0 else None


def _account(url_or_platform: str) -> dict:
    platform = "tiktok" if "tiktok" in url_or_platform else "youtube"
    path = account_file(platform)
    return {"cookiefile": str(path)} if path else {}


class FetchError(Exception):
    """Something went wrong and a retry might help."""


class Unavailable(FetchError):
    """Private, removed or blocked. Retrying won't help."""


class RateLimited(FetchError):
    """The platform asked us to slow down. Retry later."""


def _classify(error: Exception) -> FetchError:
    message = str(error).replace("ERROR: ", "").strip()
    lowered = message.lower()
    if any(mark in lowered for mark in _RATE_LIMITED):
        return RateLimited(message)
    if any(mark in lowered for mark in _UNAVAILABLE):
        return Unavailable(message)
    return FetchError(message)


def _extract(url: str, **options) -> dict:
    process = options.pop("process", True)
    try:
        with yt_dlp.YoutubeDL({**_QUIET, **_account(url), **options}) as ydl:
            return ydl.extract_info(url, download=False, process=process)
    except DownloadError as error:
        raise _classify(error) from error


def _iso(info: dict) -> str | None:
    if info.get("timestamp"):
        return datetime.fromtimestamp(int(info["timestamp"]), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    date = str(info.get("upload_date") or "")
    return f"{date[:4]}-{date[4:6]}-{date[6:]}T00:00:00Z" if len(date) == 8 else None


def _best_thumb(info: dict) -> str | None:
    thumbs = [t for t in info.get("thumbnails") or [] if t.get("url")]
    if not thumbs:
        return info.get("thumbnail")
    # yt-dlp orders worst → best; prefer explicit sizes when present.
    return max(enumerate(thumbs), key=lambda p: ((p[1].get("width") or 0) * (p[1].get("height") or 0), p[0]))[1]["url"]


def _avatar_and_banner(info: dict) -> tuple[str | None, str | None]:
    avatar = banner = None
    for thumb in info.get("thumbnails") or []:
        marker = str(thumb.get("id") or "")
        width, height = thumb.get("width") or 0, thumb.get("height") or 0
        if marker == "avatar_uncropped" or (width and width == height):
            avatar = thumb["url"]
        elif marker == "banner_uncropped" or (width and height and width / height > 3):
            banner = thumb["url"]
    return avatar, banner


def video_fields(info: dict, platform: str) -> dict:
    """The columns Mago stores for a video, from a yt-dlp entry (flat or full)."""
    video_id = str(info["id"])
    if platform == "youtube":
        url = f"https://www.youtube.com/watch?v={video_id}"
    else:
        url = info.get("webpage_url") or info.get("url") or ""
    title = (info.get("title") or "").strip()
    tall = platform == "tiktok" or "/shorts/" in str(info.get("url") or "")
    if info.get("width") and info.get("height"):
        tall = info["height"] > info["width"]
    handle = str(info.get("uploader") or "") if platform == "tiktok" else ""
    channel_url = f"https://www.tiktok.com/@{handle}" if handle else (info.get("uploader_url") or info.get("channel_url"))
    return {
        "channel_name": info.get("channel") or info.get("uploader"),
        "channel_url": channel_url,
        "shape": "tall" if tall else "wide",
        "platform_video_id": video_id,
        "url": url,
        "title": title[:300] or None,
        "description": info.get("description"),
        "published_at": _iso(info),
        "duration_s": info.get("duration"),
        "view_count": info.get("view_count"),
        "thumb_url_original": _best_thumb(info),
        "language": info.get("language"),
    }


def probe(link: Link) -> dict:
    """Cheap look at a link for the preview card: no listing of a whole channel."""
    if link.kind == "video":
        info = _extract(link.url)
        platform_fields = video_fields(info, link.platform)
        return {
            "platform": link.platform, "kind": "video", "url": link.url,
            "title": platform_fields["title"],
            "handle": info.get("uploader_id") if link.platform == "youtube" else "@" + str(info.get("uploader") or ""),
            "channel": info.get("channel") or info.get("uploader"),
            "thumb_url": platform_fields["thumb_url_original"],
            "avatar_url": None, "banner_url": None, "video_count": 1,
            "duration_s": platform_fields["duration_s"], "channel_url": platform_fields["channel_url"],
        }
    info = _extract(link.url, extract_flat=True, process=False, playlistend=1)
    first = next(iter(info.get("entries") or []), None) or {}
    avatar, banner = _avatar_and_banner(info)
    if link.platform == "tiktok":
        title = first.get("channel") or info.get("title") or link.key
        handle = link.key
    else:
        title = info.get("channel") or info.get("title") or link.key
        handle = info.get("uploader_id") or link.key
    return {
        "platform": link.platform, "kind": link.kind, "url": link.url,
        "title": title, "handle": handle, "channel": title,
        "thumb_url": _best_thumb(first) if first.get("thumbnails") else None,
        "avatar_url": avatar, "banner_url": banner,
        "video_count": info.get("playlist_count"), "duration_s": None,
    }


def list_videos(link: Link, limit: int | None = None):
    """Yield every video of a channel, playlist or profile, without downloading
    anything. YouTube channels are split into tabs, so each tab is listed."""
    if link.kind == "video":
        yield video_fields(_extract(link.url), link.platform)
        return
    urls = [link.url]
    if link.platform == "youtube" and link.kind == "channel":
        urls = [f"{link.url}/{tab}" for tab in _YOUTUBE_TABS]
    seen: set[str] = set()
    listed_any = False
    last_error: FetchError | None = None
    for url in urls:
        try:
            info = _extract(url, extract_flat=True, process=False)
            for entry in info.get("entries") or []:
                if not entry or not entry.get("id") or entry["id"] in seen:
                    continue
                seen.add(entry["id"])
                listed_any = True
                yield video_fields(entry, link.platform)
                if limit and len(seen) >= limit:
                    return
        except DownloadError as error:
            last_error = _classify(error)
        except FetchError as error:  # a channel without a Shorts or Live tab is normal
            last_error = error
    if not listed_any and last_error:
        raise last_error


class VideoSession:
    """One yt-dlp session per video, so the audio download reuses the metadata
    request instead of asking the platform twice (fewer TikTok 429s)."""

    def __init__(self, url: str, platform: str, audio_dir: Path):
        self.url, self.platform, self.audio_dir = url, platform, audio_dir
        # TikTok's audio-only format is the sound track (often a song), not the
        # speech, so take the smallest file that has both video and audio.
        chosen = "worst[acodec!=none][vcodec!=none]/worst" if platform == "tiktok" else "bestaudio[abr<=96]/bestaudio/worst"
        self._ydl = yt_dlp.YoutubeDL({
            **_QUIET, **_account(platform), "format": chosen, "max_filesize": 500 * 1024 * 1024,
            "outtmpl": str(audio_dir / "%(extractor)s_%(id)s.%(ext)s"), "overwrites": True,
        })
        self.info: dict = {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self._ydl.close()

    def load(self) -> dict:
        try:
            self.info = self._ydl.extract_info(self.url, download=False)
        except DownloadError as error:
            raise _classify(error) from error
        return video_fields(self.info, self.platform)

    def captions(self, preferred_language: str = "") -> dict | None:
        """Manual captions first, then the platform's automatic ones. Returns
        {"segments", "language", "auto"} or None when the video has none."""
        for auto, tracks in ((False, self.info.get("subtitles") or {}), (True, self.info.get("automatic_captions") or {})):
            tracks = {lang: formats for lang, formats in tracks.items() if lang != "live_chat"}
            language = self._pick_language(tracks, preferred_language, auto)
            if not language:
                continue
            segments = self._download_track(tracks[language])
            if segments:
                return {"segments": segments, "language": language.removesuffix("-orig"), "auto": auto}
        return None

    def _pick_language(self, tracks: dict, preferred: str, auto: bool) -> str | None:
        if not tracks:
            return None
        original = self.info.get("language") or ""
        wanted = [f"{original}-orig", original] if auto else [preferred, original, "en"]
        if auto and not original:
            # Without the original language we can't tell "en" from a machine translation: leave it to Whisper.
            wanted = [next((lang for lang in tracks if lang.endswith("-orig")), "")]
        for candidate in filter(None, wanted):
            if candidate in tracks:
                return candidate
            close = next((lang for lang in tracks if lang.split("-")[0] == candidate.split("-")[0]), None)
            if close:
                return close
        # Automatic tracks in other languages are machine translations: skip them.
        return None if auto else next(iter(tracks))

    def _download_track(self, formats: list[dict]) -> list[dict]:
        by_ext = {fmt.get("ext"): fmt for fmt in formats if fmt.get("url")}
        for ext, parse in (("json3", lambda raw: captions.from_json3(json.loads(raw))), ("vtt", captions.from_vtt)):
            if ext not in by_ext:
                continue
            try:
                raw = self._ydl.urlopen(by_ext[ext]["url"]).read().decode("utf-8", "replace")
                segments = parse(raw)
            except Exception as error:  # noqa: BLE001 - a broken track means: try the next, then Whisper
                if "429" in str(error):
                    raise RateLimited(str(error)) from error
                continue
            if segments:
                return segments
        return []

    def download_audio(self) -> Path:
        try:
            result = self._ydl.process_ie_result(self.info, download=True)
        except DownloadError as error:
            raise _classify(error) from error
        downloads = result.get("requested_downloads") or []
        path = Path(downloads[0]["filepath"]) if downloads else None
        if not path or not path.exists():
            raise FetchError("the audio download produced no file")
        return path


def first_entries(link: Link, count: int) -> list[dict]:
    return list(itertools.islice(list_videos(link), count))


def ytdlp_version() -> str:
    """The version this process has loaded (an update needs a restart to take effect)."""
    return yt_dlp.version.__version__


def ytdlp_installed_version() -> str:
    from importlib.metadata import version

    return version("yt-dlp")
