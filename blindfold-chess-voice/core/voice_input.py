from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RecorderStatus:
    available: bool
    error: str | None = None


def check_recorder() -> RecorderStatus:
    try:
        import streamlit_mic_recorder  # noqa: F401
    except Exception as exc:
        return RecorderStatus(False, f"Voice recorder component unavailable: {exc}.")
    return RecorderStatus(True)


def render_recorder(key: str = "voice_recorder") -> bytes | None:
    from streamlit_mic_recorder import mic_recorder

    result = mic_recorder(
        start_prompt="Start recording",
        stop_prompt="Stop recording",
        just_once=False,
        use_container_width=True,
        key=key,
    )
    if not result:
        return None
    if isinstance(result, dict):
        audio = result.get("bytes") or result.get("audio")
        return audio if isinstance(audio, bytes) else None
    return None
