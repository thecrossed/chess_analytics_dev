from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


ANALYSIS_CACHE_DIR = Path(".cache") / "analysis"
COACH_CACHE_DIR = Path(".cache") / "coach"


def analysis_cache_key(pgn_text: str, depth: int, engine_version: str | None) -> str:
    payload = json.dumps(
        {"pgn": pgn_text, "depth": depth, "engine_version": engine_version or "unknown"},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def cache_path(key: str) -> Path:
    return ANALYSIS_CACHE_DIR / f"{key}.json"


def load_analysis(key: str) -> dict[str, Any] | None:
    path = cache_path(key)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_analysis(key: str, result: dict[str, Any]) -> None:
    ANALYSIS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path(key).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


def coach_cache_key(
    analysis_key: str,
    selected_ply: int,
    question: str,
    model: str,
    language: str,
    level: str,
    fast_mode: bool,
    prompt_version: str = "coach-v3-move-fact",
) -> str:
    payload = json.dumps(
        {
            "analysis_key": analysis_key,
            "selected_ply": selected_ply,
            "question": question,
            "model": model,
            "language": language,
            "level": level,
            "fast_mode": fast_mode,
            "prompt_version": prompt_version,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def coach_cache_path(key: str) -> Path:
    return COACH_CACHE_DIR / f"{key}.json"


def load_coach_answer(key: str) -> dict[str, Any] | None:
    path = coach_cache_path(key)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_coach_answer(key: str, result: dict[str, Any]) -> None:
    COACH_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    coach_cache_path(key).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
