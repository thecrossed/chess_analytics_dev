import { Chessboard } from "react-chessboard";

type SolveBoardProps = {
  fen: string;
  locked: boolean;
  orientation: "white" | "black";
  feedback: "neutral" | "pending" | "correct" | "incorrect";
  feedbackSquare?: string;
  hintSquare?: string;
  onDrop: (from: string, to: string) => boolean;
};

export function SolveBoard({ fen, locked, orientation, feedback, feedbackSquare, hintSquare, onDrop }: SolveBoardProps) {
  return (
    <div className={`boardShell boardShell-${feedback}`}>
      <Chessboard
        options={{
          id: "solve-board",
          position: fen,
          boardOrientation: orientation,
          allowDragging: !locked,
          allowDrawingArrows: false,
          draggingPieceGhostStyle: { opacity: 0 },
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            if (!targetSquare) return false;
            return onDrop(sourceSquare, targetSquare);
          },
          squareRenderer: ({ square, children }) => {
            const showMarker = feedbackSquare === square && (feedback === "correct" || feedback === "incorrect");
            const showHint = hintSquare === square && !showMarker;
            return (
              <div className={`squareWithMarker${showHint ? " hintedSquare" : ""}`}>
                {children}
                {showMarker ? (
                  <span className={`moveResultMarker moveResultMarker-${feedback}`}>
                    {feedback === "correct" ? "✓" : "×"}
                  </span>
                ) : null}
              </div>
            );
          }
        }}
      />
    </div>
  );
}
