# Blindfold Chess Voice MVP

Blindfold Chess Voice MVP is a local-first Streamlit prototype for playing
blindfold chess against a local Stockfish engine. The intended loop is:

Voice input -> local speech-to-text -> python-chess move validation -> local
Stockfish reply -> local text-to-speech feedback.

No cloud AI, OpenAI API, paid token API, browser cloud speech recognition, user
accounts, or remote database are used.

## What Works In This MVP

- Start a blindfold game as White or Black.
- Choose a Stockfish level: Beginner, Club, Advanced, or Strong.
- Hide the board by default, show empty coordinates, or reveal the full board.
- Record voice locally in Streamlit and transcribe with `faster-whisper`.
- Edit the transcript before submitting.
- Submit typed moves as a fallback.
- Validate all moves with `python-chess`.
- Let Stockfish reply as a local external UCI executable.
- Speak responses with local `pyttsx3` when available.
- Ask deterministic commands such as:
  - `repeat last move`
  - `read move history`
  - `what legal moves do I have?`
  - `where is my knight?`
  - `where are my pieces?`
  - `describe the position`
  - `reveal board`
  - `hide board`
  - `export PGN`
- Optionally use local Ollama for short explanations. The app still works when
  Ollama is not running.

## Setup

Use Python 3.11+ when possible.

```bash
cd blindfold-chess-voice
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

## Stockfish

Place one unmodified Stockfish binary under `resources/engines/`:

- `stockfish`
- `stockfish.exe`
- `stockfish-macos-arm64`
- `stockfish-macos-x86_64`
- `stockfish-linux-x86_64`
- `stockfish-windows-x86_64.exe`

For release builds, the correct Stockfish binary should be included
automatically. The intended end user should not need to install Stockfish
manually.

Stockfish is used only as an external UCI executable through
`python-chess`. This app does not link or modify Stockfish.

## Local Voice Input

Voice recording uses `streamlit-mic-recorder`. Speech-to-text uses
`faster-whisper` locally on the machine running Streamlit.

If `faster-whisper` or its runtime dependencies are unavailable, the app marks
voice input as unavailable and keeps the text fallback working.

Model size can be selected in the sidebar:

- `tiny`
- `base`
- `small`

The first transcription may take longer because the local model must be loaded.

## Local Voice Output

Text-to-speech uses `pyttsx3` locally. If TTS is unavailable, the response text is
still displayed in the app.

## Optional Ollama

Ollama is optional and local-only. It is used only for explanations, not for board
state, legal move validation, or engine moves.

```bash
ollama pull gemma3:4b
ollama serve
```

The default endpoint is:

```text
http://localhost:11434/api/chat
```

If Ollama is not running, local blindfold play still works.

## Stockfish GPL Note

See `licenses/` for Stockfish notice, source placeholders, and GPL placeholder.
Before distributing a release with a bundled Stockfish binary, fill in the exact
Stockfish version, binary target, source commit/tag, and include the full GPLv3
license text.

## Disclaimer

This app is not affiliated with Stockfish, Chess.com, Lichess, or Ollama.
