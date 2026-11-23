"""Thumbnails are saved locally: TikTok's links expire and YouTube's change size.

Each video gets two WebP files (480 px wide for cards, 1280 px for the video
page) plus a tiny blurred placeholder stored in the database as a data URI.
"""

import base64
import io
import ipaddress
import re
import socket
import sqlite3
import urllib.request
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageFilter

from . import config

SIZES = {"sm": 480, "lg": 1280}
_HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
_MAX_BYTES = 15 * 1024 * 1024


def _check_public(url: str) -> None:
    """Thumbnail links come from the platforms' metadata. Refuse anything that
    isn't plain https to a public address, so a crafted link can't make this
    machine fetch from itself or the home network."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("thumbnail link is not https")
    for info in socket.getaddrinfo(parsed.hostname, 443, proto=socket.IPPROTO_TCP):
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise ValueError("thumbnail link points to a private address")


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_public(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_CheckedRedirects)


def _download(url: str) -> Image.Image:
    _check_public(url)
    request = urllib.request.Request(url, headers=_HEADERS)
    with _opener.open(request, timeout=20) as response:
        raw = response.read(_MAX_BYTES + 1)
    if len(raw) > _MAX_BYTES:
        raise ValueError("thumbnail is too large")
    image = Image.open(io.BytesIO(raw))
    image.load()
    return image.convert("RGB")


def _trim_letterbox(image: Image.Image) -> Image.Image:
    """Old YouTube thumbnails are 4:3 with black bars above and below a 16:9
    picture. Cut the bars so cards line up."""
    width, height = image.size
    if abs(width / height - 4 / 3) < 0.02:
        bar = round((height - width * 9 / 16) / 2)
        return image.crop((0, bar, width, height - bar))
    return image


def _resized(image: Image.Image, width: int) -> Image.Image:
    if image.width <= width:
        return image
    return image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)


def blur_data_uri(image: Image.Image) -> str:
    tiny = _resized(image, 24).filter(ImageFilter.GaussianBlur(1.2))
    buffer = io.BytesIO()
    tiny.save(buffer, "WEBP", quality=40)
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode()


def save_image(url: str, base: Path, sizes: dict[str, int], trim: bool = False) -> tuple[Image.Image, dict[str, Path]]:
    image = _download(url)
    if trim:
        image = _trim_letterbox(image)
    base.parent.mkdir(parents=True, exist_ok=True)
    written = {}
    for label, width in sizes.items():
        path = base.with_name(f"{base.name}_{label}.webp")
        _resized(image, width).save(path, "WEBP", quality=82, method=4)
        written[label] = path
    return image, written


def _make_thumb(video: dict) -> tuple | None:
    """Download and write one video's thumbnail files (no database access, so
    it is safe to run in a thread). Returns the values to store, or None."""
    url = video.get("thumb_url_original")
    if not url or not re.fullmatch(r"[\w-]{1,64}", str(video["platform_video_id"])):
        return None  # the id becomes a file name
    relative = f"thumbs/{video['platform']}/{video['platform_video_id']}"
    try:
        image, _ = save_image(url, config.DATA_DIR / relative, SIZES, trim=video["platform"] == "youtube")
    except Exception:  # noqa: BLE001 - expired link, 404, not an image
        return None
    return relative, blur_data_uri(image), "tall" if image.height > image.width else "wide", video["id"]


def store_image(conn: sqlite3.Connection, video_id: int, platform: str, name: str, image: Image.Image) -> None:
    """Thumbnail files and placeholder from a picture already in memory (a frame of a local video)."""
    relative = f"thumbs/{platform}/{name}"
    base = config.DATA_DIR / relative
    base.parent.mkdir(parents=True, exist_ok=True)
    for label, width in SIZES.items():
        _resized(image, width).save(base.with_name(f"{base.name}_{label}.webp"), "WEBP", quality=82, method=4)
    _store(conn, (relative, blur_data_uri(image), "tall" if image.height > image.width else "wide", video_id))


def _store(conn: sqlite3.Connection, made: tuple | None) -> bool:
    if made:
        conn.execute("UPDATE videos SET thumb_path = ?, thumb_blur = ?, shape = ? WHERE id = ?", made)
    return bool(made)


def save_video_thumb(conn: sqlite3.Connection, video: dict) -> bool:
    """Store one video's thumbnail. Returns False if it failed; a missing
    thumbnail must never stop a transcript."""
    return _store(conn, _make_thumb(video))


def save_missing_thumbs(conn: sqlite3.Connection, source_id: int | None = None, workers: int = 6) -> int:
    """Fetch thumbnails for every video that has a link but no local file yet."""
    query = "SELECT id, platform, platform_video_id, thumb_url_original FROM videos WHERE thumb_path IS NULL AND thumb_url_original IS NOT NULL"
    params: tuple = ()
    if source_id is not None:
        query, params = query + " AND source_id = ?", (source_id,)
    videos = [dict(row) for row in conn.execute(query, params)]
    if not videos:
        return 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return sum(_store(conn, made) for made in pool.map(_make_thumb, videos))


def save_source_art(conn: sqlite3.Connection, source_id: int, avatar_url: str | None, banner_url: str | None) -> None:
    """Channel avatar and banner (YouTube has both; TikTok gives neither)."""
    for column, url, name, width in (("avatar_path", avatar_url, "avatar", 256), ("banner_path", banner_url, "banner", 1600)):
        if not url:
            continue
        relative = f"avatars/{source_id}_{name}"
        try:
            save_image(url, config.DATA_DIR / relative, {"x": width})
        except Exception:  # noqa: BLE001
            continue
        conn.execute(f"UPDATE sources SET {column} = ? WHERE id = ?", (f"{relative}_x.webp", source_id))
