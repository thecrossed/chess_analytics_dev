import chess

from core.position_describer import describe_position


def test_position_description_includes_turn_and_piece_squares():
    description = describe_position(chess.Board())
    assert "White to move" in description
    assert "king on e1" in description
    assert "knights on b1, g1" in description
