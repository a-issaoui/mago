# Mago

Paste a YouTube or TikTok link (one video, or a whole channel, playlist or profile) and get searchable transcripts
with timestamps. Private and local: it runs on this machine, with no accounts, API keys or cloud services.

- Captions first (no download), local Whisper on the GPU when a video has none.
- A library built around thumbnails, a player synced with the transcript, and full-text search.
- Exports: TXT, Markdown, SRT, VTT, JSON.
- An MCP server so Claude can search and read the library.

`BRIEF.md` and `ARCHITECTURE.md` hold the original plan and research.

## Run it

```
bin/mago start      # API, worker and web interface
bin/mago status
bin/mago restart [api|worker|web]
bin/mago stop
```

Then open <https://mago.test>. Logs are in `data/logs/`.

| Process | What it does | Address |
| --- | --- | --- |
| api | FastAPI over the SQLite library | `127.0.0.1:8010` |
| worker | Lists channels, fetches captions, runs Whisper, one job at a time | none |
| web | Next.js interface; proxies `/api` and `/media` to the API | `127.0.0.1:3010` |

`https://mago.test` is served by Caddy (`mago.test { reverse_proxy 127.0.0.1:3010 }`) with a dnsmasq entry pointing
`mago.test` at `127.0.0.1`. The processes are not started at boot.

## Set up from scratch

```
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e . pytest
cd web && npm install && npm run build
```

Needs `ffmpeg`, Node 22 and, for GPU Whisper, an NVIDIA card (the CUDA libraries come from pip). Without a usable GPU
it falls back to the CPU.

## Use it from Claude (MCP)

`.mcp.json` in this folder registers the server for Claude Code sessions started here. To use it everywhere:

```
claude mcp add mago --scope user -- /path/to/mago/.venv/bin/python -m mago.mcp_server
```

Tools: `search`, `get_transcript`, `add_source`, `list_sources`. `add_source` only queues work, so the worker must be
running for anything to be transcribed.

## Tests

```
.venv/bin/python -m pytest              # offline, about 12 s
.venv/bin/python -m pytest -m network   # real YouTube and TikTok links, uses the GPU
cd web && npx tsc --noEmit && npx eslint . && npm run build
```

## How it is put together

```
mago/links.py           recognise a link (platform, video or collection)
mago/fetch.py           everything that talks to YouTube/TikTok, through yt-dlp
mago/captions.py        caption files -> timed lines
mago/whisper_engine.py  Whisper on cuda float16, CPU int8 fallback, GPU lock check
mago/pipeline.py        one video: captions, else audio + Whisper
mago/library.py         sources, videos, transcripts, search (SQLite + FTS5)
mago/jobs.py, worker.py the queue and the process that works through it
mago/thumbs.py          local WebP thumbnails, avatars, banners
mago/api.py             HTTP API + live events (SSE)
mago/mcp_server.py      MCP tools over the same database
web/                    the interface
data/                   the library: mago.db, thumbs/, avatars/, logs/ (not in git)
```

## Things to know

- **Adding a channel queues every video in it.** YouTube videos with captions take a couple of seconds each. TikTok
  has no captions, so each video is downloaded and transcribed (roughly 10 to 25 s each including the pause).
- **TikTok blocks fast requests.** The worker waits 4 s between TikTok videos (Settings, Pace) and backs off on
  HTTP 429. When TikTok or YouTube stop working altogether, press "Update yt-dlp" in Settings.
- **Unavailable videos** (private, removed, region-blocked) are marked once and not retried.
- **GPU sharing.** If `another program` holds its `gpu.lock`, or less than 1.5 GB of graphics memory is free, Whisper
  uses the CPU for that video.
- **Search matches within one spoken line**, so a phrase split across two caption lines is not found.
- **TikTok profiles have no avatar or banner** through yt-dlp; their cards use the latest thumbnails instead.
- **Terms of service.** Bulk downloading is against YouTube's and TikTok's terms. This is a private research tool;
  do not expose it to the internet.
