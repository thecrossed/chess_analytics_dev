# ChessCoach Puzzle Trace MVP

Local React MVP for validating chess tactic solving trace recording and attempt replay.

## Product Goal

ChessCoach Puzzle Trace MVP lets a student load a tactic puzzle, play the forcing moves for the solving side, receive automatic opponent replies, and replay each automatically submitted attempt move by move. The goal is to validate whether recorded solving traces are useful before building accounts, assignments, dashboards, or analysis services.

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

## What The MVP Includes

- Five local tactic puzzles in `src/data/puzzles.ts`
- Legal move validation with `chess.js`
- Drag-and-drop board UI with `react-chessboard`
- Local role selection for logging in as coach or student
- Coach workspace for assigning local puzzles to fake students
- Student portal showing a student's assigned puzzles and personal attempt history
- Puzzle library for browsing public puzzles and creating local custom puzzles
- Optional local Stockfish generation for custom puzzle solution lines
- Student moves for the solving side with automatic opponent replies
- Up to three automatically submitted attempts per puzzle
- Exact UCI sequence matching against the puzzle solution
- LocalStorage persistence for active puzzle, solved state, and submitted attempts
- Dedicated replay page with first, previous, next, play, pause, and reset controls

## Current MVP Limitations

- No coach account yet
- No student accounts yet
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
