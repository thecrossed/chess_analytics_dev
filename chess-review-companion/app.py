from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pandas as pd
import chess
import chess.svg
import streamlit as st

from core.cache import (
    analysis_cache_key,
    coach_cache_key,
    load_analysis,
    load_coach_answer,
    save_analysis,
    save_coach_answer,
)
from core.coach_prompt import build_coach_prompt, build_move_context, describe_move_fact
from core.game_analyzer import analyze_game
from core.ollama_client import DEFAULT_ENDPOINT, DEFAULT_MODEL, ask_ollama, check_ollama
from core.pgn_parser import PgnParseError, metadata_summary, parse_pgn
from core.report_builder import build_summary
from core.stockfish_engine import discover_engine


ROOT = Path(__file__).resolve().parent
SAMPLE_PGN = ROOT / "examples" / "sample_game.pgn"
STOCKFISH_NOTICE = ROOT / "licenses" / "STOCKFISH_NOTICE.txt"
FAST_DEFAULT_MODEL = "deepseek-r1:1.5b"


def read_text(path: Path, fallback: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return fallback


def table_rows(rows: list[dict[str, Any]]) -> pd.DataFrame:
    visible = []
    for row in rows:
        visible.append(
            {
                "ply": row["ply"],
                "move": f"{row['move_number']}. {row['played_san']}",
                "side": row["side"],
                "eval_before": row["eval_before_cp"],
                "eval_after": row["eval_after_cp"],
                "eval_loss": row["eval_loss_cp"],
                "best_move": row["best_move_san"],
                "pv": " ".join(row.get("pv", [])),
                "classification": row["classification"],
            }
        )
    return pd.DataFrame(visible)


def critical_table(rows: list[dict[str, Any]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "move": f"{row['move_number']}. {row['played_san']}",
                "side": row["side"],
                "classification": row["classification"],
                "eval_loss": row["eval_loss_cp"],
                "best_move": row["best_move_san"],
            }
            for row in rows
        ]
    )


def render_board(fen: str, last_move_uci: str | None = None) -> None:
    try:
        board = chess.Board(fen)
    except Exception:
        st.warning("Could not render board for this position.")
        return

    last_move = None
    if last_move_uci:
        try:
            last_move = chess.Move.from_uci(last_move_uci)
        except Exception:
            last_move = None

    svg = chess.svg.board(
        board=board,
        size=420,
        lastmove=last_move,
        coordinates=True,
    )
    st.components.v1.html(svg, height=440)


def position_at_ply(rows: list[dict[str, Any]], ply: int) -> tuple[str, str | None, str]:
    if not rows:
        return chess.STARTING_FEN, None, "Start"

    bounded_ply = max(0, min(int(ply), len(rows)))
    if bounded_ply == 0:
        return rows[0]["fen_before"], None, "Start"

    row = rows[bounded_ply - 1]
    label = f"After {row['move_number']}. {row['played_san']} ({row['side']})"
    return row["fen_after"], row["played_uci"], label


def render_board_navigator(rows: list[dict[str, Any]], selected_ply: int) -> int:
    max_ply = len(rows)
    current_ply = max(1, min(int(selected_ply), max_ply))

    controls = st.columns([1, 1, 1, 1])
    if controls[0].button("First", use_container_width=True):
        current_ply = 1
    if controls[1].button("Prev", use_container_width=True):
        current_ply = max(1, current_ply - 1)
    if controls[2].button("Next", use_container_width=True):
        current_ply = min(max_ply, current_ply + 1)
    if controls[3].button("End", use_container_width=True):
        current_ply = max_ply

    current_ply = st.slider(
        "Board ply / selected move",
        min_value=1,
        max_value=max_ply,
        value=current_ply,
        step=1,
        help="This controls the selected move and the board position together.",
    )

    fen, last_move_uci, label = position_at_ply(rows, current_ply)
    st.caption(label)
    render_board(fen, last_move_uci=last_move_uci)
    return current_ply


def render_license_section(engine_status) -> None:
    with st.sidebar.expander("Open Source Licenses", expanded=False):
        st.caption("Stockfish notice")
        st.text(read_text(STOCKFISH_NOTICE, "Stockfish notice file not found."))
        st.write("Detected engine path:", engine_status.path or "Not detected")
        st.write("Bundled and detected:", "Yes" if engine_status.found and engine_status.bundled else "No")


def render_sidebar() -> dict[str, Any]:
    st.sidebar.header("Local Settings")

    engine_status = discover_engine()
    if engine_status.found:
        st.sidebar.success("Stockfish detected")
        st.sidebar.caption(engine_status.path)
        if engine_status.version:
            st.sidebar.caption(engine_status.version)
    else:
        st.sidebar.error("Stockfish missing")
        st.sidebar.caption(engine_status.error)

    ollama_status = check_ollama()
    if ollama_status.running:
        st.sidebar.success("Ollama reachable")
    else:
        st.sidebar.warning(ollama_status.error)

    fast_mode = st.sidebar.checkbox(
        "Fast Coach Mode",
        value=True,
        help="Shorter prompt, shorter answer, and local answer cache. Try deepseek-r1:1.5b for faster local replies.",
    )
    default_model = FAST_DEFAULT_MODEL if fast_mode else DEFAULT_MODEL
    model = st.sidebar.text_input("Ollama model", default_model)
    if fast_mode:
        st.sidebar.caption("Using deepseek-r1:1.5b is much faster after the first warm-up call.")
    depth = st.sidebar.selectbox("Stockfish depth", [8, 10, 12, 14], index=2)
    level = st.sidebar.selectbox("Explanation level", ["beginner", "club", "advanced"], index=1)
    language = st.sidebar.selectbox("Language", ["Chinese", "English"], index=0)

    render_license_section(engine_status)

    return {
        "engine_status": engine_status,
        "model": model.strip() or DEFAULT_MODEL,
        "fast_mode": fast_mode,
        "depth": int(depth),
        "level": level,
        "language": language,
    }


def run_analysis(pgn_text: str, depth: int, engine_status) -> dict[str, Any] | None:
    if not engine_status.found or not engine_status.path:
        st.error(engine_status.error)
        return None

    try:
        parsed = parse_pgn(pgn_text)
    except PgnParseError as exc:
        st.error(str(exc))
        return None
    except Exception as exc:
        st.error(f"PGN validation failed: {exc}")
        return None

    key = analysis_cache_key(pgn_text, depth, engine_status.version)
    cached = load_analysis(key)
    if cached:
        cached["analysis_key"] = key
        st.info("Loaded analysis from local cache.")
        return cached

    progress = st.progress(0)
    status = st.empty()

    def update(done: int, total: int) -> None:
        progress.progress(done / total)
        status.write(f"Analyzing move {done} / {total}")

    try:
        rows = analyze_game(parsed, engine_status.path, depth=depth, progress_callback=update)
    except Exception as exc:
        st.error(f"Stockfish analysis failed: {exc}")
        return None
    finally:
        status.empty()

    result = {
        "analysis_key": key,
        "metadata": metadata_summary(parsed.headers),
        "headers": parsed.headers,
        "depth": depth,
        "engine_version": engine_status.version,
        "moves": rows,
        "summary": build_summary(rows),
    }
    save_analysis(key, result)
    return result


def render_summary(summary: dict[str, Any]) -> None:
    cols = st.columns(5)
    cols[0].metric("Total moves", summary["total_moves"])
    cols[1].metric("Inaccuracies", summary["inaccuracies"])
    cols[2].metric("Mistakes", summary["mistakes"])
    cols[3].metric("Blunders", summary["blunders"])
    cols[4].metric("Biggest loss", f"{summary['biggest_eval_loss']} cp")

    st.subheader("Critical move candidates")
    st.dataframe(critical_table(summary["critical_moves"]), use_container_width=True, hide_index=True)


def render_selected_move(result: dict[str, Any], settings: dict[str, Any]) -> None:
    rows = result["moves"]
    if not rows:
        return

    st.subheader("Move table")
    st.dataframe(table_rows(rows), use_container_width=True, hide_index=True)

    if "selected_ply" not in st.session_state:
        st.session_state["selected_ply"] = 1
    st.session_state["selected_ply"] = max(1, min(int(st.session_state["selected_ply"]), len(rows)))

    labels = [
        f"{row['ply']}: {row['move_number']}. {row['played_san']} ({row['side']}, {row['classification']})"
        for row in rows
    ]
    options = dict(zip(labels, rows))
    selected_label = st.selectbox(
        "Select a move to review",
        labels,
        index=int(st.session_state["selected_ply"]) - 1,
    )
    selected = options[selected_label]
    st.session_state["selected_ply"] = int(selected["ply"])

    st.subheader("Selected move details")
    board_col, detail_col = st.columns([1, 1])
    with board_col:
        st.caption("Board navigator")
        navigated_ply = render_board_navigator(rows, selected_ply=int(selected["ply"]))
        if navigated_ply != int(selected["ply"]):
            st.session_state["selected_ply"] = navigated_ply
            st.rerun()
    with detail_col:
        st.caption("Move fact")
        st.write(describe_move_fact(selected))
        st.json(
            {
                "move": f"{selected['move_number']}. {selected['played_san']}",
                "side": selected["side"],
                "fen_before": selected["fen_before"],
                "eval_before_cp": selected["eval_before_cp"],
                "eval_after_cp": selected["eval_after_cp"],
                "eval_loss_cp": selected["eval_loss_cp"],
                "best_move": selected["best_move_san"],
                "pv": selected["pv"],
                "classification": selected["classification"],
            },
            expanded=False,
        )

    default_question = "为什么这步不好？" if settings["language"] == "Chinese" else "Why was this move bad?"
    question = st.text_area("Ask the coach", value=default_question, height=100)

    if st.button("Ask Coach"):
        context = build_move_context(
            game_metadata=result.get("metadata", {}),
            selected_move=selected,
            all_moves=rows,
            user_question=question,
            level=settings["level"],
            language=settings["language"],
        )
        prompt = build_coach_prompt(context, fast_mode=bool(settings["fast_mode"]))
        analysis_key = str(result.get("analysis_key", "uncached-analysis"))
        cache_key = coach_cache_key(
            analysis_key=analysis_key,
            selected_ply=int(selected["ply"]),
            question=question,
            model=settings["model"],
            language=settings["language"],
            level=settings["level"],
            fast_mode=bool(settings["fast_mode"]),
        )
        cached_answer = load_coach_answer(cache_key)
        if cached_answer:
            st.subheader("Coach answer")
            st.caption(f"Answer time: 0.0s (cached, original {cached_answer.get('elapsed_seconds', 0):.1f}s)")
            st.write(cached_answer.get("answer", ""))
            return

        with st.spinner("Asking local Ollama..."):
            started_at = time.perf_counter()
            try:
                answer = ask_ollama(
                    prompt,
                    model=settings["model"],
                    endpoint=DEFAULT_ENDPOINT,
                    fast_mode=bool(settings["fast_mode"]),
                )
            except RuntimeError as exc:
                st.error(str(exc))
                with st.expander("Prompt context"):
                    st.code(json.dumps(context, ensure_ascii=False, indent=2), language="json")
                return
            elapsed_seconds = time.perf_counter() - started_at
        save_coach_answer(
            cache_key,
            {
                "answer": answer,
                "elapsed_seconds": elapsed_seconds,
                "model": settings["model"],
                "fast_mode": bool(settings["fast_mode"]),
            },
        )
        st.subheader("Coach answer")
        st.caption(f"Answer time: {elapsed_seconds:.1f}s")
        st.write(answer)


def main() -> None:
    st.set_page_config(page_title="Chess Review Companion", layout="wide")
    settings = render_sidebar()

    st.title("Chess Review Companion")
    st.caption("Local PGN review with bundled Stockfish analysis and Ollama coaching.")

    sample = read_text(SAMPLE_PGN)
    pgn_text = st.text_area("Paste PGN", value=sample, height=280)

    if st.button("Analyze Game", type="primary"):
        result = run_analysis(pgn_text, settings["depth"], settings["engine_status"])
        if result:
            st.session_state["analysis_result"] = result

    result = st.session_state.get("analysis_result")
    if result:
        render_summary(result["summary"])
        render_selected_move(result, settings)


if __name__ == "__main__":
    main()
