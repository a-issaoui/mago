"""Local files: an audio or video file from this computer, kept in data/media and transcribed by Whisper."""

import json
import re
import sqlite3
import subprocess
import uuid
from pathlib import Path

from PIL import Image

from . import config, jobs, thumbs

ALLOWED = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma", ".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi"}
MAX_BYTES = 8 * 1024 * 1024 * 1024


class BadFile(ValueError):
    pass


def media_dir() -> Path:
    path = config.DATA_DIR / "media"
    path.mkdir(parents=True, exist_ok=True)
    return path


def uploads_dir() -> Path:
    path = config.DATA_DIR / "uploads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def extension(name: str) -> str:
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED:
        raise BadFile(f"Mago can't read {suffix or 'that kind of'} files. Use audio or video: {', '.join(sorted(ALLOWED))}.")
    return suffix


def _probe(path: Path) -> dict:
    """Duration and picture size, through ffprobe (None values if it can't tell)."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=60)
        data = json.loads(result.stdout or "{}")
    except Exception:  # noqa: BLE001
        return {"duration": None, "width": None, "height": None, "has_audio": True}
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video" and s.get("width")), {})
    try:
        duration = float(data.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        duration = None
    return {"duration": duration, "width": video.get("width"), "height": video.get("height"),
            "has_audio": any(s.get("codec_type") == "audio" for s in streams) or not streams}


def register(conn: sqlite3.Connection, stored: Path, original_name: str) -> int:
    """Put a file that is already in data/media into the library and queue it. Returns the video id."""
    facts = _probe(stored)
    if not facts["has_audio"]:
        stored.unlink(missing_ok=True)
        raise BadFile("That file has no sound to transcribe.")
    title = re.sub(r"[_\s]+", " ", Path(original_name).stem).strip()[:300] or "Untitled file"
    url = f"file://{stored.name}"
    source_id = conn.execute("INSERT INTO sources(platform, kind, url, title, handle) VALUES ('file', 'video', ?, 'Your files', NULL)", (url,)).lastrowid
    tall = bool(facts["width"] and facts["height"] and facts["height"] > facts["width"])
    video_id = conn.execute(
        "INSERT INTO videos(source_id, platform, platform_video_id, url, title, duration_s, shape, published_at) "
        "VALUES (?, 'file', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
        (source_id, stored.stem, url, title, facts["duration"], "tall" if tall else "wide")).lastrowid
    if facts["width"]:  # a video: take a frame as its thumbnail
        frame = stored.with_suffix(".thumb.jpg")
        try:
            subprocess.run(["ffmpeg", "-y", "-ss", str(min(5, (facts["duration"] or 10) / 4)), "-i", str(stored), "-frames:v", "1", str(frame)],
                           capture_output=True, timeout=120)
            if frame.exists():
                with Image.open(frame) as image:
                    thumbs.store_image(conn, video_id, "file", stored.stem, image.convert("RGB"))
        except Exception:  # noqa: BLE001 - a thumbnail is a nicety
            pass
        finally:
            frame.unlink(missing_ok=True)
    jobs.enqueue_transcribe(conn, video_id, priority=10)
    return video_id


def new_name(original_name: str) -> str:
    return f"{uuid.uuid4().hex[:16]}{extension(original_name)}"


def path_of(video: dict) -> Path:
    name = str(video["url"]).removeprefix("file://")
    if not re.fullmatch(r"[0-9a-f]{16}\.\w{2,5}", name):
        raise BadFile("that file reference is not valid")
    return media_dir() / name
