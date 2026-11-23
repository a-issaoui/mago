"""Transcript exports: TXT, SRT, VTT, JSON and Markdown."""

import json

from .library import timestamp_url

FORMATS = {
    "txt": "text/plain", "srt": "application/x-subrip", "vtt": "text/vtt",
    "json": "application/json", "md": "text/markdown",
}


def _stamp(seconds: float, separator: str) -> str:
    millis = int(round(seconds * 1000))
    hours, rest = divmod(millis, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    secs, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def clock(seconds: float) -> str:
    total = int(seconds)
    hours, rest = divmod(total, 3600)
    return f"{hours}:{rest // 60:02d}:{rest % 60:02d}" if hours else f"{rest // 60}:{rest % 60:02d}"


def paragraphs(segments: list[dict], gap_s: float = 2.0, max_chars: int = 600) -> list[dict]:
    """Group caption lines into readable paragraphs: break on a pause, or when
    a paragraph is long and a sentence has just ended."""
    groups: list[dict] = []
    for segment in segments:
        current = groups[-1] if groups else None
        long_enough = current and len(current["text"]) > max_chars and current["text"].rstrip().endswith((".", "?", "!"))
        if current is None or segment["start"] - current["end"] > gap_s or long_enough:
            groups.append({"start": segment["start"], "end": segment["end"], "text": segment["text"]})
        else:
            current["text"] += " " + segment["text"]
            current["end"] = segment["end"]
    return groups


def render_many(source: dict, videos: list[tuple[dict, list[dict]]], fmt: str) -> str:
    """Every transcript of a channel in one file: txt, md or json."""
    name = source.get("title") or source.get("handle") or source["url"]
    if fmt == "json":
        keys = ("platform", "platform_video_id", "url", "title", "published_at", "duration_s", "language", "method")
        return json.dumps(
            {"channel": name, "url": source["url"], "videos": [
                {**{k: video.get(k) for k in keys}, "text": " ".join(s["text"] for s in segments), "segments": segments}
                for video, segments in videos]},
            ensure_ascii=False, indent=1)
    if fmt == "md":
        parts = [f"# {name}", "", f"Source: {source['url']}", f"Videos: {len(videos)}"]
        for video, segments in videos:
            parts += ["", "---", "", "#" + render(video, segments, "md").rstrip()]
        return "\n".join(parts) + "\n"
    if fmt == "txt":
        parts = [f"{name}\n{source['url']}\n{len(videos)} videos"]
        for video, segments in videos:
            head = f"{video.get('title') or video['url']}\n{video['url']}"
            if video.get("published_at"):
                head += f"\n{video['published_at'][:10]}"
            parts.append(f"{'=' * 72}\n{head}\n\n{render(video, segments, 'txt').rstrip()}")
        return "\n\n".join(parts) + "\n"
    raise ValueError(f"unknown export format: {fmt}")


def safe_name(text: str, fallback: str = "video") -> str:
    """A file name that is safe inside a zip and on any disk."""
    import re

    cleaned = re.sub(r"[^\w\- ]+", "", text or "", flags=re.UNICODE).strip().replace(" ", "_")[:60]
    return cleaned or fallback


def render(video: dict, segments: list[dict], fmt: str) -> str:
    if fmt not in FORMATS:
        raise ValueError(f"unknown export format: {fmt}")
    if fmt == "txt":
        return "\n\n".join(p["text"] for p in paragraphs(segments)) + "\n"
    if fmt == "srt":
        return "\n".join(
            f"{i}\n{_stamp(s['start'], ',')} --> {_stamp(s['end'], ',')}\n{s['text']}\n" for i, s in enumerate(segments, 1)
        )
    if fmt == "vtt":
        return "WEBVTT\n\n" + "\n".join(
            f"{_stamp(s['start'], '.')} --> {_stamp(s['end'], '.')}\n{s['text']}\n" for s in segments
        )
    if fmt == "json":
        keys = ("platform", "platform_video_id", "url", "title", "published_at", "duration_s", "language", "method")
        return json.dumps({**{k: video.get(k) for k in keys}, "segments": segments}, ensure_ascii=False, indent=1)
    lines = [f"# {video.get('title') or video['url']}", "", f"Source: {video['url']}"]
    if video.get("published_at"):
        lines.append(f"Published: {video['published_at'][:10]}")
    lines.append(f"Transcript: {'platform captions' if video.get('method') == 'captions' else 'Whisper'}")
    for paragraph in paragraphs(segments):
        lines += ["", f"**[{clock(paragraph['start'])}]({timestamp_url(video, paragraph['start'])})** {paragraph['text']}"]
    return "\n".join(lines) + "\n"
