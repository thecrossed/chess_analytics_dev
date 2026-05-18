import type { Puzzle } from "../types";

export const puzzles: Puzzle[] = [
  {
    id: "puzzle-001",
    title: "Back Rank Finish",
    fen: "4r1k1/5ppp/8/8/8/8/4RPPP/6K1 w - - 0 1",
    sideToMove: "w",
    themes: ["back rank", "mate"],
    difficulty: 900,
    solutionUci: ["e2e8"],
    explanation: "White uses the unguarded back rank to deliver mate with Re8#."
  },
  {
    id: "puzzle-002",
    title: "Greek Gift Calculation",
    fen: "r2qk2r/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w kq - 0 1",
    sideToMove: "w",
    themes: ["sacrifice", "king attack"],
    difficulty: 1400,
    solutionUci: ["c4f7", "e8f7", "f3g5"],
    explanation: "White sacrifices on f7, pulls the king forward, and follows with Ng5+."
  },
  {
    id: "puzzle-003",
    title: "Black Back Rank Capture",
    fen: "6k1/4rppp/8/8/8/8/5PPP/4R1K1 b - - 0 1",
    sideToMove: "b",
    themes: ["back rank", "rook tactic"],
    difficulty: 1000,
    solutionUci: ["e7e1"],
    explanation: "Black removes the defender on e1 and lands a decisive rook tactic."
  },
  {
    id: "puzzle-004",
    title: "Legal Trap Mate",
    fen: "r2qkbnr/ppp2ppp/2np4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5",
    sideToMove: "w",
    themes: ["mate in three", "opening trap", "king attack"],
    difficulty: 1700,
    solutionUci: ["f3e5", "g4d1", "c4f7", "e8e7", "c3d5"],
    explanation: "White ignores the queen capture and coordinates both knights with the bishop on f7 to deliver Legal's mate."
  },
  {
    id: "puzzle-005",
    title: "Blackburne Shilling Mate",
    fen: "r1b1kbnr/pppp1Npp/8/6q1/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq - 0 5",
    sideToMove: "b",
    themes: ["mate in three", "opening trap", "queen and knight"],
    difficulty: 1800,
    solutionUci: ["g5g2", "h1f1", "g2e4", "c4e2", "d4f3"],
    explanation: "Black lures the rook to f1, checks with the queen, and finishes with a knight mate on f3."
  }
];
