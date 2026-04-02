#!/usr/bin/env python3
"""Build an MVP pipeline for opening-forgiveness analysis.

The pipeline expects a manifest CSV with one row per game and columns:
- game_id
- pgn_path
- eval_csv_path

It creates a player-level dataset, summary tables, plots, and a markdown report.
The default manifest points at the repository's sample PGN and per-move eval CSV.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import pandas as pd
import statsmodels.formula.api as smf

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = ROOT_DIR / "book" / "opening_forgiveness_manifest.csv"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "book" / "opening_forgiveness_outputs"
MPL_CONFIG_DIR = ROOT_DIR / "book" / ".mplconfig"
MPL_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

import os

os.environ.setdefault("MPLCONFIGDIR", str(MPL_CONFIG_DIR))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


RESULT_SCORE_MAP = {
    "1-0": {"white": 1.0, "black": 0.0},
    "0-1": {"white": 0.0, "black": 1.0},
    "1/2-1/2": {"white": 0.5, "black": 0.5},
}


@dataclass(frozen=True)
class GameManifestRow:
    game_id: str
    pgn_path: Path
    eval_csv_path: Path
    source: str = ""
    source_date_or_month: str = ""
    opening_family: str = ""
    notes: str = ""


def extract_pgn_tags(pgn_text: str) -> dict[str, str]:
    tags: dict[str, str] = {}
    for match in re.finditer(r'^\[([A-Za-z0-9_]+)\s+"([^"]*)"\]\s*$', pgn_text, re.MULTILINE):
        tags[match.group(1)] = match.group(2)
    return tags


def classify_time_control(raw_value: str) -> str:
    value = (raw_value or "").strip()
    if not value:
        return "unknown"
    if "+" in value:
        base, increment = value.split("+", 1)
        try:
            total_seconds = int(base) + 40 * int(increment)
        except ValueError:
            return value
    else:
        try:
            total_seconds = int(value)
        except ValueError:
            return value

    if total_seconds < 180:
        return "bullet"
    if total_seconds < 600:
        return "blitz"
    if total_seconds < 1800:
        return "rapid"
    return "classical"


def opening_family_from_name(name: str, fallback_eco: str) -> str:
    cleaned = (name or "").strip()
    if cleaned:
        family = cleaned.split(":", 1)[0].strip()
        family = re.sub(r"\s+", " ", family)
        return family or (fallback_eco or "Unknown Opening")
    return fallback_eco or "Unknown Opening"


def coerce_numeric(value: object) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.lower().startswith("mate"):
        sign = -1.0 if "-" in text else 1.0
        return sign * 10000.0
    try:
        return float(text)
    except ValueError:
        return None


def score_for_side(result: str, side: str) -> float | None:
    return RESULT_SCORE_MAP.get(result, {}).get(side)


def elo_bucket(value: float | int | None) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "unknown"
    rating = float(value)
    if rating < 1000:
        return "<1000"
    if rating < 1400:
        return "1000-1399"
    if rating < 1800:
        return "1400-1799"
    if rating < 2200:
        return "1800-2199"
    return "2200+"


def load_manifest(path: Path) -> list[GameManifestRow]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows: list[GameManifestRow] = []
        for row in reader:
            game_id = str(row.get("game_id") or "").strip()
            pgn_path = str(row.get("pgn_path") or "").strip()
            eval_csv_path = str(row.get("eval_csv_path") or "").strip()
            if not game_id or not pgn_path or not eval_csv_path:
                continue
            rows.append(
                GameManifestRow(
                    game_id=game_id,
                    pgn_path=(path.parent / pgn_path).resolve(),
                    eval_csv_path=(path.parent / eval_csv_path).resolve(),
                    source=str(row.get("source") or "").strip(),
                    source_date_or_month=str(row.get("source_date_or_month") or "").strip(),
                    opening_family=str(row.get("opening_family") or "").strip(),
                    notes=str(row.get("notes") or "").strip(),
                )
            )
    return rows


def load_game_metadata(row: GameManifestRow) -> dict[str, object]:
    pgn_text = row.pgn_path.read_text(encoding="utf-8")
    tags = extract_pgn_tags(pgn_text)
    return {
        "game_id": row.game_id,
        "white_player": tags.get("White", ""),
        "black_player": tags.get("Black", ""),
        "white_elo": pd.to_numeric(tags.get("WhiteElo", ""), errors="coerce"),
        "black_elo": pd.to_numeric(tags.get("BlackElo", ""), errors="coerce"),
        "result": tags.get("Result", ""),
        "time_control_raw": tags.get("TimeControl", ""),
        "time_control": classify_time_control(tags.get("TimeControl", "")),
        "termination": tags.get("Termination", ""),
        "opening_eco_tag": tags.get("ECO", ""),
        "site": tags.get("Site", ""),
        "date": tags.get("Date", ""),
        "source": row.source,
        "source_date_or_month": row.source_date_or_month,
        "manifest_opening_family": row.opening_family,
        "manifest_notes": row.notes,
    }


def load_move_rows(row: GameManifestRow) -> pd.DataFrame:
    df = pd.read_csv(row.eval_csv_path)
    if "side" not in df.columns or "move_number" not in df.columns:
        raise ValueError(f"Missing required columns in {row.eval_csv_path}")
    df["game_id"] = row.game_id
    df["move_number"] = pd.to_numeric(df["move_number"], errors="coerce")
    df["ply"] = range(1, len(df) + 1)
    df["eval_gap_cp"] = pd.to_numeric(df.get("eval_gap"), errors="coerce") * 100.0
    df["opening_name"] = df.get("opening_name", "").fillna("")
    df["opening_eco"] = df.get("opening_eco", "").fillna("")
    df["opening_family"] = [
        opening_family_from_name(name, eco)
        for name, eco in zip(df["opening_name"], df["opening_eco"], strict=False)
    ]
    return df


def summarize_game_opening(move_df: pd.DataFrame, fallback_eco: str) -> tuple[str, str]:
    named_rows = move_df[
        (move_df["opening_name"].astype(str).str.strip() != "")
        | (move_df["opening_eco"].astype(str).str.strip() != "")
    ]
    if named_rows.empty:
        eco = fallback_eco or "Unknown"
        return eco, eco
    last_named = named_rows.iloc[-1]
    family = str(last_named["opening_family"] or "").strip()
    eco = str(last_named["opening_eco"] or "").strip()
    return family or eco or "Unknown", eco or fallback_eco or ""


def build_player_rows(
    game_meta: dict[str, object],
    move_df: pd.DataFrame,
    thresholds_cp: Iterable[int],
    max_move_number: int,
) -> list[dict[str, object]]:
    opening_family, opening_eco = summarize_game_opening(move_df, str(game_meta["opening_eco_tag"]))
    manifest_opening = str(game_meta.get("manifest_opening_family") or "").strip()
    if manifest_opening:
        opening_family = manifest_opening
    result = str(game_meta["result"] or "")
    output_rows: list[dict[str, object]] = []
    opening_window = move_df[move_df["move_number"] <= max_move_number].copy()

    for side in ("white", "black"):
        side_moves = opening_window[opening_window["side"] == side].copy()
        player_elo = game_meta[f"{side}_elo"]
        opp_side = "black" if side == "white" else "white"
        opp_elo = game_meta[f"{opp_side}_elo"]
        final_score = score_for_side(result, side)

        row: dict[str, object] = {
            "game_id": game_meta["game_id"],
            "player_color": side,
            "player_name": game_meta[f"{side}_player"],
            "player_elo": player_elo,
            "opp_elo": opp_elo,
            "elo_bucket": elo_bucket(player_elo),
            "time_control": game_meta["time_control"],
            "time_control_raw": game_meta["time_control_raw"],
            "opening_family": opening_family,
            "opening_eco": opening_eco,
            "result": result,
            "final_score": final_score,
            "termination": game_meta["termination"],
            "site": game_meta["site"],
            "date": game_meta["date"],
            "source": game_meta["source"],
            "source_date_or_month": game_meta["source_date_or_month"],
            "notes": game_meta["manifest_notes"],
            "opening_window_moves": int(side_moves.shape[0]),
        }

        side_moves = side_moves.sort_values(["move_number", "ply"])
        for threshold in thresholds_cp:
            threshold_rows = side_moves[side_moves["eval_gap_cp"] >= threshold]
            suffix = f"cp_{threshold}"
            row[f"error_in_first_15_{suffix}"] = int(not threshold_rows.empty)
            row[f"error_count_first_15_{suffix}"] = int(threshold_rows.shape[0])
            row[f"first_error_ply_{suffix}"] = (
                int(threshold_rows.iloc[0]["ply"]) if not threshold_rows.empty else pd.NA
            )
            row[f"first_error_move_number_{suffix}"] = (
                int(threshold_rows.iloc[0]["move_number"]) if not threshold_rows.empty else pd.NA
            )
            row[f"max_error_cp_first_15_{suffix}"] = (
                float(threshold_rows["eval_gap_cp"].max()) if not threshold_rows.empty else pd.NA
            )
            row[f"first_error_cp_{suffix}"] = (
                float(threshold_rows.iloc[0]["eval_gap_cp"]) if not threshold_rows.empty else pd.NA
            )

        output_rows.append(row)
    return output_rows


def summarize_for_threshold(
    player_df: pd.DataFrame,
    threshold: int,
    group_keys: list[str],
) -> pd.DataFrame:
    error_col = f"error_in_first_15_cp_{threshold}"
    grouped_rows: list[dict[str, object]] = []
    for group_values, group_df in player_df.groupby(group_keys, dropna=False):
        if not isinstance(group_values, tuple):
            group_values = (group_values,)
        row = {key: value for key, value in zip(group_keys, group_values, strict=False)}
        clean_df = group_df[group_df[error_col] == 0]
        error_df = group_df[group_df[error_col] == 1]
        row["n_games"] = int(group_df.shape[0])
        row["n_clean"] = int(clean_df.shape[0])
        row["n_error"] = int(error_df.shape[0])
        row["score_clean"] = clean_df["final_score"].mean()
        row["score_error"] = error_df["final_score"].mean()
        if pd.notna(row["score_clean"]) and pd.notna(row["score_error"]):
            row["drop"] = float(row["score_clean"] - row["score_error"])
        else:
            row["drop"] = pd.NA
        grouped_rows.append(row)
    return pd.DataFrame(grouped_rows).sort_values(group_keys).reset_index(drop=True)


def save_plot(df: pd.DataFrame, x_col: str, y_col: str, title: str, output_path: Path) -> None:
    plot_df = df.dropna(subset=[x_col, y_col]).copy()
    if plot_df.empty:
        return
    plot_df = plot_df.sort_values(y_col, ascending=False)
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.bar(plot_df[x_col].astype(str), plot_df[y_col].astype(float), color="#2f5d62")
    ax.set_title(title)
    ax.set_xlabel(x_col.replace("_", " ").title())
    ax.set_ylabel(y_col.replace("_", " ").title())
    ax.tick_params(axis="x", rotation=45, labelsize=9)
    ax.grid(axis="y", linestyle="--", alpha=0.25)
    fig.tight_layout()
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def save_line_plot(
    df: pd.DataFrame,
    x_col: str,
    y_col: str,
    color_col: str,
    title: str,
    output_path: Path,
) -> None:
    plot_df = df.dropna(subset=[x_col, y_col, color_col]).copy()
    if plot_df.empty:
        return
    fig, ax = plt.subplots(figsize=(10, 5))
    for label, group_df in plot_df.groupby(color_col, dropna=False):
        ax.plot(group_df[x_col].astype(str), group_df[y_col].astype(float), marker="o", label=str(label))
    ax.set_title(title)
    ax.set_xlabel(x_col.replace("_", " ").title())
    ax.set_ylabel(y_col.replace("_", " ").title())
    ax.grid(axis="y", linestyle="--", alpha=0.25)
    ax.legend(loc="best", fontsize=8)
    fig.tight_layout()
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def run_regression(player_df: pd.DataFrame, threshold: int) -> tuple[str, str]:
    error_col = f"error_in_first_15_cp_{threshold}"
    model_df = player_df[
        ["final_score", "opening_family", error_col, "player_elo", "opp_elo", "player_color", "time_control"]
    ].dropna()
    if model_df["opening_family"].nunique() < 2 or model_df[error_col].nunique() < 2:
        return ("Not enough variation to estimate the regression model.", "")

    try:
        formula = (
            f"final_score ~ C(opening_family) * {error_col} + player_elo + opp_elo "
            "+ C(player_color) + C(time_control)"
        )
        result = smf.ols(formula=formula, data=model_df).fit()
        coef_table = result.summary2().tables[1].reset_index()
        coef_csv = coef_table.to_csv(index=False)
        return (result.summary().as_text(), coef_csv)
    except Exception as exc:
        return (f"Regression failed: {exc}", "")


def write_report(
    output_dir: Path,
    manifest_rows: list[GameManifestRow],
    player_df: pd.DataFrame,
    opening_summary: pd.DataFrame,
    elo_summary: pd.DataFrame,
    time_summary: pd.DataFrame,
    regression_text: str,
    threshold: int,
) -> None:
    top_drop = opening_summary.dropna(subset=["drop"]).sort_values("drop", ascending=False).head(10)
    lines = [
        "# Opening Forgiveness MVP Report",
        "",
        "## Data Source",
        "",
        f"- Games in manifest: {len(manifest_rows)}",
        f"- Player-level rows: {len(player_df)}",
        f"- Threshold for primary mistake definition: {threshold} cp within the first 15 moves",
        "- Final score is computed from the moving player's perspective.",
        "",
        "## Sample Filters",
        "",
        "- This MVP uses whatever games are listed in the manifest CSV.",
        "- The primary opening window is the first 15 moves.",
        "- Early mistake = at least one move with eval gap >= threshold.",
        "",
        "## Main Result Snapshot",
        "",
    ]
    if top_drop.empty:
        lines.append("- Not enough multi-opening data yet to compare score drop across opening families.")
    else:
        for _, row in top_drop.iterrows():
            lines.append(
                f"- {row['opening_family']}: clean={row['score_clean']:.3f}, "
                f"error={row['score_error']:.3f}, drop={row['drop']:.3f}, "
                f"n_clean={int(row['n_clean'])}, n_error={int(row['n_error'])}"
            )
    lines.extend(
        [
            "",
            "## Stratified Outputs",
            "",
            f"- Elo summary rows: {len(elo_summary)}",
            f"- Time-control summary rows: {len(time_summary)}",
            "",
            "## Regression",
            "",
            "```text",
            regression_text.strip() or "No regression output.",
            "```",
            "",
            "## Limitations",
            "",
            "- Current conclusions depend entirely on the manifest input data.",
            "- Per-move eval gap is used as the MVP mistake proxy; this is not yet normalized by position complexity.",
            "- If the manifest contains only one opening family or one game, statistical comparison is not meaningful yet.",
        ]
    )
    (output_dir / "opening_forgiveness_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def ensure_default_manifest(path: Path) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(
        [
            "game_id,pgn_path,eval_csv_path,source,source_date_or_month,opening_family,notes",
            "sample_game_1,../sample-pgn.md,../sample-pgn-eval.csv,local_sample,2026-02,Sicilian Defense,repo sample PGN",
        ]
    )
    path.write_text(content + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the opening forgiveness MVP pipeline.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--max-move-number", type=int, default=15)
    parser.add_argument("--thresholds", nargs="+", type=int, default=[75, 100, 150])
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    ensure_default_manifest(manifest_path)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest_rows = load_manifest(manifest_path)
    if not manifest_rows:
        raise SystemExit(f"No usable rows found in manifest: {manifest_path}")

    player_rows: list[dict[str, object]] = []
    for manifest_row in manifest_rows:
        game_meta = load_game_metadata(manifest_row)
        move_df = load_move_rows(manifest_row)
        player_rows.extend(
            build_player_rows(
                game_meta=game_meta,
                move_df=move_df,
                thresholds_cp=args.thresholds,
                max_move_number=args.max_move_number,
            )
        )

    player_df = pd.DataFrame(player_rows)
    player_output = output_dir / "opening_forgiveness_analysis.csv"
    player_df.to_csv(player_output, index=False)

    primary_threshold = 100 if 100 in args.thresholds else args.thresholds[0]

    opening_summary = summarize_for_threshold(player_df, primary_threshold, ["opening_family"])
    opening_summary.to_csv(output_dir / "opening_forgiveness_summary.csv", index=False)

    elo_summary = summarize_for_threshold(player_df, primary_threshold, ["opening_family", "elo_bucket"])
    elo_summary.to_csv(output_dir / "opening_forgiveness_by_elo.csv", index=False)

    time_summary = summarize_for_threshold(player_df, primary_threshold, ["opening_family", "time_control"])
    time_summary.to_csv(output_dir / "opening_forgiveness_by_time_control.csv", index=False)

    sensitivity_rows: list[pd.DataFrame] = []
    for threshold in args.thresholds:
        threshold_summary = summarize_for_threshold(player_df, threshold, ["opening_family"])
        threshold_summary["threshold_cp"] = threshold
        sensitivity_rows.append(threshold_summary)
    pd.concat(sensitivity_rows, ignore_index=True).to_csv(
        output_dir / "opening_forgiveness_sensitivity.csv", index=False
    )

    save_plot(
        opening_summary,
        x_col="opening_family",
        y_col="drop",
        title=f"Score Drop After Early Mistake ({primary_threshold} cp threshold)",
        output_path=output_dir / "drop_by_opening.png",
    )
    save_plot(
        opening_summary,
        x_col="opening_family",
        y_col="score_error",
        title=f"Average Score in Error Games ({primary_threshold} cp threshold)",
        output_path=output_dir / "score_error_by_opening.png",
    )
    save_line_plot(
        elo_summary,
        x_col="elo_bucket",
        y_col="drop",
        color_col="opening_family",
        title="Score Drop by Elo Bucket",
        output_path=output_dir / "drop_by_elo_bin.png",
    )
    save_line_plot(
        time_summary,
        x_col="time_control",
        y_col="drop",
        color_col="opening_family",
        title="Score Drop by Time Control",
        output_path=output_dir / "drop_by_time_control.png",
    )

    regression_text, regression_csv = run_regression(player_df, primary_threshold)
    if regression_csv:
        (output_dir / "opening_forgiveness_regression_coefficients.csv").write_text(
            regression_csv, encoding="utf-8"
        )

    write_report(
        output_dir=output_dir,
        manifest_rows=manifest_rows,
        player_df=player_df,
        opening_summary=opening_summary,
        elo_summary=elo_summary,
        time_summary=time_summary,
        regression_text=regression_text,
        threshold=primary_threshold,
    )

    print(f"Wrote player dataset to: {player_output}")
    print(f"Wrote outputs under: {output_dir}")


if __name__ == "__main__":
    main()
