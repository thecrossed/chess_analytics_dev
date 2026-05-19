# ChessCoach Puzzle Trace MVP

Local React MVP for validating chess tactic solving trace recording, assignment, and attempt replay.

## Product Goal

ChessCoach Puzzle Trace MVP lets a student load a tactic puzzle, play the forcing moves for the solving side, receive automatic opponent replies, and replay each automatically submitted attempt move by move. The goal is to validate whether recorded solving traces, coach assignment, and lightweight local accounts are useful before building real authentication or analysis services.

## Install

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

Vite will print a local URL, usually `http://localhost:5173`.

## Run Tests

```bash
npm test
```

## Demo Accounts

- Coach: `coach@chesscoach.local` / `coach123`
- Students: `maya@chesscoach.local`, `lucas@chesscoach.local`, or `ava@chesscoach.local` / `student123`
- New coach and student accounts can also be registered locally from the login screen.

## Lichess Puzzle Import

The full local SQLite import lives outside git:

```bash
data/lichess_puzzles/lichess_puzzles.sqlite
```

Regenerate the frontend subset from that database:

```bash
python3 scripts/export_lichess_puzzles_for_app.py --limit 500
```

## What The MVP Includes

- Five hand-authored tactic puzzles in `src/data/puzzles.ts`
- 500 generated Lichess puzzles in `src/data/lichessPuzzles.ts`
- Legal move validation with `chess.js`
- Drag-and-drop board UI with `react-chessboard`
- Local coach and student login with demo accounts and browser-local registration
- Public puzzle library for adding puzzles to a coach collection
- My students page for reviewing roster progress
- Local add-student flow for expanding the coach roster
- My class page for optional student grouping and class-based assignment
- My puzzle collection page for assigning saved puzzles to fake students
- Student portal showing a student's assigned puzzles and personal attempt history
- Puzzle library for browsing public puzzles and creating local custom puzzles
- Optional local Stockfish generation for custom puzzle solution lines
- Student moves for the solving side with automatic opponent replies
- Up to three automatically submitted attempts per puzzle
- Exact UCI sequence matching against the puzzle solution
- LocalStorage persistence for active puzzle, solved state, and submitted attempts
- Cookie/local storage notice for the MVP's necessary browser storage
- Dedicated replay page with first, previous, next, play, pause, and reset controls

## Current MVP Limitations

- Demo and registered accounts are stored in browser-local MVP storage
- No secure password storage yet
- No analytics or marketing cookies yet
- No backend
- No cloud AI analysis
- No Lichess integration
- No real roster import or student login yet

## Future Roadmap

- Coach dashboard for many students
- Per-student attempt history
- Assignment due dates and bulk creation
- Limit attempts per assignment
- Disable hints, arrows, and annotations
- Tune opponent reply timing and animation
- Import puzzles from Lichess puzzle database
- Generate puzzles from student games
- Weakness diagnosis by theme, difficulty, time, and error type
