# Architecture

Mago is three long-running processes and an MCP server around one SQLite database. There is no message broker,
no cache server and no separate search engine: SQLite does all three jobs, which keeps the install to two
commands.

```
            browser ──▶ web (Next.js, :3010) ──▶ api (FastAPI, :8010) ──┐
                                                                        ▼
  Claude ──▶ MCP server (stdio) ─────────────────────────────────▶  data/mago.db
                                                                        ▲
            worker: list ▸ captions or audio + Whisper ▸ index ─────────┘
```

## The processes

| Process | Code | Role |
| --- | --- | --- |
| api | `mago/api.py` | The HTTP API under `/api`, media under `/media`, and a live event stream (`/api/events`, SSE). Never talks to the platforms except to preview a pasted link. |
| worker | `mago/worker.py` | Takes one job at a time from the queue. The only process that downloads and the only one that uses the graphics card. A lock file (`data/worker.lock`) guarantees a single worker. |
| web | `web/` | The interface. It holds no data of its own: `/api` and `/media` are passed on to the API (`web/next.config.ts`). |
| MCP server | `mago/mcp_server.py` | Started by the MCP client over stdio. Reads the database directly and uses the API for changes, so both routes follow the same rules. |

`bin/mago` starts and stops the first three, either as plain background processes (pid files in `data/run/`) or
as systemd user services.

## One video, start to finish

1. **Recognise** (`links.py`). A pasted address becomes a platform (`youtube`, `tiktok`, `podcast`, `file`), a
   kind (video, channel, playlist, profile) and a stable key, so the same thing can't be added twice under
   different link forms.
2. **List** (`fetch.py`, `library.py`). A `list` job asks yt-dlp for the videos of a source without downloading
   them, saves title, date, length and thumbnail for each, and queues a `transcribe` job per new video.
3. **Transcribe** (`pipeline.py`). Captions are tried first: manual ones, then automatic ones. If there are none
   (or settings say to listen instead) the audio is downloaded, Whisper transcribes it (`whisper_engine.py`) and
   the audio is deleted.
4. **Store** (`library.py`). The text is saved as timed lines (`segments`) and as passages of a few sentences
   (`passages`). Triggers keep the two FTS5 indexes in step.
5. **Compare** (`duplicates.py`). A fingerprint of the words marks a video that repeats another, or is a clip of
   it, so search doesn't return the same sentence five times.
6. **Index for meaning** (`meaning.py`). When the queue is empty, the worker embeds passages with a small
   multilingual model for search by meaning.

## Importing a list

`lists.py` reads a list of links out of an AI's answer (JSON, with any text around it ignored), validates it with
pydantic and reports what importing would do before anything changes. Importing creates the collections and adds
each link as a source in one transaction. A single video already in the library is filed at once. A channel or
playlist is recorded in `collection_sources`; when the worker lists it, every video it returns is filed in that
collection, whether or not the video already belonged to another source. Each filed video gets a position (the link's place
in the list, then its place inside the playlist), which is what a collection sorts by, and the list's note is kept
beside the video or the playlist. Local `file://` links are never accepted
from a list.

## The queue

The `jobs` table is the queue. A job is `pending`, `running`, `done` or `failed`, with a priority (single videos
and listings go before channel backlogs), an attempt count and a `next_try_at` time. Two partial unique indexes
make it impossible to queue the same video or the same listing twice.

- A job is claimed inside `BEGIN IMMEDIATE`, so a second claimant could never take the same one.
- A worker that died mid-job has its job put back at the next start (`jobs.recover`).
- Ordinary failures are retried up to 4 times with a growing wait. Unavailable videos fail at once.
- A refusal from a platform (HTTP 429) is about this computer's address, not the video. So the whole platform is
  paused (2 minutes, doubling up to an hour), the job is released without using a retry, and the count of
  refusals in a row is kept in the database so a restart doesn't forget it.
- Pace: a fixed wait between videos per platform and an hourly budget for YouTube, both in Settings.
- "Stop downloads" is a setting the worker reads before every claim, so it survives restarts.

## The database

One file, in WAL mode, so the API can read while the worker writes.

| Tables | Hold |
| --- | --- |
| `sources`, `videos` | Channels, playlists, profiles, feeds and their videos |
| `segments`, `segments_fts` | Timed transcript lines and their full-text index |
| `passages`, `passages_fts`, `passage_vectors` | Longer passages, their full-text index, and embeddings |
| `fingerprints` | What `duplicates.py` compares |
| `jobs` | The queue |
| `collections`, `collection_videos`, `highlights`, `positions` | What the reader keeps |
| `collection_sources` | A channel or playlist filed in a collection by an imported list: each video it lists is filed there too |
| `settings`, `runtime` | Choices made in Settings; the worker's state (heartbeat, device, pauses) |
| `revision` | A counter that triggers bump on every visible change |
| `mcp_sessions` | Which Claude sessions are connected |

Schema changes are applied at start by `db._migrate`, so updating needs no manual step.

## Live updates

The API watches the `revision` counter and pushes a snapshot over SSE when it moves. The interface reloads only
the data on screen. Because the trigger lives in the database, a change made by the worker, by the API or by
Claude through MCP reaches the browser the same way.

## The graphics card

`whisper_engine.Engine` keeps the model loaded between videos. Before each video it picks a device: the card if
at least 1.5 GB is free and no other program holds `MAGO_GPU_LOCK`, otherwise the processor. A CUDA failure
mid-run falls back to the processor for that video instead of failing it. The CUDA libraries come from pip
packages and are loaded by full path, so nothing has to be installed system-wide beyond the driver.

## Boundaries

- Both servers bind to `127.0.0.1` and check the `Host` header (`TrustedHostMiddleware` in the API,
  `web/proxy.ts` in the interface).
- Every non-GET request must carry `X-Mago: 1`.
- Request bodies are validated with pydantic models; SQL is parameterised throughout.
- The two places that run a program (`services` and "Update yt-dlp") use fixed argument lists: nothing from a
  request reaches a command line.
- Transcripts, titles and descriptions are third-party text. The MCP server's instructions tell the model to
  quote them and never follow them.
