import { describe, expect, it } from "vitest";
import type { MoveRecord, StoredPuzzleState } from "../types";
import { buildDiagnosis, canSubmitAttempt, compareAttemptToSolution, shouldAutoSubmitAttempt } from "./attempts";

function move(uci: string, san = uci): MoveRecord {
  return {
    moveNumber: 1,
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4) : undefined,
    san,
    uci,
    fenAfterMove: "fen",
    timestamp: 1
  };
}

describe("compareAttemptToSolution", () => {
  it("returns true for exact match", () => {
    expect(compareAttemptToSolution([move("e2e8")], ["e2e8"])).toBe(true);
  });

  it("returns false for wrong move", () => {
    expect(compareAttemptToSolution([move("e2e7")], ["e2e8"])).toBe(false);
  });

  it("returns false for too-short line", () => {
    expect(compareAttemptToSolution([move("c4f7")], ["c4f7", "e8f7", "f3g5"])).toBe(false);
  });

  it("returns false for too-long line", () => {
    expect(compareAttemptToSolution([move("e2e8"), move("g8h7")], ["e2e8"])).toBe(false);
  });
});

describe("attempt rules", () => {
  it("auto-submits only when the line is complete or no longer a solution prefix", () => {
    expect(shouldAutoSubmitAttempt([move("c4f7")], ["c4f7", "e8f7", "f3g5"])).toBe(false);
    expect(shouldAutoSubmitAttempt([move("c4f7"), move("e8f7"), move("f3g5")], ["c4f7", "e8f7", "f3g5"])).toBe(true);
    expect(shouldAutoSubmitAttempt([move("c4e6")], ["c4f7", "e8f7", "f3g5"])).toBe(true);
  });

  it("prevents a fourth submission", () => {
    const state: StoredPuzzleState = {
      solved: false,
      attempts: [
        { id: "1", puzzleId: "p", attemptNumber: 1, moves: [], correct: false, submittedAt: 1, durationSeconds: 1, diagnosis: buildDiagnosis([], ["e2e8"], false, 1, 1) },
        { id: "2", puzzleId: "p", attemptNumber: 2, moves: [], correct: false, submittedAt: 2, durationSeconds: 1, diagnosis: buildDiagnosis([], ["e2e8"], false, 2, 1) },
        { id: "3", puzzleId: "p", attemptNumber: 3, moves: [], correct: false, submittedAt: 3, durationSeconds: 1, diagnosis: buildDiagnosis([], ["e2e8"], false, 3, 1) }
      ]
    };

    expect(canSubmitAttempt(state)).toBe(false);
  });

  it("diagnosis identifies first-move mismatch", () => {
    const diagnosis = buildDiagnosis([move("e2e7", "Re7")], ["e2e8"], false, 2, 14);

    expect(diagnosis.firstMoveMatchesSolution).toBe(false);
    expect(diagnosis.firstMoveUci).toBe("e2e7");
    expect(diagnosis.summary).toContain("expected e2e8");
  });
});
