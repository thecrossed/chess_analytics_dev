from __future__ import annotations

import tempfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class TtsStatus:
    available: bool
    error: str | None = None


def check_tts() -> TtsStatus:
    try:
        import pyttsx3  # noqa: F401
    except Exception as exc:
        return TtsStatus(False, f"Local TTS is unavailable: {exc}.")
    return TtsStatus(True)


@lru_cache(maxsize=1)
def _engine():
    import pyttsx3

    engine = pyttsx3.init()
    engine.setProperty("rate", 165)
    return engine


def speak(text: str) -> None:
    engine = _engine()
    engine.say(text)
    engine.runAndWait()


def save_audio(text: str) -> Path | None:
    try:
        engine = _engine()
        temp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        temp.close()
        path = Path(temp.name)
        engine.save_to_file(text, str(path))
        engine.runAndWait()
        return path
    except Exception:
        return None
