from core.game_state import BlindfoldGame


def test_legal_move_updates_board():
    game = BlindfoldGame()
    ok, message, _ = game.apply_user_text("e4")
    assert ok
    assert "White plays" in message
    assert game.board.piece_at(28) is not None
    assert len(game.history) == 1


def test_illegal_move_does_not_update_board():
    game = BlindfoldGame()
    before = game.board.fen()
    ok, message, _ = game.apply_user_text("e5")
    assert not ok
    assert "illegal" in message.lower()
    assert game.board.fen() == before
    assert len(game.history) == 0


def test_rewind_to_ply_rebuilds_board_and_history():
    game = BlindfoldGame()
    game.apply_user_text("e4")
    game.board.push_san("e5")
    game._record(side="Black", san="e5", uci="e7e5", source="stockfish")
    game.apply_user_text("Nf3")

    message = game.rewind_to_ply(1)

    assert "Rewound to ply 1" in message
    assert len(game.history) == 1
    assert game.history[0].uci == "e2e4"
    assert game.board.fen().startswith("rnbqkbnr/pppppppp/8/8/4P3")
