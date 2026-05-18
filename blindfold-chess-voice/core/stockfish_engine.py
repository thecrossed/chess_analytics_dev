from __future__ import annotations

import os
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.engine

from .settings import engine_config_for_level


ENGINE_NAMES = [
    "stockfish",
    "stockfish.exe",
    "stockfish-macos-arm64",
    "stockfish-macos-x86_64",
    "stockfish-linux-x86_64",
    "stockfish-windows-x86_64.exe",
]

MISSING_ENGINE_ERROR = (
    "Bundled Stockfish engine not found. For release builds, this app should "
    "include the correct Stockfish binary under resources/engines/."
)


@dataclass(frozen=True)
class EngineStatus:
    found: bool
    path: str | None = None
    bundled: bool = False
    version: str | None = None
    error: str | None = None


def _root() -> Path:
    return Path(__file__).resolve().parents[1]


def _is_executable(path: Path) -> bool:
    if not path.is_file():
        return False
    if os.name == "nt":
        return path.suffix.lower() == ".exe" or path.name.lower().endswith(".exe")
    mode = path.stat().st_mode
    if not mode & stat.S_IXUSR:
        try:
            path.chmod(mode | stat.S_IXUSR)
        except OSError:
            return False
    return os.access(path, os.X_OK)


def discover_engine(root: Path | None = None) -> EngineStatus:
    project_root = root or _root()
    engine_dir = project_root / "resources" / "engines"
    for name in ENGINE_NAMES:
        candidate = engine_dir / name
        if _is_executable(candidate):
            return EngineStatus(
                found=True,
                path=str(candidate),
                bundled=True,
                version=engine_version(str(candidate)),
            )
    return EngineStatus(found=False, error=MISSING_ENGINE_ERROR)


def engine_version(engine_path: str) -> str | None:
    try:
        proc = subprocess.run(
            [engine_path],
            input="uci\nquit\n",
            text=True,
            capture_output=True,
            timeout=3,
            check=False,
        )
    except Exception:
        return None
    for line in proc.stdout.splitlines():
        if line.startswith("id name"):
            return line.replace("id name", "", 1).strip()
    return None


def choose_engine_move(board: chess.Board, engine_path: str, level: str) -> chess.Move:
    config = engine_config_for_level(level)
    engine = chess.engine.SimpleEngine.popen_uci(engine_path)
    try:
        try:
            engine.configure({"Skill Level": config["skill"]})
        except chess.engine.EngineError:
            pass
        result = engine.play(board, chess.engine.Limit(time=config["movetime_ms"] / 1000))
        if result.move is None:
            raise RuntimeError("Stockfish did not return a move.")
        return result.move
    finally:
        engine.quit()
