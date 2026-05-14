# Stockfish Engine Binaries

Place an unmodified Stockfish executable in this directory for local development.

Recognized filenames:

- `stockfish`
- `stockfish.exe`
- `stockfish-macos-arm64`
- `stockfish-macos-x86_64`
- `stockfish-linux-x86_64`
- `stockfish-windows-x86_64.exe`

The app starts Stockfish as an external UCI process through `python-chess`. It does not link Stockfish source code and does not modify Stockfish.

Release builds should include the correct binary for the target platform and complete the GPL compliance fields in `licenses/`.

