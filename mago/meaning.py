"""Search by meaning: passages that say the same thing in other words.

Each passage gets a vector from a small multilingual model that runs on this
computer (no service involved). A question is turned into a vector the same
way and compared with all of them. Results are blended with the word search,
so exact terms still count.
"""

import sqlite3

import numpy as np

from . import config, library

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
_model = None
_matrix: dict = {"key": None, "ids": None, "vectors": None}


def embed(texts: list[str]) -> np.ndarray:
    """Unit-length vectors, one row per text. The model (about 240 MB) loads on first use."""
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        _model = TextEmbedding(MODEL, cache_dir=str(config.DATA_DIR / "models"))
    vectors = np.array(list(_model.embed([text[:2000] for text in texts])), dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.where(norms == 0, 1, norms)


def coverage(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT (SELECT count(*) FROM passages) AS passages, (SELECT count(*) FROM passage_vectors) AS indexed").fetchone()
    return {"passages": row["passages"], "indexed": row["indexed"]}


def index_missing(conn: sqlite3.Connection, batch: int = 64) -> int:
    """Give vectors to passages that have none yet. Returns how many were done (0 = up to date)."""
    rows = conn.execute(
        "SELECT p.id, p.title, p.text FROM passages p LEFT JOIN passage_vectors x ON x.passage_id = p.id "
        "WHERE x.passage_id IS NULL ORDER BY p.id LIMIT ?", (batch,)).fetchall()
    if not rows:
        return 0
    vectors = embed([f"{row['title']}. {row['text']}" for row in rows])
    conn.executemany("INSERT OR REPLACE INTO passage_vectors(passage_id, vector) VALUES (?, ?)",
                     [(row["id"], vector.astype(np.float16).tobytes()) for row, vector in zip(rows, vectors)])
    return len(rows)


def _load(conn: sqlite3.Connection) -> tuple[np.ndarray, np.ndarray]:
    """All vectors in memory, reloaded only when the index has changed."""
    key = tuple(conn.execute("SELECT count(*), coalesce(max(passage_id), 0) FROM passage_vectors").fetchone())
    if _matrix["key"] != key:
        rows = conn.execute("SELECT passage_id, vector FROM passage_vectors ORDER BY passage_id").fetchall()
        _matrix["ids"] = np.array([row["passage_id"] for row in rows], dtype=np.int64)
        _matrix["vectors"] = (np.frombuffer(b"".join(row["vector"] for row in rows), dtype=np.float16).reshape(len(rows), -1).astype(np.float32)
                              if rows else np.zeros((0, 384), dtype=np.float32))
        _matrix["key"] = key
    return _matrix["ids"], _matrix["vectors"]


def search(conn: sqlite3.Connection, query: str, platform: str | None = None, source_id: int | None = None,
           published_after: str | None = None, limit: int = 20, per_video: int = 2, include_duplicates: bool = False) -> list[dict]:
    """Passages closest in meaning, blended with the word search (reciprocal rank fusion:
    a passage both searches like comes first). Each hit says why it is there ("match")."""
    ids, vectors = _load(conn)
    by_words = library.search_passages(conn, query, platform, source_id, published_after, limit=60, per_video=4,
                                       include_duplicates=include_duplicates)
    ranked: dict[int, float] = {}
    why: dict[int, set[str]] = {}
    for rank, hit in enumerate(by_words, start=1):
        ranked[hit["passage_id"]] = ranked.get(hit["passage_id"], 0) + 1 / (60 + rank)
        why.setdefault(hit["passage_id"], set()).add("words")
    if len(ids) and query.strip():
        scores = vectors @ embed([query])[0]
        top = np.argsort(scores)[::-1][:60]
        for rank, index in enumerate(top, start=1):
            if scores[index] < 0.35:  # too far to be the same subject
                break
            passage_id = int(ids[index])
            ranked[passage_id] = ranked.get(passage_id, 0) + 1 / (60 + rank)
            why.setdefault(passage_id, set()).add("meaning")
    if not ranked:
        return []
    filters, params = "", []
    if platform:
        filters += " AND v.platform = ?"
        params.append(platform)
    if source_id:
        filters += " AND v.source_id = ?"
        params.append(source_id)
    if published_after:
        filters += " AND v.published_at >= ?"
        params.append(published_after)
    if not include_duplicates:
        filters += " AND v.duplicate_of IS NULL"
    marks = ",".join("?" * len(ranked))
    rows = {row["passage_id"]: dict(row) for row in conn.execute(
        "SELECT p.id AS passage_id, v.id AS video_id, v.platform, v.platform_video_id, v.url, v.title, v.thumb_path, v.thumb_blur, v.shape, "
        "v.duration_s, v.published_at, v.source_id, s.title AS source_title, s.handle AS source_handle, "
        "p.start_s AS start, p.end_s AS \"end\", p.kind, p.text FROM passages p JOIN videos v ON v.id = p.video_id "
        f"JOIN sources s ON s.id = v.source_id WHERE p.id IN ({marks}){filters}", (*ranked, *params))}
    results, seen = [], {}
    for passage_id in sorted(ranked, key=ranked.get, reverse=True):
        row = rows.get(passage_id)
        if row is None or seen.get(row["video_id"], 0) >= per_video:
            continue
        seen[row["video_id"]] = seen.get(row["video_id"], 0) + 1
        reasons = why[passage_id]
        row["match"] = "words and meaning" if len(reasons) == 2 else "meaning" if "meaning" in reasons else "words"
        row["snippet"] = row["text"][:320] + ("…" if len(row["text"]) > 320 else "")
        results.append(row)
        if len(results) >= limit:
            break
    return results
