from __future__ import annotations

from dataclasses import dataclass


LEVELS = {
    "Beginner": {"skill": 1, "movetime_ms": 200},
    "Club": {"skill": 5, "movetime_ms": 500},
    "Advanced": {"skill": 10, "movetime_ms": 800},
    "Strong": {"skill": 15, "movetime_ms": 1000},
}


@dataclass(frozen=True)
class GameSettings:
    user_color: str = "White"
    opponent_level: str = "Club"
    board_visibility: str = "Hide board"
    stt_model_size: str = "base"
    tts_enabled: bool = True
    ollama_enabled: bool = False
    ollama_model: str = "gemma3:4b"


def engine_config_for_level(level: str) -> dict[str, int]:
    return LEVELS.get(level, LEVELS["Club"])
