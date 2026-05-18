import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Lightbulb, RotateCcw, SkipForward, Trash2 } from "lucide-react";
import { puzzles } from "./data/puzzles";
import { AttemptHistory } from "./components/AttemptHistory";
import { ReplayPanel } from "./components/ReplayPanel";
import { SolveBoard } from "./components/SolveBoard";
import type { MoveRecord, StoredPuzzleState } from "./types";
import { MAX_ATTEMPTS, canSubmitAttempt, makeAttempt } from "./utils/attempts";
import { loadAppState, saveAppState } from "./utils/storage";

const emptyPuzzleState: StoredPuzzleState = {
  attempts: [],
  solved: false
};

function formatSide(side: "w" | "b") {
  return side === "w" ? "White" : "Black";
}

function formatMoveList(moves: MoveRecord[]) {
  return moves
    .map((move, index) => (index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ${move.san}` : move.san))
    .join(" ");
}

function getInitialState() {
  const saved = loadAppState();
  const activePuzzleId = saved?.activePuzzleId && puzzles.some((puzzle) => puzzle.id === saved.activePuzzleId)
    ? saved.activePuzzleId
    : puzzles[0].id;

  return {
    activePuzzleId,
    puzzleStates: saved?.puzzleStates ?? {}
  };
}

export default function App() {
  const initialState = useMemo(getInitialState, []);
  const [activePuzzleId, setActivePuzzleId] = useState(initialState.activePuzzleId);
  const [puzzleStates, setPuzzleStates] = useState<Record<string, StoredPuzzleState>>(initialState.puzzleStates);
  const [chess, setChess] = useState(() => new Chess(puzzles[0].fen));
  const [currentMoves, setCurrentMoves] = useState<MoveRecord[]>([]);
  const [attemptStartedAt, setAttemptStartedAt] = useState(Date.now());
  const [lastMessage, setLastMessage] = useState("");
  const [replayAttemptId, setReplayAttemptId] = useState<string | undefined>();
  const [page, setPage] = useState<"solve" | "replay">("solve");
  const [feedback, setFeedback] = useState<"neutral" | "pending" | "correct" | "incorrect">("neutral");
  const [feedbackSquare, setFeedbackSquare] = useState<string | undefined>();
  const [hintSquare, setHintSquare] = useState<string | undefined>();
  const [awaitingNextAttempt, setAwaitingNextAttempt] = useState(false);

  const puzzle = puzzles.find((item) => item.id === activePuzzleId) ?? puzzles[0];
  const puzzleState = puzzleStates[puzzle.id] ?? emptyPuzzleState;
  const attemptsUsed = puzzleState.attempts.length;
  const locked = !canSubmitAttempt(puzzleState) || puzzleState.solved || awaitingNextAttempt;

  useEffect(() => {
    saveAppState({ activePuzzleId, puzzleStates });
  }, [activePuzzleId, puzzleStates]);

  useEffect(() => {
    resetCurrentAttempt(puzzle.fen);
    setReplayAttemptId((puzzleStates[puzzle.id] ?? emptyPuzzleState).attempts[0]?.id);
    setFeedback("neutral");
    setHintSquare(undefined);
    setAwaitingNextAttempt(false);
    setPage("solve");
  }, [puzzle.id]);

  function resetCurrentAttempt(fen = puzzle.fen) {
    setChess(new Chess(fen));
    setCurrentMoves([]);
    setAttemptStartedAt(Date.now());
  }

  function changePuzzle(puzzleId: string) {
    setActivePuzzleId(puzzleId);
    const nextPuzzle = puzzles.find((item) => item.id === puzzleId);
    if (nextPuzzle) {
      setLastMessage("");
      setFeedback("neutral");
      setFeedbackSquare(undefined);
      setHintSquare(undefined);
      setAwaitingNextAttempt(false);
      setPage("solve");
    }
  }

  function updatePuzzleState(updater: (state: StoredPuzzleState) => StoredPuzzleState) {
    setPuzzleStates((current) => ({
      ...current,
      [puzzle.id]: updater(current[puzzle.id] ?? emptyPuzzleState)
    }));
  }

  function createMoveRecord(move: ReturnType<Chess["move"]>, fenAfterMove: string, moveNumber: number): MoveRecord {
    const promotion = move.promotion;
    return {
      moveNumber,
      from: move.from,
      to: move.to,
      promotion,
      san: move.san,
      uci: `${move.from}${move.to}${promotion ?? ""}`,
      fenAfterMove,
      timestamp: Date.now()
    };
  }

  function handleDrop(from: string, to: string) {
    if (locked) return false;

    const nextChess = new Chess(chess.fen());
    const move = nextChess.move({ from, to, promotion: "q" });
    if (!move) return false;

    const record = createMoveRecord(move, nextChess.fen(), currentMoves.length + 1);
    const nextMoves = [...currentMoves, record];
    setChess(nextChess);
    setCurrentMoves(nextMoves);
    setHintSquare(undefined);

    const expectedMove = puzzle.solutionUci[currentMoves.length];
    if (record.uci !== expectedMove || nextMoves.length >= puzzle.solutionUci.length) {
      saveSubmittedAttempt(nextMoves);
      return true;
    }

    const opponentReplyUci = puzzle.solutionUci[nextMoves.length];
    if (opponentReplyUci) {
      const opponentMove = nextChess.move({
        from: opponentReplyUci.slice(0, 2),
        to: opponentReplyUci.slice(2, 4),
        promotion: opponentReplyUci.slice(4) || undefined
      });

      if (opponentMove) {
        const opponentRecord = createMoveRecord(opponentMove, nextChess.fen(), nextMoves.length + 1);
        const movesWithReply = [...nextMoves, opponentRecord];
        setChess(nextChess);
        setCurrentMoves(movesWithReply);

        if (movesWithReply.length >= puzzle.solutionUci.length) {
          saveSubmittedAttempt(movesWithReply);
          return true;
        }
      }
    }

    setFeedback("pending");
    setFeedbackSquare(undefined);
    setLastMessage("Opponent reply played automatically.");

    return true;
  }

  function saveSubmittedAttempt(movesToSubmit: MoveRecord[]) {
    if (!canSubmitAttempt(puzzleState)) return;

    const submittedAt = Date.now();
    const attemptNumber = attemptsUsed + 1;
    const attempt = makeAttempt({
      puzzle,
      moves: movesToSubmit,
      attemptNumber,
      startedAt: attemptStartedAt,
      submittedAt
    });

    updatePuzzleState((state) => ({
      attempts: [...state.attempts, attempt],
      solved: state.solved || attempt.correct
    }));

    setReplayAttemptId(attempt.id);
    setFeedbackSquare(movesToSubmit[movesToSubmit.length - 1]?.to);
    if (attempt.correct) {
      setFeedback("correct");
      setAwaitingNextAttempt(false);
      setLastMessage("Correct. Attempt saved automatically.");
    } else if (attemptNumber >= MAX_ATTEMPTS) {
      setFeedback("incorrect");
      setAwaitingNextAttempt(false);
      setLastMessage("No attempts remaining.");
    } else {
      setFeedback("incorrect");
      setAwaitingNextAttempt(true);
      setLastMessage(`Incorrect. Attempt ${attemptNumber} was saved automatically. Review the position, then start attempt ${attemptNumber + 1}.`);
    }
  }

  function startNextAttempt() {
    resetCurrentAttempt();
    setFeedback("neutral");
    setFeedbackSquare(undefined);
    setHintSquare(undefined);
    setAwaitingNextAttempt(false);
    setLastMessage(`Attempt ${attemptsUsed + 1} is ready.`);
  }

  function clearPuzzleHistory() {
    updatePuzzleState(() => emptyPuzzleState);
    resetCurrentAttempt();
    setReplayAttemptId(undefined);
    setFeedback("neutral");
    setFeedbackSquare(undefined);
    setHintSquare(undefined);
    setAwaitingNextAttempt(false);
    setLastMessage("Puzzle history cleared.");
  }

  function goToNextPuzzle() {
    const currentIndex = puzzles.findIndex((item) => item.id === puzzle.id);
    const nextPuzzle = puzzles[(currentIndex + 1) % puzzles.length];
    changePuzzle(nextPuzzle.id);
  }

  function showHint() {
    const nextSolutionMove = puzzle.solutionUci[currentMoves.length];
    if (!nextSolutionMove || locked) return;

    setHintSquare(nextSolutionMove.slice(0, 2));
  }

  function openReplay(attemptId: string) {
    setReplayAttemptId(attemptId);
    setPage("replay");
  }

  const currentMoveText = currentMoves.length
    ? formatMoveList(currentMoves)
    : "No moves in the current attempt.";

  if (page === "replay") {
    return (
      <main className="appShell">
        <ReplayPanel
          puzzle={puzzle}
          attempts={puzzleState.attempts}
          selectedAttemptId={replayAttemptId}
          onBack={() => setPage("solve")}
        />
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
          <h1>{formatSide(puzzle.sideToMove)} to move</h1>
          <p className="headerPrompt">Find the best move.</p>
        </div>
        <label className="puzzleSelect">
          Puzzle
          <select value={puzzle.id} onChange={(event) => changePuzzle(event.target.value)}>
            {puzzles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="layout">
        <section className="leftColumn">
          <div className="panel introPanel">
            <span className="attemptCounter">Attempts used: {attemptsUsed} / {MAX_ATTEMPTS}</span>
          </div>

          <SolveBoard
            key={puzzle.id}
            fen={chess.fen()}
            locked={locked}
            orientation={puzzle.sideToMove === "w" ? "white" : "black"}
            feedback={feedback}
            feedbackSquare={feedbackSquare}
            hintSquare={hintSquare}
            onDrop={handleDrop}
          />

          <section className="panel controlsPanel">
            <div className="buttonRow primaryActions">
              {awaitingNextAttempt && attemptsUsed < MAX_ATTEMPTS ? (
                <button type="button" className="primaryButton" onClick={startNextAttempt}>
                  Next attempt
                </button>
              ) : null}
              <button
                type="button"
                className="iconButton tooltipButton"
                aria-label="Hint"
                data-tooltip="Hint"
                onClick={showHint}
                disabled={locked || currentMoves.length >= puzzle.solutionUci.length}
              >
                <Lightbulb aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="iconButton tooltipButton"
                aria-label="Reset position"
                data-tooltip="Reset position"
                onClick={() => { resetCurrentAttempt(); setFeedback("neutral"); setFeedbackSquare(undefined); setHintSquare(undefined); setLastMessage("Current attempt reset."); }}
                disabled={locked || currentMoves.length === 0}
              >
                <RotateCcw aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="iconButton tooltipButton dangerIconButton"
                aria-label="Clear puzzle history"
                data-tooltip="Clear puzzle history"
                onClick={clearPuzzleHistory}
                disabled={attemptsUsed === 0 && currentMoves.length === 0}
              >
                <Trash2 aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="iconButton tooltipButton"
                aria-label="Next puzzle"
                data-tooltip="Next puzzle"
                onClick={goToNextPuzzle}
              >
                <SkipForward aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
            </div>
            {lastMessage ? <p className={`status statusBanner status-${feedback}`}>{lastMessage}</p> : null}
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <h2>Current Move List</h2>
              <span>{currentMoves.length} moves</span>
            </div>
            <p className="moveLine">{currentMoveText}</p>
          </section>
        </section>

        <aside className="rightColumn">
          <section className="panel metadataGrid">
            <div>
              <span>Difficulty</span>
              <strong>{puzzle.difficulty}</strong>
            </div>
            <div>
              <span>Themes</span>
              <strong>{puzzle.themes.join(", ")}</strong>
            </div>
            <div>
              <span>Side to move</span>
              <strong>{formatSide(puzzle.sideToMove)}</strong>
            </div>
          </section>

          <AttemptHistory attempts={puzzleState.attempts} onReplay={openReplay} />
        </aside>
      </div>
    </main>
  );
}
