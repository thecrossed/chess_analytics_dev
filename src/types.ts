export type Puzzle = {
  id: string;
  title?: string;
  fen: string;
  sideToMove: "w" | "b";
  themes: string[];
  difficulty: number;
  solutionUci: string[];
  explanation: string;
  creatorAccountId?: string;
  creatorName?: string;
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

export type Student = {
  id: string;
  name: string;
  level: string;
  classId?: string;
};

export type CoachClass = {
  id: string;
  name: string;
};

export type AccountRole = "coach" | "student";

export type UserAccount = {
  id: string;
  role: AccountRole;
  name: string;
  email: string;
  password: string;
  chessComUsername?: string;
  lichessUsername?: string;
  studentId?: string;
};

export type CoachStudentLink = {
  id: string;
  coachAccountId: string;
  studentId: string;
  createdAt: number;
};

export type ConnectionRequest = {
  id: string;
  coachAccountId: string;
  studentId: string;
  requestedBy: AccountRole;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
  respondedAt?: number;
};

export type PuzzleAssignment = {
  id: string;
  studentId: string;
  puzzleId: string;
  assignedAt: number;
};
