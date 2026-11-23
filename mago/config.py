"""Paths and default settings. Everything lives under one data directory."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("MAGO_DATA", ROOT / "data"))
DB_PATH = DATA_DIR / "mago.db"
THUMBS_DIR = DATA_DIR / "thumbs"
AVATARS_DIR = DATA_DIR / "avatars"
AUDIO_DIR = DATA_DIR / "audio"

# The another program project shares the single GPU through this flock.
GPU_LOCK = Path(
    os.environ.get("GPU_LOCKDIR", Path.home() / ".cache" / "gpu-share" / "measuring")
) / "gpu.lock"

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
    "paused": "",  # platforms the worker must not touch: "", "youtube", "tiktok" or "youtube,tiktok"
    "skip_repeats": "1",  # don't transcribe a re-upload (same channel, same title, same length)
    "resync_hours": "0",  # check channels for new videos this often; 0 = only by hand
}


def ensure_dirs() -> None:
    for path in (DATA_DIR, THUMBS_DIR, AVATARS_DIR, AUDIO_DIR):
        path.mkdir(parents=True, exist_ok=True)
