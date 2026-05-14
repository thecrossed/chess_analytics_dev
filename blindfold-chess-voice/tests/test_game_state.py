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
