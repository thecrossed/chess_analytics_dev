import chess

from core.move_parser import parse_user_move


def assert_uci(text: str, board: chess.Board, uci: str) -> None:
    result = parse_user_move(text, board)
    assert result.ok, result.message
    assert result.move.uci() == uci


def test_common_opening_move_formats():
    board = chess.Board()
    assert_uci("e4", board, "e2e4")
    assert_uci("pawn to e4", board, "e2e4")
    assert_uci("我走小兵到e4", board, "e2e4")
    assert_uci("拖着小冰的衣室", board, "e2e4")


def test_knight_spoken_formats():
    board = chess.Board()
    assert_uci("knight f3", board, "g1f3")
    assert_uci("night f3", board, "g1f3")
    assert_uci("g1 f3", board, "g1f3")
    assert_uci("马到f3", board, "g1f3")


def test_castle_kingside_when_legal():
    board = chess.Board()
    for san in ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]:
        board.push_san(san)
    assert_uci("castle kingside", board, "e1g1")
