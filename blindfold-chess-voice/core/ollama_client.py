from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

import requests


DEFAULT_ENDPOINT = "http://localhost:11434/api/chat"
DEFAULT_MODEL = "gemma3:4b"
OLLAMA_SETUP_ERROR = (
    "Ollama is not running. Local play still works. To enable local explanations, "
    "start Ollama and pull gemma3:4b."
)


@dataclass(frozen=True)
class OllamaStatus:
    running: bool
    error: str | None = None


def check_ollama(endpoint: str = DEFAULT_ENDPOINT) -> OllamaStatus:
    parsed = urlparse(endpoint)
    tags_url = f"{parsed.scheme}://{parsed.netloc}/api/tags"
    try:
        response = requests.get(tags_url, timeout=2)
    except requests.RequestException:
        return OllamaStatus(False, OLLAMA_SETUP_ERROR)
    if response.status_code != 200:
        return OllamaStatus(False, OLLAMA_SETUP_ERROR)
    return OllamaStatus(True)


def ask_ollama(prompt: str, model: str = DEFAULT_MODEL, endpoint: str = DEFAULT_ENDPOINT) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "You are a blindfold chess assistant. python-chess and Stockfish are the source of truth. "
                "Do not invent board state, legal moves, tactics, or engine lines. Use only the provided FEN, "
                "legal moves, move history, and game context. Keep responses short and useful for blindfold play. "
                "If you are unsure, say that the board state should be checked by the chess engine."
            ),
        },
        {"role": "user", "content": prompt},
    ]
    try:
        response = requests.post(
            endpoint,
            json={"model": model, "messages": messages, "stream": False, "options": {"temperature": 0.2}},
            timeout=60,
        )
    except requests.RequestException as exc:
        raise RuntimeError(OLLAMA_SETUP_ERROR) from exc
    if response.status_code != 200:
        raise RuntimeError(f"Ollama returned HTTP {response.status_code}: {response.text.strip()}")
    data = response.json()
    return str(data.get("message", {}).get("content", "")).strip()
