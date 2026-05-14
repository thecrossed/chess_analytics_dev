from core.pgn_parser import parse_pgn


def test_pgn_parser_returns_move_list():
    pgn = """
[Event "Test"]
[White "A"]
[Black "B"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *
"""
    parsed = parse_pgn(pgn)

    assert len(parsed.moves) == 4
    assert parsed.san_moves == ["e4", "e5", "Nf3", "Nc6"]
    assert parsed.headers["White"] == "A"

