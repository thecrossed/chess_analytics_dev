from pathlib import Path

from core import stockfish_engine


def test_engine_discovery_handles_missing_binary_gracefully(tmp_path, monkeypatch):
    monkeypatch.setattr(stockfish_engine, "engines_dir", lambda: Path(tmp_path))

    status = stockfish_engine.discover_engine()

    assert status.found is False
    assert status.path is None
    assert "Bundled Stockfish engine not found" in (status.error or "")

