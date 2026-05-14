from __future__ import annotations

import os
import platform
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

import chess.engine


ENGINE_FILENAMES = [
    "stockfish",
    "stockfish.exe",
    "stockfish-macos-arm64",
    "stockfish-macos-x86_64",
    "stockfish-linux-x86_64",
    "stockfish-windows-x86_64.exe",
]


@dataclass(frozen=True)
class EngineDiscovery:
    found: bool
    path: str | None
    bundled: bool
    version: str | None
    error: str | None = None


class StockfishMissingError(FileNotFoundError):
    pass


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def engines_dir() -> Path:
    return project_root() / "resources" / "engines"


def _is_executable(path: Path) -> bool:
    if not path.is_file():
        return False
    if platform.system().lower().startswith("win"):
        return path.suffix.lower() == ".exe" or "stockfish" in path.name.lower()
    return os.access(path, os.X_OK)


def discover_engine() -> EngineDiscovery:
    for name in ENGINE_FILENAMES:
        candidate = engines_dir() / name
        if _is_executable(candidate):
            return EngineDiscovery(
                found=True,
                path=str(candidate),
                bundled=True,
                version=get_engine_version(str(candidate)),
            )

    return EngineDiscovery(
        found=False,
        path=None,
        bundled=False,
        version=None,
        error=(
            "Bundled Stockfish engine not found. Please place a Stockfish binary in "
            "resources/engines/. For release builds, this app should include the "
            "correct Stockfish binary automatically."
        ),
    )


def ensure_executable(path: Path) -> None:
    if platform.system().lower().startswith("win") or not path.exists():
        return
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR)


def get_engine_version(engine_path: str) -> str | None:
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
        if line.startswith("id name "):
            return line.replace("id name ", "", 1).strip()
    return None


def open_engine(engine_path: str) -> chess.engine.SimpleEngine:
    if not engine_path:
        raise StockfishMissingError(discover_engine().error or "Stockfish engine not found.")
    path = Path(engine_path)
    if not _is_executable(path):
        raise StockfishMissingError(
            "Bundled Stockfish engine not found. Please place a Stockfish binary in "
            "resources/engines/. For release builds, this app should include the "
            "correct Stockfish binary automatically."
        )
    return chess.engine.SimpleEngine.popen_uci(str(path))

