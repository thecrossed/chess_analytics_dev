from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

import requests


DEFAULT_ENDPOINT = "http://localhost:11434/api/generate"
DEFAULT_MODEL = "qwen3:8b"
OLLAMA_SETUP_ERROR = (
    "Ollama is not running. Start Ollama and pull a local model such as "
    "qwen3:8b or deepseek-r1:8b."
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
        return OllamaStatus(running=False, error=OLLAMA_SETUP_ERROR)

    if response.status_code != 200:
        return OllamaStatus(running=False, error=OLLAMA_SETUP_ERROR)
    return OllamaStatus(running=True)


def ask_ollama(
    prompt: str,
    model: str = DEFAULT_MODEL,
    endpoint: str = DEFAULT_ENDPOINT,
    fast_mode: bool = False,
) -> str:
    options = {"temperature": 0.2, "top_p": 0.8}
    if fast_mode:
        options.update({"num_predict": 180, "num_ctx": 2048})
        if model.lower().startswith("deepseek-r1"):
            # R1-style models often spend part of the budget on internal thinking
            # before producing the final response.
            options["num_predict"] = 360

    try:
        response = requests.post(
            endpoint,
            json={"model": model, "prompt": prompt, "stream": False, "options": options},
            timeout=120,
        )
    except requests.RequestException as exc:
        raise RuntimeError(OLLAMA_SETUP_ERROR) from exc

    if response.status_code != 200:
        detail = response.text.strip()
        if "connection" in detail.lower():
            raise RuntimeError(OLLAMA_SETUP_ERROR)
        raise RuntimeError(f"Ollama returned HTTP {response.status_code}: {detail}")

    data = response.json()
    return str(data.get("response", "")).strip()
