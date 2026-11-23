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

Then open <https://mago.test>. Logs are in `data/logs/`. Press Ctrl K (or /) on any screen to search what was
said, jump to a channel, or stop and resume downloads.

| Process | What it does | Address |
| --- | --- | --- |
| api | FastAPI over the SQLite library | `127.0.0.1:8010` |
| worker | Lists channels, fetches captions, runs Whisper, one job at a time | none |
| web | Next.js interface; proxies `/api` and `/media` to the API | `127.0.0.1:3010` |

`https://mago.test` is served by Caddy (`mago.test { reverse_proxy 127.0.0.1:3010 }`) with a dnsmasq entry pointing
`mago.test` at `127.0.0.1`. Run `bin/mago install-boot` once to start them with the computer (systemd user services, logs still in
`data/logs/`); `bin/mago uninstall-boot` undoes it. The same start/stop/status commands work either way.

## Set up from scratch

```
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e . pytest
cd web && npm install && npm run build
```

Needs `ffmpeg`, Node 22 and, for GPU Whisper, an NVIDIA card (the CUDA libraries come from pip). Without a usable GPU
it falls back to the CPU.

## What you can add

- **YouTube and TikTok:** a video, a channel, a playlist or a profile. Captions when they exist, Whisper otherwise.
- **Podcasts:** a feed address or an Apple Podcasts link. Each episode's audio is downloaded, transcribed and deleted.
- **Your own files:** drop an audio or video file on the paste box (or `transcribe_file` from Claude). Mago keeps
  its copy in `data/media/` so it can be played back.

## What you can do with it

- **Search** by exact words or by meaning (a small multilingual model runs locally; the worker indexes when idle).
- **Read along:** the transcript follows the player; chapters, text size, resume where you stopped; K, J, L and C keys.
- **Keep things:** highlights with notes (select text in a transcript), collections across channels, exports.
- **See the state:** Activity (live queue, stop and resume), Statistics, and whether Claude is connected.

## Use it from Claude (MCP)

`.mcp.json` in this folder registers the server for Claude Code sessions started here. To use it everywhere:

```
claude mcp add mago --scope user -- /path/to/mago/.venv/bin/python -m mago.mcp_server
```

The server gives Claude full control of Mago:

| For | Tools |
| --- | --- |
| Reading | `search`, `get_transcript` (one video), `get_channel_transcripts` (a whole channel, page by page), `list_sources`, `list_videos` |
| Adding | `transcribe` (a video link: waits and returns the transcript; a channel link: queues every video), `add_source`, `sync_source`, `retry` |
| Running | `queue_status`, `queue_control` (stop/resume), `get_settings`, `update_settings`, `export_channel`, `services` (start/stop/restart), `update_ytdlp` |
| Keeping | `list_highlights`, `list_collections`; prompts `summarize_video` and `summarize_channel` |
| Files | `transcribe_file` (a path on this computer) |
| Deleting | `remove_source`, `remove_video` (both need `confirm=True`) |

The sidebar and Settings show whether a Claude session is connected and the last tool it used.
Transcribing needs the worker to be running; the tools say so when it isn't, or when downloads are stopped.
A Claude session loads the tool list when it starts, so restart the session after the server changes.

## Tests

```
cd web && npm run e2e                  # 38 browser checks against the running app (read-only)
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
web/                    the interface: Next.js 16, Tailwind 4, shadcn/ui (Base UI), lucide icons, sonner toasts
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
- **Platform limits (researched 2026-11-23).** YouTube allows about 300 videos an hour without an account
  (yt-dlp wiki, which recommends 5-10 s between videos) and can lock the session for up to an hour beyond that.
  Captions are throttled separately and harder, per IP: Mago hit HTTP 429 after about 90 quick caption downloads.
  So Mago waits 6 s between YouTube videos and stops at 250 an hour (both in Settings). TikTok publishes no
  numbers; Mago waits 4 s between videos.
- **When a platform refuses (429).** Every waiting video of that platform is paused (2 minutes, then 4, 8, up to
  an hour) and Activity shows when it resumes. The pause does not use up a video's retries.
- **Single videos and their channel.** Adding one video never adds its channel. The video page and the paste box
  offer "the whole channel" as a separate, deliberate step. If the channel is added later, the video moves into it.
- **Stopping downloads.** Activity has "Stop all downloads" and a Stop button per platform. The video in
  progress finishes; nothing else is fetched until you resume. The choice survives restarts.
- **Duplicates.** The same video can't be stored twice (any link form, single video or inside its channel).
  A re-upload in the same channel (same title, same length) is listed but not transcribed again (Settings,
  "Skip re-uploads"). After transcription, a video that says the same words as another is marked as a repeat
  or a clip of it and left out of search. `python -m mago.reindex` rebuilds these marks.
- **Whole-channel copy and export.** A channel page has "Copy all" and "Export all": one text file, one
  Markdown file with timestamps, JSON, or a zip with Markdown and SRT per video.
- **TikTok profiles that won't list.** Some profiles can't be listed by @name (an open yt-dlp bug). Paste one
  of their videos first; "Transcribe the whole channel" on that video's page then works.
- **A video belongs to one source.** A playlist whose videos are already in a channel you added shows as empty.
- **No accounts, so two guards instead.** The API and the web server only answer to `mago.test`, `127.0.0.1` and
  `localhost` (set `MAGO_HOSTS` for the web server to change that), and every write needs an `X-Mago: 1` header.
  Together these stop another website open in the same browser from reading or changing the library.
- **Search** looks in single caption lines first (exact timestamps), then in passages of a few sentences, so a
  phrase that runs across lines is still found. The MCP search uses passages and at most two hits per video.
- **TikTok profiles have no avatar or banner** through yt-dlp; their cards use the latest thumbnails instead.
- **Terms of service.** Bulk downloading is against YouTube's and TikTok's terms. This is a private research tool;
  do not expose it to the internet.
