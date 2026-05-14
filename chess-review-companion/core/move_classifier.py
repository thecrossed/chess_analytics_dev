from __future__ import annotations


def classify_move(eval_loss_cp: int | None, uncertain: bool = False) -> str:
    """Classify a move from centipawn loss.

    Mate-score conversions can be approximate in the MVP, so callers can mark a
    move as uncertain to avoid overstating the label.
    """
    if eval_loss_cp is None:
        return "uncertain"

    loss = max(0, int(eval_loss_cp))
    if uncertain:
        if loss >= 200:
            return "mistake"
        if loss >= 80:
            return "inaccuracy"
        return "good"

    if loss < 30:
        return "good"
    if loss < 80:
        return "inaccuracy"
    if loss < 200:
        return "mistake"
    return "blunder"


def classification_counts(rows: list[dict]) -> dict[str, int]:
    counts = {"good": 0, "inaccuracy": 0, "mistake": 0, "blunder": 0, "uncertain": 0}
    for row in rows:
        label = str(row.get("classification", "uncertain"))
        counts[label] = counts.get(label, 0) + 1
    return counts

