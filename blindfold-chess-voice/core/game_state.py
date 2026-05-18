from __future__ import annotations

from dataclasses import dataclass, field

import chess

from .move_parser import ParseResult, parse_user_move
from .stockfish_engine import choose_engine_move


@dataclass
class MoveRecord:
    ply: int
    side: str
    san: str
    uci: str
    fen_after: str
    source: str


@dataclass
class BlindfoldGame:
    user_color: str = "White"
    opponent_level: str = "Club"
    board: chess.Board = field(default_factory=chess.Board)
    history: list[MoveRecord] = field(default_factory=list)
    last_message: str = "New game ready."
    game_over: bool = False

    @property
    def user_color_bool(self) -> bool:
        return chess.WHITE if self.user_color == "White" else chess.BLACK

    @property
    def user_to_move(self) -> bool:
        return self.board.turn == self.user_color_bool and not self.board.is_game_over()

    def reset(self, user_color: str, opponent_level: str) -> None:
        self.user_color = user_color
        self.opponent_level = opponent_level
        self.board = chess.Board()
        self.history = []
        self.last_message = "New game ready."
        self.game_over = False

    def apply_user_text(self, text: str) -> tuple[bool, str, ParseResult]:
        if self.board.is_game_over():
            return False, "The game is already over.", ParseResult(None, "game_over")
        if not self.user_to_move:
            return False, "It is not your turn.", ParseResult(None, "not_user_turn")

        parsed = parse_user_move(text, self.board)
        if not parsed.ok or parsed.move is None:
            message = parsed.message or "That move is illegal in the current position. Please try again."
            self.last_message = message
            return False, message, parsed

        message = self.apply_user_move(parsed.move)
        return True, message, parsed

    def apply_user_move(self, move: chess.Move) -> str:
        if move not in self.board.legal_moves:
            raise ValueError("That move is illegal in the current position.")
        san = self.board.san(move)
        side = side_name(self.board.turn)
        self.board.push(move)
        self._record(side=side, san=san, uci=move.uci(), source="user")
        message = f"{side} plays {spoken_san(san)}."
        self.last_message = message
        self._update_game_over()
        return message

    def apply_engine_move(self, engine_path: str) -> tuple[bool, str]:
        if self.board.is_game_over():
            return False, game_over_message(self.board)
        if self.board.turn == self.user_color_bool:
            return False, "It is your turn."

        move = choose_engine_move(self.board, engine_path, self.opponent_level)
        san = self.board.san(move)
        side = side_name(self.board.turn)
        self.board.push(move)
        self._record(side=side, san=san, uci=move.uci(), source="stockfish")
        message = f"{side} replies {spoken_san(san)}."
        self.last_message = message
        self._update_game_over()
        return True, message

    def rewind_to_ply(self, target_ply: int) -> str:
        bounded_ply = max(0, min(int(target_ply), len(self.history)))
        kept_uci = [record.uci for record in self.history[:bounded_ply]]

        self.board = chess.Board()
        self.history = []
        self.game_over = False
        self.last_message = "Rewound to the starting position."

        for uci in kept_uci:
            move = chess.Move.from_uci(uci)
            san = self.board.san(move)
            side = side_name(self.board.turn)
            source = "user" if self.board.turn == self.user_color_bool else "stockfish"
            self.board.push(move)
            self._record(side=side, san=san, uci=uci, source=source)

        if self.history:
            last = self.history[-1]
            self.last_message = f"Rewound to ply {bounded_ply}: {last.side} played {last.san}."
        self._update_game_over()
        return self.last_message

    def _record(self, side: str, san: str, uci: str, source: str) -> None:
        self.history.append(
            MoveRecord(
                ply=len(self.history) + 1,
                side=side,
                san=san,
                uci=uci,
                fen_after=self.board.fen(),
                source=source,
            )
        )

    def _update_game_over(self) -> None:
        self.game_over = self.board.is_game_over()
        if self.game_over:
            self.last_message = game_over_message(self.board)


def side_name(turn: bool) -> str:
    return "White" if turn == chess.WHITE else "Black"


def spoken_san(san: str) -> str:
    return (
        san.replace("N", "knight ")
        .replace("B", "bishop ")
        .replace("R", "rook ")
        .replace("Q", "queen ")
        .replace("K", "king ")
        .replace("O-O-O", "long castle")
        .replace("O-O", "short castle")
        .replace("x", " takes ")
        .replace("+", " check")
        .replace("#", " checkmate")
    )


def game_over_message(board: chess.Board) -> str:
    if board.is_checkmate():
        winner = "Black" if board.turn == chess.WHITE else "White"
        return f"Checkmate. {winner} wins."
    if board.is_stalemate():
        return "Stalemate. The game is drawn."
    if board.is_insufficient_material():
        return "Draw by insufficient material."
    return f"Game over: {board.result()}."
