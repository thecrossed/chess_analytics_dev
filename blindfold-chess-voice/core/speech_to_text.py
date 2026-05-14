from __future__ import annotations

import tempfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class SttStatus:
    available: bool
    error: str | None = None


def check_stt() -> SttStatus:
    try:
        import faster_whisper  # noqa: F401
    except Exception as exc:
        return SttStatus(
            False,
            f"Local speech-to-text is unavailable: {exc}. Install faster-whisper dependencies, or use text input.",
        )
    return SttStatus(True)


@lru_cache(maxsize=3)
def _load_model(model_size: str):
    from faster_whisper import WhisperModel

    return WhisperModel(model_size, device="auto", compute_type="auto")


CHESS_STT_PROMPT = (
    "这是中文国际象棋走子语音。常见说法包括：我走小兵到e4，马到f3，"
    "象到b5，王翼易位，后翼易位，吃e5，升变为后。"
)


def transcribe_audio(audio_bytes: bytes, model_size: str = "base", suffix: str = ".wav") -> str:
    if not audio_bytes:
        return ""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
        temp.write(audio_bytes)
        temp_path = Path(temp.name)
    try:
        model = _load_model(model_size)
        segments, _info = model.transcribe(
            str(temp_path),
            vad_filter=True,
            language="zh",
            initial_prompt=CHESS_STT_PROMPT,
            condition_on_previous_text=False,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()
    finally:
        try:
            temp_path.unlink()
        except OSError:
            pass
