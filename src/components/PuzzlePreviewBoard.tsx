import { Chessboard } from "react-chessboard";

type PuzzlePreviewBoardProps = {
  fen: string;
  orientation: "white" | "black";
};

export function PuzzlePreviewBoard({ fen, orientation }: PuzzlePreviewBoardProps) {
  return (
    <div className="previewBoard">
      <Chessboard
        options={{
          id: "coach-preview-board",
          position: fen,
          boardOrientation: orientation,
          allowDragging: false,
          allowDrawingArrows: false,
          showNotation: false,
          showAnimations: false,
          animationDurationInMs: 0
        }}
      />
    </div>
  );
}
