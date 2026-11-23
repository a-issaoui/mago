"""Transcribe one video: captions if the platform has them, Whisper otherwise."""

import sqlite3
from pathlib import Path

from . import config, db, fetch, library
from .whisper_engine import Engine


def whisper_hint(video: dict) -> str | None:
    """A short line of context for Whisper: the channel and title carry the names and terms it
    would otherwise guess at (it wrote "Chef Mo" for a video titled "... @Chef Moe ...")."""
    import re

    parts = [video.get("channel_name") or video.get("source_title") or "", video.get("title") or "", (video.get("description") or "")[:300]]
    text = " ".join(part.strip() for part in parts if part and part.strip())
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[#@](\w+)", r"\1", text)  # "#fyp @Chef Moe" → "fyp Chef Moe"
    text = re.sub(r"\s+", " ", text).strip()
    return text[:400] or None


def process_video(conn: sqlite3.Connection, video_id: int, engine: Engine, audio_dir: Path | None = None) -> dict:
    """Runs the whole flow for one video and records the result on its row.
    Returns {"status", "method", "segments", "device"}.

    Unavailable videos are marked 'skipped' and not raised. Rate limits and
    other failures are raised so the worker can retry them later."""
    video = library.get_video(conn, video_id)
    if video is None:
        raise LookupError(f"no video {video_id}")
    settings = db.get_settings(conn)
    audio_dir = audio_dir or config.AUDIO_DIR
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio: Path | None = None
    keep_audio = False
    try:
        if video["platform"] in ("file", "podcast"):  # no captions to look for: go straight to the audio
            if video["platform"] == "file":
                from . import files

                audio, keep_audio = files.path_of(video), True  # the file is the library's copy: keep it for playback
                if not audio.exists():
                    raise fetch.Unavailable("the file is no longer in Mago's media folder")
            else:
                from . import podcasts

                library.set_status(conn, video_id, "downloading")
                audio = podcasts.download(video["url"], audio_dir, video["platform_video_id"])
            return _listen(conn, video_id, video, engine, settings, audio)
        with fetch.VideoSession(video["url"], video["platform"], audio_dir) as session:
            library.set_status(conn, video_id, "captions")
            library.update_video(conn, video_id, session.load())
            try:
                found = None if settings["translate"] == "1" else session.captions(settings["language"])
            except fetch.RateLimited:
                if settings["whisper_when_refused"] != "1":
                    raise
                found = None  # the captions were refused: listen to the audio instead
            if found and found["auto"] and settings["whisper_for_auto_captions"] == "1":
                found = None  # automatic captions have no punctuation; the owner prefers Whisper
            if found:
                library.save_transcript(conn, video_id, found["segments"], "captions", found["language"])
                return {"status": "done", "method": "captions", "segments": len(found["segments"]), "device": None}
            library.set_status(conn, video_id, "downloading")
            audio = session.download_audio()
        video = library.get_video(conn, video_id) or video  # now with the title and channel filled in
        return _listen(conn, video_id, video, engine, settings, audio)
    except fetch.Unavailable as error:
        library.set_status(conn, video_id, "skipped", str(error)[:500])
        return {"status": "skipped", "method": None, "segments": 0, "device": None}
    finally:
        if audio is not None and not keep_audio:
            audio.unlink(missing_ok=True)  # the transcript is what we keep


def _listen(conn: sqlite3.Connection, video_id: int, video: dict, engine: Engine, settings: dict, audio: Path) -> dict:
    """Whisper on one audio file, with progress written to the video's row."""
    library.set_status(conn, video_id, "transcribing")
    last_shown = [0.0]

    def on_progress(fraction: float) -> None:
        if fraction - last_shown[0] >= 0.02 or fraction >= 1:
            last_shown[0] = fraction
            conn.execute("UPDATE videos SET progress = ? WHERE id = ?", (round(fraction, 3), video_id))

    result = engine.transcribe(audio, settings["language"] or None, settings["translate"] == "1", on_progress,
                               hint=whisper_hint(video))
    library.save_transcript(conn, video_id, result["segments"], "whisper", result["language"])
    return {"status": "done", "method": "whisper", "segments": len(result["segments"]), "device": result["device"]}
