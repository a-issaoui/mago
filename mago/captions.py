"""Turn caption files into timed segments: [{"start": s, "end": s, "text": str}]."""

import html
import re

_TAG = re.compile(r"<[^>]+>")
_TIME = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})")


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub("", text))).strip()


def _seconds(stamp: str) -> float:
    hours, minutes, seconds, millis = _TIME.match(stamp.strip()).groups()
    return int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def from_json3(data: dict) -> list[dict]:
    """YouTube's json3 format. Auto-captions arrive as short rolling events;
    each event's end is clamped to the next event's start so lines don't overlap."""
    segments = []
    for event in data.get("events") or []:
        text = _clean("".join(seg.get("utf8", "") for seg in event.get("segs") or []))
        if not text:
            continue
        start = event.get("tStartMs", 0) / 1000
        segments.append({"start": start, "end": start + event.get("dDurationMs", 0) / 1000, "text": text})
    for current, following in zip(segments, segments[1:]):
        current["end"] = max(current["start"], min(current["end"], following["start"]))
    return segments


def from_vtt(vtt: str) -> list[dict]:
    """WebVTT (TikTok subtitles, and YouTube when json3 is missing). Rolling
    auto-captions repeat the previous line in each cue, so repeats are dropped."""
    segments = []
    for block in re.split(r"\n\s*\n", vtt.replace("\r\n", "\n")):
        lines = [line for line in block.split("\n") if line.strip()]
        timing = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing is None:
            continue
        start_raw, end_raw = lines[timing].split("-->")
        try:
            start, end = _seconds(start_raw), _seconds(end_raw.split()[0])
        except (AttributeError, IndexError):
            continue
        for line in lines[timing + 1:]:
            text = _clean(line)
            if not text or (segments and segments[-1]["text"] == text):
                continue
            segments.append({"start": start, "end": end, "text": text})
    return segments
