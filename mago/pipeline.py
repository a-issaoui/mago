"""Transcribe one video: captions if the platform has them, Whisper otherwise."""

import sqlite3
from pathlib import Path

from . import config, db, fetch, library
from .whisper_engine import Engine


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
    try:
        with fetch.VideoSession(video["url"], video["platform"], audio_dir) as session:
            library.set_status(conn, video_id, "captions")
            library.update_video(conn, video_id, session.load())
            found = None if settings["translate"] == "1" else session.captions(settings["language"])
            if found:
                library.save_transcript(conn, video_id, found["segments"], "captions", found["language"])
                return {"status": "done", "method": "captions", "segments": len(found["segments"]), "device": None}
            library.set_status(conn, video_id, "downloading")
            audio = session.download_audio()
        library.set_status(conn, video_id, "transcribing")
        last_shown = [0.0]

        def on_progress(fraction: float) -> None:
            if fraction - last_shown[0] >= 0.02 or fraction >= 1:
                last_shown[0] = fraction
                conn.execute("UPDATE videos SET progress = ? WHERE id = ?", (round(fraction, 3), video_id))

        result = engine.transcribe(audio, settings["language"] or None, settings["translate"] == "1", on_progress)
        library.save_transcript(conn, video_id, result["segments"], "whisper", result["language"])
        return {"status": "done", "method": "whisper", "segments": len(result["segments"]), "device": result["device"]}
    except fetch.Unavailable as error:
        library.set_status(conn, video_id, "skipped", str(error)[:500])
        return {"status": "skipped", "method": None, "segments": 0, "device": None}
    finally:
        if audio is not None:
            audio.unlink(missing_ok=True)  # the transcript is what we keep
