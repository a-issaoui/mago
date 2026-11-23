"""The worker process: takes jobs from the queue one at a time.

Run with:  python -m mago.worker
One worker means one Whisper job on the GPU at a time and a steady, polite
pace towards YouTube and TikTok.
"""

import logging
import os
import signal
import sys
import sqlite3
import time

from . import db, fetch, jobs, library, pipeline, thumbs
from .whisper_engine import Engine

log = logging.getLogger("mago.worker")


class Worker:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.engine: Engine | None = None
        self.running = True

    def _engine(self, settings: dict) -> Engine:
        wanted = (settings["whisper_model"], settings["device"])
        if self.engine is None or (self.engine.model_name, self.engine.device_setting) != wanted:
            self.engine = Engine(*wanted)  # the old model is freed with the old engine
        return self.engine

    def run_list(self, job: dict) -> str:
        source_id = job["source_id"]
        source = self.conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
        link = library.source_link(self.conn, source_id)
        if link.kind != "video" and not (source["avatar_path"] and source["title"]):
            preview = fetch.probe(link)
            self.conn.execute(
                "UPDATE sources SET title = coalesce(?, title), handle = coalesce(?, handle) WHERE id = ?",
                (preview["title"], preview["handle"], source_id),
            )
            thumbs.save_source_art(self.conn, source_id, preview["avatar_url"], preview["banner_url"])
        result = library.sync_source(self.conn, source_id)
        priority = 10 if link.kind == "video" else 0
        for video_id in result["new_video_ids"]:
            jobs.enqueue_transcribe(self.conn, video_id, priority)
        thumbs.save_missing_thumbs(self.conn, source_id)
        if link.kind == "video" and not source["title"]:  # added without a preview (for example through MCP)
            preview = fetch.probe(link)
            self.conn.execute(
                "UPDATE sources SET title = ?, handle = coalesce(handle, ?) WHERE id = ?",
                (preview["channel"] or preview["title"], preview["handle"], source_id),
            )
        return f"listed {result['listed']}, new {result['new']}"

    def run_transcribe(self, job: dict) -> str:
        settings = db.get_settings(self.conn)
        result = pipeline.process_video(self.conn, job["video_id"], self._engine(settings))
        if result["device"]:
            db.set_runtime(self.conn, device=result["device"], model=settings["whisper_model"])
        video = library.get_video(self.conn, job["video_id"])
        if video and not video["thumb_path"]:
            thumbs.save_video_thumb(self.conn, video)
        return f"{result['status']} via {result['method'] or '-'} ({result['segments']} lines)"

    def step(self) -> bool:
        """Run one job. Returns False when the queue is empty."""
        job = jobs.claim(self.conn)
        if job is None:
            return False
        platform = None
        try:
            if job["kind"] == "list":
                platform = library.source_link(self.conn, job["source_id"]).platform
                jobs.finish(self.conn, job["id"], self.run_list(job))
            else:
                video = library.get_video(self.conn, job["video_id"])
                platform = video["platform"] if video else None
                jobs.finish(self.conn, job["id"], self.run_transcribe(job))
        except fetch.RateLimited as error:
            self._retry_or_fail(job, f"Rate limited: {error}", jobs.RATE_LIMIT_ATTEMPTS, True)
        except fetch.Unavailable as error:  # a whole source that is gone
            jobs.fail(self.conn, job, str(error))
        except Exception as error:  # noqa: BLE001 - one bad video must not stop the queue
            log.exception("job %s failed", job["id"])
            self._retry_or_fail(job, str(error) or type(error).__name__, jobs.MAX_ATTEMPTS, False)
        self._pause(platform)
        return True

    def _retry_or_fail(self, job: dict, message: str, max_attempts: int, rate_limited: bool) -> None:
        if job["attempts"] >= max_attempts:
            jobs.fail(self.conn, job, message)
        else:
            jobs.retry_later(self.conn, job, jobs.backoff_s(job["attempts"], rate_limited), message)

    def _pause(self, platform: str | None) -> None:
        settings = db.get_settings(self.conn)
        try:
            delay = float(settings["tiktok_delay_s" if platform == "tiktok" else "youtube_delay_s"])
        except ValueError:
            delay = 4.0
        self._sleep(max(0.0, min(delay, 120.0)))

    def _sleep(self, seconds: float) -> None:
        until = time.monotonic() + seconds
        while self.running and time.monotonic() < until:
            time.sleep(min(0.25, max(0.0, until - time.monotonic())))

    def run_forever(self) -> None:
        recovered = jobs.recover(self.conn)
        log.info("worker started (%d jobs recovered, yt-dlp %s)", recovered, fetch.ytdlp_version())
        last_resync_check = 0.0
        while self.running:
            db.set_runtime(self.conn, heartbeat=int(time.time()))
            if db.get_runtime(self.conn).get("reload") == "1":
                # yt-dlp was updated from Settings: start again so the new version is loaded.
                db.set_runtime(self.conn, reload="0")
                log.info("reloading after a yt-dlp update")
                self.conn.close()
                os.execv(sys.executable, [sys.executable, "-m", "mago.worker"])
            if time.monotonic() - last_resync_check > 300:
                last_resync_check = time.monotonic()
                try:
                    hours = float(db.get_settings(self.conn)["resync_hours"])
                except ValueError:
                    hours = 0.0
                queued = jobs.enqueue_due_resyncs(self.conn, hours)
                if queued:
                    log.info("scheduled re-sync: %d channels queued", queued)
            if not self.step():
                self._sleep(1.0)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    worker = Worker(db.connect())

    def stop(*_):
        worker.running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    worker.run_forever()


if __name__ == "__main__":
    main()
