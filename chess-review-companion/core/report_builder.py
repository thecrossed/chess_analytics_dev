from __future__ import annotations

from typing import Any

from core.move_classifier import classification_counts


def build_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts = classification_counts(rows)
    losses = [int(row.get("eval_loss_cp") or 0) for row in rows]
    critical = sorted(rows, key=lambda row: int(row.get("eval_loss_cp") or 0), reverse=True)[:5]
    return {
        "total_moves": len(rows),
        "inaccuracies": counts.get("inaccuracy", 0),
        "mistakes": counts.get("mistake", 0),
        "blunders": counts.get("blunder", 0),
        "biggest_eval_loss": max(losses) if losses else 0,
        "critical_moves": critical,
    }

