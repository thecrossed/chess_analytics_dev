export type Puzzle = {
  id: string;
  title: string;
  fen: string;
  sideToMove: "w" | "b";
  themes: string[];
  difficulty: number;
  solutionUci: string[];
  explanation: string;
};

export type MoveRecord = {
  moveNumber: number;
  from: string;
  to: string;
  promotion?: string;
  san: string;
  uci: string;
  fenAfterMove: string;
  timestamp: number;
};

export type AttemptDiagnosis = {
  firstMoveUci?: string;
  firstMoveMatchesSolution: boolean;
  submittedMoveCount: number;
  solutionMoveCount: number;
  lengthComparison: "empty" | "too_short" | "same_length" | "too_long";
  exactMatch: boolean;
  summary: string;
};

export type Attempt = {
  id: string;
  puzzleId: string;
  attemptNumber: number;
  moves: MoveRecord[];
  correct: boolean;
  submittedAt: number;
  durationSeconds: number;
  diagnosis: AttemptDiagnosis;
};

export type StoredPuzzleState = {
  attempts: Attempt[];
  solved: boolean;
};
