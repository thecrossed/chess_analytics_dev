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
    assert_uci("horse f3", board, "g1f3")
    assert_uci("g1 f3", board, "g1f3")
    assert_uci("马到f3", board, "g1f3")
    assert_uci("from g1 to f3", board, "g1f3")


def test_piece_synonyms_and_spoken_squares():
    board = chess.Board()
    assert_uci("peon echo four", board, "e2e4")
    assert_uci("小冰衣室", board, "e2e4")
    assert_uci("骑士 f3", board, "g1f3")


def test_capture_and_promotion_terms():
    capture_board = chess.Board("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1")
    assert_uci("pawn takes d5", capture_board, "e4d5")
    assert_uci("兵吃d5将军", capture_board, "e4d5")

    promotion_board = chess.Board("4k3/P7/8/8/8/8/8/4K3 w - - 0 1")
    assert_uci("pawn to a8 promote queen", promotion_board, "a7a8q")
    assert_uci("小兵到a8升变为后", promotion_board, "a7a8q")


def test_castle_kingside_when_legal():
    board = chess.Board()
    for san in ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]:
        board.push_san(san)
    assert_uci("castle kingside", board, "e1g1")
    assert_uci("castle", board, "e1g1")
    assert_uci("短易位", board, "e1g1")
    assert_uci("短移位", board, "e1g1")
    assert_uci("王侧易位", board, "e1g1")


def test_unspecified_castle_asks_for_confirmation_when_both_sides_legal():
    board = chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
    result = parse_user_move("castle", board)
    assert result.status == "ambiguous"
    assert set(result.candidate_moves) == {"e1g1", "e1c1"}


def test_target_square_only_asks_for_confirmation_when_ambiguous():
    board = chess.Board("4k3/8/8/8/8/8/1NP5/4KB2 w - - 0 1")
    result = parse_user_move("c4", board)
    assert result.status == "ambiguous"
    assert set(result.candidate_moves) == {"b2c4", "c2c4", "f1c4"}
    assert "Please confirm" in result.message


def test_piece_name_resolves_ambiguous_target():
    board = chess.Board("4k3/8/8/8/8/8/1NP5/4KB2 w - - 0 1")
    assert_uci("pawn to c4", board, "c2c4")
