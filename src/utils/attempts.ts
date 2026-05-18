import { Chess } from "chess.js";
import type { Attempt, AttemptDiagnosis, MoveRecord, Puzzle, StoredPuzzleState } from "../types";

export const MAX_ATTEMPTS = 3;

export function compareAttemptToSolution(attemptMoves: MoveRecord[], solutionUci: string[]): boolean {
  const attemptUci = attemptMoves.map((move) => move.uci);
  return attemptUci.length === solutionUci.length && attemptUci.every((move, index) => move === solutionUci[index]);
}

export function shouldAutoSubmitAttempt(attemptMoves: MoveRecord[], solutionUci: string[]): boolean {
  const attemptUci = attemptMoves.map((move) => move.uci);
  const isValidPrefix = attemptUci.every((move, index) => move === solutionUci[index]);
  return !isValidPrefix || attemptUci.length >= solutionUci.length;
}

export function canSubmitAttempt(state: StoredPuzzleState, maxAttempts = MAX_ATTEMPTS): boolean {
  return !state.solved && state.attempts.length < maxAttempts;
}

export function getLengthComparison(
  submittedMoveCount: number,
  solutionMoveCount: number
): AttemptDiagnosis["lengthComparison"] {
  if (submittedMoveCount === 0) return "empty";
  if (submittedMoveCount < solutionMoveCount) return "too_short";
  if (submittedMoveCount > solutionMoveCount) return "too_long";
  return "same_length";
}

export function buildDiagnosis(
  moves: MoveRecord[],
  solutionUci: string[],
  exactMatch: boolean,
  attemptNumber: number,
  durationSeconds: number
): AttemptDiagnosis {
  const firstMoveUci = moves[0]?.uci;
  const firstMoveMatchesSolution = Boolean(firstMoveUci && firstMoveUci === solutionUci[0]);
  const submittedMoveCount = moves.length;
  const solutionMoveCount = solutionUci.length;
  const lengthComparison = getLengthComparison(submittedMoveCount, solutionMoveCount);
  const firstMoveText = firstMoveUci
    ? `First move was ${moves[0].san} (${firstMoveUci})`
    : "No first move was submitted";
  const expectedText = solutionUci[0] ? `expected ${solutionUci[0]}` : "no solution move was available";
  const lengthText =
    lengthComparison === "empty"
      ? "The student submitted an empty line."
      : `The submitted line was ${submittedMoveCount} move${submittedMoveCount === 1 ? "" : "s"} long; the solution is ${solutionMoveCount}.`;
  const resultText = exactMatch
    ? "It exactly matched the solution."
    : firstMoveMatchesSolution
      ? "The first move matched, but the full line still needs refinement."
      : "This suggests the student may have chosen a different candidate idea before calculating the forcing line.";

  return {
    firstMoveUci,
    firstMoveMatchesSolution,
    submittedMoveCount,
    solutionMoveCount,
    lengthComparison,
    exactMatch,
    summary: `Attempt ${attemptNumber}: ${firstMoveText}${firstMoveUci ? `; ${firstMoveMatchesSolution ? "it matched" : `but ${expectedText}`}.` : "."} ${lengthText} Total time: ${durationSeconds}s. ${resultText}`
  };
}

export function makeAttempt(params: {
  puzzle: Puzzle;
  moves: MoveRecord[];
  attemptNumber: number;
  startedAt: number;
  submittedAt: number;
}): Attempt {
  const correct = compareAttemptToSolution(params.moves, params.puzzle.solutionUci);
  const durationSeconds = Math.max(0, Math.round((params.submittedAt - params.startedAt) / 1000));
  return {
    id: `${params.puzzle.id}-attempt-${params.attemptNumber}-${params.submittedAt}`,
    puzzleId: params.puzzle.id,
    attemptNumber: params.attemptNumber,
    moves: params.moves,
    correct,
    submittedAt: params.submittedAt,
    durationSeconds,
    diagnosis: buildDiagnosis(
      params.moves,
      params.puzzle.solutionUci,
      correct,
      params.attemptNumber,
      durationSeconds
    )
  };
}

export function applyMovesToFen(startFen: string, moves: MoveRecord[], moveIndex: number): string {
  const chess = new Chess(startFen);
  moves.slice(0, moveIndex).forEach((move) => {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
  });
  return chess.fen();
}
