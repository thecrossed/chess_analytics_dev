from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import chess
import chess.svg
import pandas as pd
import streamlit as st

from core.cache import save_game_snapshot
from core.game_state import BlindfoldGame
from core.local_assistant import handle_command
from core.ollama_client import DEFAULT_MODEL, ask_ollama, check_ollama
from core.pgn_export import export_pgn
from core.position_describer import describe_position
from core.settings import LEVELS
from core.speech_to_text import check_stt, transcribe_audio
from core.stockfish_engine import discover_engine
from core.text_to_speech import check_tts, save_audio
from core.voice_input import check_recorder, render_recorder


ROOT = Path(__file__).resolve().parent
STOCKFISH_NOTICE = ROOT / "licenses" / "STOCKFISH_NOTICE.txt"


def read_text(path: Path, fallback: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return fallback


def game_from_state() -> BlindfoldGame:
    if "game" not in st.session_state:
        st.session_state["game"] = BlindfoldGame()
    return st.session_state["game"]


def render_sidebar() -> dict[str, Any]:
    st.sidebar.header("Game settings")
    user_color = st.sidebar.selectbox("User color", ["White", "Black"], index=0)
    opponent_level = st.sidebar.selectbox("Opponent level", list(LEVELS.keys()), index=1)
    board_visibility = st.sidebar.selectbox(
        "Board visibility mode",
        ["Hide board", "Show empty board coordinates", "Show full board"],
        index=0,
    )
    stt_model_size = st.sidebar.selectbox("STT model size", ["tiny", "base", "small"], index=1)
    tts_enabled = st.sidebar.checkbox("TTS enabled", value=True)
    ollama_enabled = st.sidebar.checkbox("Ollama enabled", value=False)
    ollama_model = st.sidebar.text_input("Ollama model", DEFAULT_MODEL)

    st.sidebar.header("System status")
    engine_status = discover_engine()
    recorder_status = check_recorder()
    stt_status = check_stt()
    tts_status = check_tts()
    ollama_status = check_ollama()

    st.sidebar.write("Stockfish detected:", "yes" if engine_status.found else "no")
    if engine_status.path:
        st.sidebar.caption(engine_status.path)
    if engine_status.version:
        st.sidebar.caption(engine_status.version)
    if engine_status.error:
        st.sidebar.warning(engine_status.error)

    st.sidebar.write("Voice recorder:", "yes" if recorder_status.available else "no")
    if recorder_status.error:
        st.sidebar.caption(recorder_status.error)
    st.sidebar.write("STT available:", "yes" if stt_status.available else "no")
    if stt_status.error:
        st.sidebar.caption(stt_status.error)
    st.sidebar.write("TTS available:", "yes" if tts_status.available else "no")
    if tts_status.error:
        st.sidebar.caption(tts_status.error)
    st.sidebar.write("Ollama running:", "yes" if ollama_status.running else "no")
    if ollama_status.error:
        st.sidebar.caption(ollama_status.error)

    with st.sidebar.expander("Open Source Licenses", expanded=False):
        st.caption("Stockfish notice")
        st.text(read_text(STOCKFISH_NOTICE, "Stockfish notice file not found."))
        st.write("Detected Stockfish path:", engine_status.path or "Not detected")
        st.write("Bundled and detected:", "Yes" if engine_status.found and engine_status.bundled else "No")

    return {
        "user_color": user_color,
        "opponent_level": opponent_level,
        "board_visibility": board_visibility,
        "stt_model_size": stt_model_size,
        "tts_enabled": tts_enabled,
        "ollama_enabled": ollama_enabled,
        "ollama_model": ollama_model.strip() or DEFAULT_MODEL,
        "engine_status": engine_status,
        "recorder_status": recorder_status,
        "stt_status": stt_status,
        "tts_status": tts_status,
        "ollama_status": ollama_status,
    }


def render_board(game: BlindfoldGame, mode: str, revealed: bool) -> None:
    if mode == "Hide board" and not revealed:
        st.info("Board hidden for blindfold training.")
        return

    board = game.board
    if mode == "Show empty board coordinates" and not revealed:
        board = chess.Board(None)

    svg = chess.svg.board(board=board, size=420, coordinates=True)
    st.components.v1.html(svg, height=440)


def move_history_df(game: BlindfoldGame) -> pd.DataFrame:
    rows = [
        {
            "ply": move.ply,
            "side": move.side,
            "move": move.san,
            "uci": move.uci,
            "source": move.source,
        }
        for move in game.history
    ]
    return pd.DataFrame(rows)


def speak_response(text: str, settings: dict[str, Any]) -> None:
    st.session_state["system_response"] = text
    if not settings["tts_enabled"] or not settings["tts_status"].available:
        return
    audio_path = save_audio(text)
    if audio_path and audio_path.exists():
        st.audio(str(audio_path))


def start_new_game(game: BlindfoldGame, settings: dict[str, Any]) -> None:
    game.reset(settings["user_color"], settings["opponent_level"])
    st.session_state["revealed"] = settings["board_visibility"] == "Show full board"
    messages = ["New game started."]
    if settings["user_color"] == "Black":
        engine_status = settings["engine_status"]
        if engine_status.found and engine_status.path:
            try:
                ok, engine_message = game.apply_engine_move(engine_status.path)
                if ok:
                    messages.append(engine_message)
            except Exception as exc:
                messages.append(f"Stockfish failed to move: {exc}")
        else:
            messages.append(engine_status.error)
    speak_response(" ".join(messages), settings)


def submit_text(text: str, game: BlindfoldGame, settings: dict[str, Any]) -> None:
    command = handle_command(text, game)
    if command.handled:
        if command.action == "reveal_board":
            st.session_state["revealed"] = True
        elif command.action == "hide_board":
            st.session_state["revealed"] = False
        speak_response(command.message, settings)
        return

    legal, user_message, _parsed = game.apply_user_text(text)
    if not legal:
        speak_response(user_message, settings)
        return

    messages = [user_message]
    engine_status = settings["engine_status"]
    if engine_status.found and engine_status.path:
        try:
            ok, engine_message = game.apply_engine_move(engine_status.path)
            if ok:
                messages.append(engine_message)
        except Exception as exc:
            messages.append(f"Stockfish failed to move: {exc}")
    else:
        messages.append(engine_status.error or "Stockfish is missing.")
    speak_response(" ".join(messages), settings)


def render_voice_input(settings: dict[str, Any]) -> None:
    st.subheader("Voice input")
    if not settings["recorder_status"].available:
        st.warning(settings["recorder_status"].error)
        return
    if not settings["stt_status"].available:
        st.warning(settings["stt_status"].error)
        return

    audio_bytes = render_recorder()
    if audio_bytes and st.button("Transcribe locally"):
        with st.spinner("Transcribing locally with faster-whisper..."):
            try:
                transcript = transcribe_audio(audio_bytes, settings["stt_model_size"])
                st.session_state["transcript"] = transcript
            except Exception as exc:
                st.error(f"Local transcription failed: {exc}")


def render_optional_ollama(game: BlindfoldGame, settings: dict[str, Any]) -> None:
    if not settings["ollama_enabled"]:
        return
    st.subheader("Optional local explanation")
    question = st.text_input("Ask local assistant", "Give me a beginner hint.")
    if st.button("Ask Ollama"):
        if not settings["ollama_status"].running:
            st.warning(settings["ollama_status"].error)
            return
        legal_moves = [game.board.san(move) for move in list(game.board.legal_moves)[:20]]
        prompt = (
            f"FEN: {game.board.fen()}\n"
            f"Move history: {[move.san for move in game.history]}\n"
            f"Legal moves sample: {legal_moves}\n"
            f"Question: {question}"
        )
        with st.spinner("Asking local Ollama..."):
            try:
                answer = ask_ollama(prompt, model=settings["ollama_model"])
                st.write(answer)
            except RuntimeError as exc:
                st.warning(str(exc))


def main() -> None:
    st.set_page_config(page_title="Blindfold Chess Voice MVP", layout="wide")
    settings = render_sidebar()
    game = game_from_state()
    st.title("Blindfold Chess Voice MVP")
    st.caption("Local voice-first blindfold chess against Stockfish. No cloud AI.")

    top = st.columns([1, 1, 1, 1])
    if top[0].button("Start New Game", type="primary", use_container_width=True):
        start_new_game(game, settings)
    if top[1].button("Reveal Board", use_container_width=True):
        st.session_state["revealed"] = True
    if top[2].button("Hide Board", use_container_width=True):
        st.session_state["revealed"] = False
    if top[3].button("Save Local Snapshot", use_container_width=True):
        path = save_game_snapshot(
            ROOT,
            {
                "fen": game.board.fen(),
                "user_color": game.user_color,
                "opponent_level": game.opponent_level,
                "history": [move.__dict__ for move in game.history],
            },
        )
        st.success(f"Saved {path.name}")

    st.subheader("Current game status")
    status_cols = st.columns(4)
    status_cols[0].metric("Turn", "White" if game.board.turn == chess.WHITE else "Black")
    status_cols[1].metric("Your color", game.user_color)
    status_cols[2].metric("Opponent", game.opponent_level)
    status_cols[3].metric("Result", game.board.result() if game.board.is_game_over() else "*")

    board_col, input_col = st.columns([1, 1])
    with board_col:
        render_board(game, settings["board_visibility"], bool(st.session_state.get("revealed", False)))
    with input_col:
        render_voice_input(settings)
        transcript = st.text_area(
            "Transcript / text fallback",
            value=st.session_state.get("transcript", ""),
            height=100,
            help="Edit the transcript before submitting. You can enter moves or commands here.",
        )
        st.session_state["transcript"] = transcript
        if st.button("Submit Move / Submit Command", use_container_width=True):
            submit_text(transcript, game, settings)
        st.subheader("System response")
        st.write(st.session_state.get("system_response", game.last_message))

    utility_cols = st.columns(3)
    if utility_cols[0].button("Describe Position", use_container_width=True):
        speak_response(describe_position(game.board, game.history), settings)
    if utility_cols[1].button("Legal Moves", use_container_width=True):
        moves = ", ".join(game.board.san(move) for move in list(game.board.legal_moves)[:30])
        speak_response(f"Legal moves: {moves}", settings)
    if utility_cols[2].button("Export PGN", use_container_width=True):
        st.session_state["exported_pgn"] = export_pgn(game)

    if "exported_pgn" in st.session_state:
        st.download_button("Download PGN", st.session_state["exported_pgn"], "blindfold-game.pgn")
        st.code(st.session_state["exported_pgn"], language="pgn")

    st.subheader("Move history")
    history = move_history_df(game)
    if history.empty:
        st.info("No moves yet.")
    else:
        st.dataframe(history, use_container_width=True, hide_index=True)

    render_optional_ollama(game, settings)

    with st.expander("Debug board state", expanded=False):
        st.code(game.board.fen())
        st.code(json.dumps([move.__dict__ for move in game.history], indent=2))


if __name__ == "__main__":
    main()
