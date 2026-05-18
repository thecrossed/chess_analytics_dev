import type { Attempt } from "../types";

type AttemptHistoryProps = {
  attempts: Attempt[];
  solutionUci: string[];
  onReplay: (attemptId: string) => void;
};

function describeAttemptStep(attempt: Attempt, solutionUci: string[]) {
  if (attempt.correct) {
    return `Solved in ${attempt.moves.length} move${attempt.moves.length === 1 ? "" : "s"}`;
  }

  const mismatchIndex = attempt.moves.findIndex((move, index) => move.uci !== solutionUci[index]);
  if (mismatchIndex === -1) {
    return `Stopped after ${attempt.moves.length} move${attempt.moves.length === 1 ? "" : "s"}`;
  }

  return `Wrong on move ${mismatchIndex + 1}: ${attempt.moves[mismatchIndex].san}`;
}

export function AttemptHistory({ attempts, solutionUci, onReplay }: AttemptHistoryProps) {
  return (
    <section className="panel">
      <div className="sectionHeader">
        <h2>Attempt History</h2>
        <span>{attempts.length} saved</span>
      </div>
      {attempts.length === 0 ? (
        <p className="muted">Submitted attempts will appear here and stay replayable after reload.</p>
      ) : (
        <div className="attemptList">
          {attempts.map((attempt) => (
            <article className="attemptCard" key={attempt.id}>
              <div className="attemptTopline">
                <strong>Attempt {attempt.attemptNumber}</strong>
                <span className={attempt.correct ? "badge success" : "badge error"}>
                  {attempt.correct ? "Correct" : "Incorrect"}
                </span>
              </div>
              <p className="moveLine">
                {attempt.moves.length
                  ? attempt.moves.map((move) => move.san).join(" ")
                  : "Empty line"}
              </p>
              <div className="attemptMeta">
                <span>{describeAttemptStep(attempt, solutionUci)}</span>
                <span>{attempt.durationSeconds}s</span>
              </div>
              <button type="button" onClick={() => onReplay(attempt.id)}>
                Replay Attempt
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
