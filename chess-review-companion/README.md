# Chess Review Companion

Chess Review Companion is a local-first MVP for reviewing chess PGNs with a bundled Stockfish engine and local Ollama explanations.

The first version is intentionally a Streamlit validation app. It proves the core workflow:

```text
PGN input -> Stockfish analysis -> move classification -> selected move context -> local Ollama explanation
```

No cloud backend, paid token API, account system, installer, subscription system, Tauri app, or Electron app is included in this phase.

## Local-First Design

- Stockfish is used as an external UCI executable process.
- Ollama runs locally at `http://localhost:11434`.
- Analysis cache is stored locally in `.cache/analysis/`.
- Core logic lives in `core/` so a future Tauri or Electron frontend can reuse it.

## Developer Setup

Use Python 3.11 or newer.

```bash
cd chess-review-companion
pip install -r requirements.txt
streamlit run app.py
```

## Stockfish Setup

The intended release build should include the correct Stockfish binary automatically. For local development, place an unmodified Stockfish executable in:

```text
resources/engines/
```

Recognized filenames:

- `stockfish`
- `stockfish.exe`
- `stockfish-macos-arm64`
- `stockfish-macos-x86_64`
- `stockfish-linux-x86_64`
- `stockfish-windows-x86_64.exe`

On macOS/Linux, make sure the binary is executable:

```bash
chmod +x resources/engines/stockfish
```

If no binary is found, the app shows:

```text
Bundled Stockfish engine not found. Please place a Stockfish binary in resources/engines/. For release builds, this app should include the correct Stockfish binary automatically.
```

## Ollama Setup

Install and start Ollama locally, then pull a model:

```bash
ollama pull qwen3:8b
```

The app defaults to `qwen3:8b`, but the model name can be changed in the sidebar. If Ollama is not running, engine analysis still works and the coach panel shows a local setup error.

## GPL / Stockfish Compliance

This app uses Stockfish as a third-party external UCI chess engine. Stockfish is licensed under GNU GPLv3. The files in `licenses/` document the notice and source-code obligations that must be completed before distributing a release build with a bundled Stockfish binary.

Before production distribution, fill in exact Stockfish version, binary target, source tag/commit, build details, and replace the GPL placeholder with the full GNU GPLv3 license text.

## Disclaimer

This project is not affiliated with Stockfish, Chess.com, or Lichess.

