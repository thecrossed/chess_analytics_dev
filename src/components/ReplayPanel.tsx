import { useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { Attempt, Puzzle } from "../types";
import { applyMovesToFen } from "../utils/attempts";

type ReplayPanelProps = {
  puzzle: Puzzle;
  attempts: Attempt[];
  selectedAttemptId?: string;
  onBack: () => void;
};

export function ReplayPanel({ puzzle, attempts, selectedAttemptId: requestedAttemptId, onBack }: ReplayPanelProps) {
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | undefined>(requestedAttemptId ?? attempts[0]?.id);
  const [moveIndex, setMoveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const selectedAttempt = useMemo(
    () => attempts.find((attempt) => attempt.id === selectedAttemptId),
    [attempts, selectedAttemptId]
  );

  useEffect(() => {
    if (!selectedAttemptId || !attempts.some((attempt) => attempt.id === selectedAttemptId)) {
      setSelectedAttemptId(attempts[0]?.id);
      setMoveIndex(0);
      setPlaying(false);
    }
  }, [attempts, selectedAttemptId]);

  useEffect(() => {
    if (requestedAttemptId && requestedAttemptId !== selectedAttemptId) {
      setSelectedAttemptId(requestedAttemptId);
      setMoveIndex(0);
      setPlaying(false);
    }
  }, [requestedAttemptId, selectedAttemptId]);

  useEffect(() => {
    if (!playing || !selectedAttempt) return;

    const timer = window.setInterval(() => {
      setMoveIndex((current) => {
        if (current >= selectedAttempt.moves.length) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 900);

    return () => window.clearInterval(timer);
  }, [playing, selectedAttempt]);

  const replayFen = selectedAttempt ? applyMovesToFen(puzzle.fen, selectedAttempt.moves, moveIndex) : puzzle.fen;
  const currentMove = selectedAttempt?.moves[Math.max(0, moveIndex - 1)];
  const maxMoveIndex = selectedAttempt?.moves.length ?? 0;

  function chooseAttempt(attempt: Attempt) {
    setSelectedAttemptId(attempt.id);
    setMoveIndex(0);
    setPlaying(false);
  }

  return (
    <section className="panel replayPagePanel">
      <div className="replayPageHeader">
        <div>
          <p className="eyebrow">Attempt Replay</p>
          <h2>{puzzle.id}</h2>
        </div>
        <button type="button" onClick={onBack}>
          Back to puzzle
        </button>
      </div>

      <div className="sectionHeader replaySubhead">
        {selectedAttempt ? <span>Attempt {selectedAttempt.attemptNumber}</span> : <span>No attempts yet</span>}
        {selectedAttempt ? (
          <span className={selectedAttempt.correct ? "badge success" : "badge error"}>
            {selectedAttempt.correct ? "Correct" : "Incorrect"}
          </span>
        ) : null}
      </div>

      <div className="replayBoard">
        <Chessboard
          options={{
            id: "replay-board",
            position: replayFen,
            boardOrientation: puzzle.sideToMove === "w" ? "white" : "black",
            allowDragging: false,
            allowDrawingArrows: false,
            squareStyles: currentMove
              ? {
                  [currentMove.from]: { backgroundColor: "rgba(246, 196, 83, 0.55)" },
                  [currentMove.to]: { backgroundColor: "rgba(246, 196, 83, 0.55)" }
                }
              : undefined
          }}
        />
      </div>

      <div className="replayStatus">
        <span>Move {moveIndex} / {maxMoveIndex}</span>
        <strong>{currentMove ? currentMove.san : "Start position"}</strong>
      </div>

      <div className="buttonRow">
        <button type="button" onClick={() => setMoveIndex(0)} disabled={!selectedAttempt}>
          First
        </button>
        <button type="button" onClick={() => setMoveIndex((value) => Math.max(0, value - 1))} disabled={!selectedAttempt || moveIndex === 0}>
          Previous
        </button>
        <button type="button" onClick={() => setMoveIndex((value) => Math.min(maxMoveIndex, value + 1))} disabled={!selectedAttempt || moveIndex >= maxMoveIndex}>
          Next
        </button>
        <button type="button" onClick={() => setPlaying((value) => !value)} disabled={!selectedAttempt || maxMoveIndex === 0}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={() => { setMoveIndex(0); setPlaying(false); }} disabled={!selectedAttempt}>
          Reset
        </button>
      </div>

      <div className="attemptPicker">
        {attempts.map((attempt) => (
          <button
            type="button"
            key={attempt.id}
            className={attempt.id === selectedAttemptId ? "selectedAttempt" : ""}
            onClick={() => chooseAttempt(attempt)}
          >
            Attempt {attempt.attemptNumber}
          </button>
        ))}
      </div>
    </section>
  );
}
