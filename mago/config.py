"""Paths and default settings. Everything lives under one data directory."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> None:
    """Read KEY=value lines from .env. Values already in the environment win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and key and not key.startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_env_file(ROOT / ".env")
DATA_DIR = Path(os.environ.get("MAGO_DATA", ROOT / "data"))
DB_PATH = DATA_DIR / "mago.db"
THUMBS_DIR = DATA_DIR / "thumbs"
AVATARS_DIR = DATA_DIR / "avatars"
AUDIO_DIR = DATA_DIR / "audio"
BACKUPS_DIR = DATA_DIR / "backups"

# Where the interface is opened in a browser (used in links Mago hands out).
URL = os.environ.get("MAGO_URL", "http://127.0.0.1:3010").rstrip("/")

# Optional: a file another program holds with flock while it needs the whole GPU.
# While it is held, Whisper uses the CPU.
GPU_LOCK = Path(os.environ["MAGO_GPU_LOCK"]).expanduser() if os.environ.get("MAGO_GPU_LOCK") else None

DEFAULT_SETTINGS = {
    "whisper_model": "small",
    "device": "auto",  # auto | cuda | cpu
    "language": "",  # "" = detect per video
    "translate": "0",  # "1" = Whisper task=translate (to English)
    "tiktok_delay_s": "4",  # TikTok answers 429 without a pause between requests
    # YouTube without an account allows about 300 videos an hour and yt-dlp's wiki recommends
    # 5-10 s between videos; captions are throttled separately and harder (429 after ~90 quick ones).
    "youtube_delay_s": "6",
    "youtube_per_hour": "250",  # 0 = no hourly budget
    "whisper_for_auto_captions": "0",  # "1": ignore YouTube's automatic captions (no punctuation) and listen instead
    "whisper_when_refused": "0",  # "1": when a platform refuses the captions, download the audio and listen instead
    "paused": "",  # platforms the worker must not touch: "", "youtube", "tiktok" or "youtube,tiktok"
    "skip_repeats": "1",  # don't transcribe a re-upload (same channel, same title, same length)
    "resync_hours": "0",  # check channels for new videos this often; 0 = only by hand
}


def ensure_dirs() -> None:
    for path in (DATA_DIR, THUMBS_DIR, AVATARS_DIR, AUDIO_DIR):
        path.mkdir(parents=True, exist_ok=True)
