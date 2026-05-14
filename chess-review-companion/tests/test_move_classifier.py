from core.move_classifier import classify_move


def test_move_classifier_thresholds():
    assert classify_move(0) == "good"
    assert classify_move(29) == "good"
    assert classify_move(30) == "inaccuracy"
    assert classify_move(79) == "inaccuracy"
    assert classify_move(80) == "mistake"
    assert classify_move(199) == "mistake"
    assert classify_move(200) == "blunder"


def test_move_classifier_uncertain_is_conservative():
    assert classify_move(None) == "uncertain"
    assert classify_move(250, uncertain=True) == "mistake"

