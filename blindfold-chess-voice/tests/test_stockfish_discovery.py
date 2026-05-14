from core.stockfish_engine import discover_engine


def test_stockfish_discovery_handles_missing_engine(tmp_path):
    (tmp_path / "resources" / "engines").mkdir(parents=True)
    status = discover_engine(tmp_path)
    assert not status.found
    assert "Bundled Stockfish engine not found" in status.error
