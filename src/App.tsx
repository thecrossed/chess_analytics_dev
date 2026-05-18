import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Lightbulb, RotateCcw, Send, SkipForward, Trash2, X } from "lucide-react";
import { puzzles } from "./data/puzzles";
import { students } from "./data/students";
import { AttemptHistory } from "./components/AttemptHistory";
import { PuzzlePreviewBoard } from "./components/PuzzlePreviewBoard";
import { ReplayPanel } from "./components/ReplayPanel";
import { SolveBoard } from "./components/SolveBoard";
import type { MoveRecord, PuzzleAssignment, StoredPuzzleState } from "./types";
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

function makePuzzleStateKey(studentId: string, puzzleId: string) {
  return `${studentId}:${puzzleId}`;
}

function describePuzzleProgress(state: StoredPuzzleState | undefined, solutionUci: string[]) {
  if (!state || state.attempts.length === 0) return "Not started";
  if (state.solved) {
    const correctAttempt = state.attempts.find((attempt) => attempt.correct);
    return correctAttempt ? `Solved in attempt ${correctAttempt.attemptNumber}` : "Solved";
  }

  const latestAttempt = state.attempts[state.attempts.length - 1];
  const mismatchIndex = latestAttempt.moves.findIndex((move, index) => move.uci !== solutionUci[index]);
  if (mismatchIndex >= 0) {
    return `Latest wrong on move ${mismatchIndex + 1}`;
  }

  return `${state.attempts.length}/${MAX_ATTEMPTS} attempts used`;
}

function getInitialState() {
  const saved = loadAppState();
  const activePuzzleId = saved?.activePuzzleId && puzzles.some((puzzle) => puzzle.id === saved.activePuzzleId)
    ? saved.activePuzzleId
    : puzzles[0].id;

  return {
    activePuzzleId,
    activeStudentId: saved?.activeStudentId && students.some((student) => student.id === saved.activeStudentId)
      ? saved.activeStudentId
      : students[0].id,
    assignments: saved?.assignments ?? [
      {
        id: "seed-student-maya-puzzle-001",
        studentId: students[0].id,
        puzzleId: puzzles[0].id,
        assignedAt: Date.now()
      }
    ],
    puzzleStates: saved?.puzzleStates ?? {}
  };
}

export default function App() {
  const initialState = useMemo(getInitialState, []);
  const [activePuzzleId, setActivePuzzleId] = useState(initialState.activePuzzleId);
  const [activeStudentId, setActiveStudentId] = useState(initialState.activeStudentId);
  const [assignments, setAssignments] = useState<PuzzleAssignment[]>(initialState.assignments);
  const [coachPuzzleId, setCoachPuzzleId] = useState(initialState.activePuzzleId);
  const [coachSelectedStudentIds, setCoachSelectedStudentIds] = useState<string[]>([initialState.activeStudentId]);
  const [puzzleStates, setPuzzleStates] = useState<Record<string, StoredPuzzleState>>(initialState.puzzleStates);
  const [chess, setChess] = useState(() => new Chess(puzzles[0].fen));
  const [currentMoves, setCurrentMoves] = useState<MoveRecord[]>([]);
  const [attemptStartedAt, setAttemptStartedAt] = useState(Date.now());
  const [lastMessage, setLastMessage] = useState("");
  const [replayAttemptId, setReplayAttemptId] = useState<string | undefined>();
  const [page, setPage] = useState<"coach" | "student" | "solve" | "replay">("student");
  const [feedback, setFeedback] = useState<"neutral" | "pending" | "correct" | "incorrect">("neutral");
  const [feedbackSquare, setFeedbackSquare] = useState<string | undefined>();
  const [hintSquare, setHintSquare] = useState<string | undefined>();
  const [awaitingNextAttempt, setAwaitingNextAttempt] = useState(false);

  const puzzle = puzzles.find((item) => item.id === activePuzzleId) ?? puzzles[0];
  const activeStudent = students.find((student) => student.id === activeStudentId) ?? students[0];
  const activePuzzleStateKey = makePuzzleStateKey(activeStudent.id, puzzle.id);
  const puzzleState = puzzleStates[activePuzzleStateKey] ?? emptyPuzzleState;
  const attemptsUsed = puzzleState.attempts.length;
  const locked = !canSubmitAttempt(puzzleState) || puzzleState.solved || awaitingNextAttempt;

  useEffect(() => {
    saveAppState({ activePuzzleId, activeStudentId, assignments, puzzleStates });
  }, [activePuzzleId, activeStudentId, assignments, puzzleStates]);

  useEffect(() => {
    resetCurrentAttempt(puzzle.fen);
    setReplayAttemptId((puzzleStates[activePuzzleStateKey] ?? emptyPuzzleState).attempts[0]?.id);
    setFeedback("neutral");
    setFeedbackSquare(undefined);
    setHintSquare(undefined);
    setAwaitingNextAttempt(false);
  }, [puzzle.id, activeStudent.id]);

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
      [activePuzzleStateKey]: updater(current[activePuzzleStateKey] ?? emptyPuzzleState)
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
    const assignedPuzzleIds = assignments
      .filter((assignment) => assignment.studentId === activeStudent.id)
      .map((assignment) => assignment.puzzleId);
    const availablePuzzles = assignedPuzzleIds.length
      ? puzzles.filter((item) => assignedPuzzleIds.includes(item.id))
      : puzzles;
    const currentIndex = availablePuzzles.findIndex((item) => item.id === puzzle.id);
    const nextPuzzle = availablePuzzles[(currentIndex + 1) % availablePuzzles.length];
    changePuzzle(nextPuzzle.id);
  }

  function assignCoachPuzzle() {
    const assignedAt = Date.now();
    const nextAssignments = coachSelectedStudentIds
      .filter((studentId) => !assignments.some((assignment) => assignment.studentId === studentId && assignment.puzzleId === coachPuzzleId))
      .map((studentId) => ({
        id: `${studentId}-${coachPuzzleId}-${assignedAt}`,
        studentId,
        puzzleId: coachPuzzleId,
        assignedAt
      }));

    if (nextAssignments.length === 0) return;
    setAssignments((current) => [...current, ...nextAssignments]);
  }

  function removeAssignment(assignmentId: string) {
    setAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId));
  }

  function toggleCoachStudent(studentId: string) {
    setCoachSelectedStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  }

  function toggleAllCoachStudents() {
    setCoachSelectedStudentIds((current) =>
      current.length === students.length ? [] : students.map((student) => student.id)
    );
  }

  function openStudentPuzzle(studentId: string, puzzleId: string) {
    setActiveStudentId(studentId);
    changePuzzle(puzzleId);
    setPage("solve");
  }

  function openStudentPage(studentId: string) {
    setActiveStudentId(studentId);
    setPage("student");
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

  if (page === "coach") {
    const coachPuzzle = puzzles.find((item) => item.id === coachPuzzleId) ?? puzzles[0];

    return (
      <main className="appShell">
        <header className="appHeader">
          <div>
            <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
            <h1>Coach workspace</h1>
            <p className="headerPrompt">Assign puzzles to students.</p>
          </div>
          <nav className="modeNav" aria-label="Workspace">
            <button type="button" className="selectedAttempt">Coach</button>
            <button type="button" onClick={() => setPage("student")}>Student page</button>
          </nav>
        </header>

        <div className="coachLayout">
          <section className="panel assignmentComposer">
            <div className="sectionHeader">
              <h2>Choose puzzle</h2>
              <span>{formatSide(coachPuzzle.sideToMove)} to move</span>
            </div>
            <div className="puzzlePickerWithPreview">
              <PuzzlePreviewBoard
                fen={coachPuzzle.fen}
                orientation={coachPuzzle.sideToMove === "w" ? "white" : "black"}
              />
              <div className="puzzlePickerDetails">
                <label className="compactField">
                  <span>Puzzle</span>
                  <select value={coachPuzzleId} onChange={(event) => setCoachPuzzleId(event.target.value)}>
                    {puzzles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="assignmentMeta">
                  <span>Difficulty {coachPuzzle.difficulty}</span>
                  {coachPuzzle.themes.map((theme) => (
                    <span key={theme}>{theme}</span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <h2>Students</h2>
              <span>{coachSelectedStudentIds.length} selected</span>
            </div>
            <button type="button" className="selectAllButton" onClick={toggleAllCoachStudents}>
              {coachSelectedStudentIds.length === students.length ? "Clear selection" : "Select all"}
            </button>
            <div className="studentChecklist">
              {students.map((student) => (
                <label key={student.id} className="studentCheck">
                  <input
                    type="checkbox"
                    checked={coachSelectedStudentIds.includes(student.id)}
                    onChange={() => toggleCoachStudent(student.id)}
                  />
                  <span>
                    <strong>{student.name}</strong>
                  </span>
                </label>
              ))}
            </div>
            <button type="button" className="primaryButton assignButton" onClick={assignCoachPuzzle} disabled={coachSelectedStudentIds.length === 0}>
              <Send aria-hidden="true" size={16} strokeWidth={2.4} />
              Assign puzzle
            </button>
          </section>

          <section className="panel assignmentBoard">
            <div className="sectionHeader">
              <h2>Assigned puzzles</h2>
              <span>{assignments.length} total</span>
            </div>
            <div className="studentAssignmentGrid">
              {students.map((student) => {
                const studentAssignments = assignments.filter((assignment) => assignment.studentId === student.id);
                return (
                  <article key={student.id} className="studentAssignmentCard">
                    <div className="attemptTopline">
                      <strong>{student.name}</strong>
                      <button type="button" className="textButton" onClick={() => openStudentPage(student.id)}>
                        View student
                      </button>
                    </div>
                    <p className="studentSummary">{studentAssignments.length} assigned puzzles</p>
                    {studentAssignments.length ? (
                      studentAssignments.map((assignment) => {
                        const assignedPuzzle = puzzles.find((item) => item.id === assignment.puzzleId);
                        const state = puzzleStates[makePuzzleStateKey(student.id, assignment.puzzleId)] ?? emptyPuzzleState;
                        if (!assignedPuzzle) return null;
                        return (
                          <button
                            type="button"
                            key={assignment.id}
                            className="assignmentRow"
                            onClick={() => openStudentPuzzle(student.id, assignedPuzzle.id)}
                          >
                            <span>{assignedPuzzle.title}</span>
                            <strong>{describePuzzleProgress(state, assignedPuzzle.solutionUci)}</strong>
                            <span
                              role="button"
                              tabIndex={0}
                              className="assignmentRemove"
                              aria-label={`Remove ${assignedPuzzle.title} from ${student.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                removeAssignment(assignment.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  removeAssignment(assignment.id);
                                }
                              }}
                            >
                              <X aria-hidden="true" size={15} strokeWidth={2.4} />
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="muted">No assignments yet.</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (page === "student") {
    const studentAssignments = assignments.filter((assignment) => assignment.studentId === activeStudent.id);

    return (
      <main className="appShell">
        <header className="appHeader">
          <div>
            <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
            <h1>{activeStudent.name}</h1>
            <p className="headerPrompt">Student puzzle page.</p>
          </div>
          <nav className="modeNav" aria-label="Workspace">
            <button type="button" onClick={() => setPage("coach")}>Coach</button>
            <button type="button" className="selectedAttempt">Student page</button>
          </nav>
        </header>

        <div className="studentPageLayout">
          <section className="panel">
            <div className="sectionHeader">
              <h2>Student</h2>
            </div>
            <select value={activeStudent.id} onChange={(event) => setActiveStudentId(event.target.value)}>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </section>

          <section className="panel assignmentBoard">
            <div className="sectionHeader">
              <h2>Assigned puzzles</h2>
              <span>{studentAssignments.length} puzzles</span>
            </div>
            <div className="studentPuzzleGrid">
              {studentAssignments.length ? (
                studentAssignments.map((assignment) => {
                  const assignedPuzzle = puzzles.find((item) => item.id === assignment.puzzleId);
                  const state = puzzleStates[makePuzzleStateKey(activeStudent.id, assignment.puzzleId)] ?? emptyPuzzleState;
                  if (!assignedPuzzle) return null;
                  return (
                    <article key={assignment.id} className="studentPuzzleCard">
                      <div className="attemptTopline">
                        <strong>{formatSide(assignedPuzzle.sideToMove)} to move</strong>
                        <span className={state.solved ? "badge success" : "badge"}>{state.solved ? "Solved" : `${state.attempts.length}/${MAX_ATTEMPTS}`}</span>
                      </div>
                      <p>{assignedPuzzle.themes.join(", ")}</p>
                      <p className="studentSummary">{describePuzzleProgress(state, assignedPuzzle.solutionUci)}</p>
                      <button type="button" className="primaryButton" onClick={() => openStudentPuzzle(activeStudent.id, assignedPuzzle.id)}>
                        View puzzle
                      </button>
                    </article>
                  );
                })
              ) : (
                <p className="muted">No puzzles assigned yet. Use the Coach workspace to assign one.</p>
              )}
            </div>
          </section>
        </div>
      </main>
    );
  }

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
          <p className="headerPrompt">{activeStudent.name}: find the best move.</p>
        </div>
        <nav className="modeNav" aria-label="Workspace">
          <button type="button" onClick={() => setPage("coach")}>Coach</button>
          <button type="button" onClick={() => setPage("student")}>Student page</button>
        </nav>
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

          <AttemptHistory attempts={puzzleState.attempts} solutionUci={puzzle.solutionUci} onReplay={openReplay} />
        </aside>
      </div>
    </main>
  );
}
