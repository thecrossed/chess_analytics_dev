#!/usr/bin/env python3
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Dict, List


DEFAULT_EVAL_CSV = Path("sample-pgn-eval.csv")
DEFAULT_PGN = Path("sample-pgn.md")
DEFAULT_OUTPUT = Path("sample-pgn-eval-player-averages.csv")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_tag(pgn_text: str, tag_name: str) -> str:
    match = re.search(rf'^\[{re.escape(tag_name)}\s+"([^"]*)"\]\s*$', pgn_text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def parse_float(value: str) -> float | None:
    try:
        return float(str(value).strip())
    except Exception:
        return None


def mean(values: List[float]) -> str:
    if not values:
        return ""
    return f"{sum(values) / len(values):.2f}"


def main() -> None:
    pgn_text = read_text(DEFAULT_PGN)
    white_name = extract_tag(pgn_text, "White") or "White"
    black_name = extract_tag(pgn_text, "Black") or "Black"

    with DEFAULT_EVAL_CSV.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))

    grouped: Dict[str, Dict[str, object]] = {
        "white": {"player": white_name, "side": "white", "move_count": 0, "eval_gaps": [], "accuracies": []},
        "black": {"player": black_name, "side": "black", "move_count": 0, "eval_gaps": [], "accuracies": []},
    }

    for row in rows:
        side = str(row.get("side") or "").strip().lower()
        if side not in grouped:
            continue
        grouped[side]["move_count"] = int(grouped[side]["move_count"]) + 1
        eval_gap = parse_float(str(row.get("eval_gap") or ""))
        if eval_gap is not None:
            cast_list = grouped[side]["eval_gaps"]
            assert isinstance(cast_list, list)
            cast_list.append(eval_gap)
        accuracy = parse_float(str(row.get("accuracy") or ""))
        if accuracy is not None:
            cast_list = grouped[side]["accuracies"]
            assert isinstance(cast_list, list)
            cast_list.append(accuracy)

    output_rows = []
    for side in ("white", "black"):
        item = grouped[side]
        eval_gaps = item["eval_gaps"]
        accuracies = item["accuracies"]
        assert isinstance(eval_gaps, list)
        assert isinstance(accuracies, list)
        output_rows.append(
            {
                "player": item["player"],
                "side": item["side"],
                "move_count": item["move_count"],
                "avg_eval_gap": mean(eval_gaps),
                "avg_accuracy": mean(accuracies),
            }
        )

    fieldnames = ["player", "side", "move_count", "avg_eval_gap", "avg_accuracy"]
    with DEFAULT_OUTPUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(output_rows)

    print(f"Wrote {len(output_rows)} rows to {DEFAULT_OUTPUT}")


if __name__ == "__main__":
    main()
