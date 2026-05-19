import type { Puzzle, PuzzleAssignment, StoredPuzzleState, Student } from "../types";

const STORAGE_KEY = "chesscoach-puzzle-trace-state-v1";

type PersistedAppState = {
  activePuzzleId: string;
  activeAccountId?: string;
  activeStudentId?: string;
  activeRole?: "coach" | "student";
  coachCollectionPuzzleIds?: string[];
  studentRoster?: Student[];
  assignments?: PuzzleAssignment[];
  customPuzzles?: Puzzle[];
  puzzleStates: Record<string, StoredPuzzleState>;
};

export function loadAppState(): PersistedAppState | undefined {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as PersistedAppState;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return undefined;
  }
}

export function saveAppState(state: PersistedAppState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
