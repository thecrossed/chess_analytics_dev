from core.coach_prompt import SYSTEM_PROMPT, build_coach_prompt, build_move_context, describe_move_fact


def test_prompt_builder_includes_key_fields_and_no_invention_rule():
    selected = {
        "ply": 1,
        "move_number": 1,
        "side": "White",
        "fen_before": "startpos",
        "played_san": "e4",
        "played_uci": "e2e4",
        "best_move_san": "d4",
        "best_move_uci": "d2d4",
        "eval_before_cp": 20,
        "eval_after_cp": -40,
        "eval_loss_cp": 60,
        "classification": "inaccuracy",
        "pv": ["d4", "Nf6"],
    }
    context = build_move_context({}, selected, [selected], "为什么这步不好？", "club", "Chinese")
    prompt = build_coach_prompt(context)

    assert "Do not invent tactics" in SYSTEM_PROMPT
    assert "Do not claim that a move threatens" in SYSTEM_PROMPT
    assert "Do not compare against alternative candidate moves" in SYSTEM_PROMPT
    assert "Do not say the opponent has no better response" in SYSTEM_PROMPT
    assert "trust the provided move_fact field" in SYSTEM_PROMPT
    assert "Stockfish is the source of truth" in prompt
    assert "move_fact" in prompt
    assert "fen_before" in prompt
    assert "e4" in prompt
    assert "d4" in prompt
    assert "为什么这步不好？" in prompt


def test_describe_move_fact_for_e4_is_pawn_move():
    selected = {
        "fen_before": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "played_uci": "e2e4",
        "played_san": "e4",
    }

    fact = describe_move_fact(selected)

    assert "white pawn moved from e2 to e4" in fact
    assert "bishop" not in fact
