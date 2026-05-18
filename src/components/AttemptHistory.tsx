import type { Attempt } from "../types";

type AttemptHistoryProps = {
  attempts: Attempt[];
  onReplay: (attemptId: string) => void;
};

export function AttemptHistory({ attempts, onReplay }: AttemptHistoryProps) {
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
                <span>{attempt.moves.length} moves</span>
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
