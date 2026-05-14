from __future__ import annotations

import re
from dataclasses import dataclass, field

import chess


PIECE_WORDS = {
    "king": chess.KING,
    "queen": chess.QUEEN,
    "rook": chess.ROOK,
    "bishop": chess.BISHOP,
    "knight": chess.KNIGHT,
    "night": chess.KNIGHT,
    "nite": chess.KNIGHT,
    "pawn": chess.PAWN,
}

CHINESE_PIECE_WORDS = {
    "王": "king",
    "国王": "king",
    "后": "queen",
    "皇后": "queen",
    "车": "rook",
    "象": "bishop",
    "主教": "bishop",
    "马": "knight",
    "小兵": "pawn",
    "兵": "pawn",
    "小冰": "pawn",
}

CHINESE_RANKS = {
    "一": "1",
    "二": "2",
    "两": "2",
    "三": "3",
    "四": "4",
    "室": "4",
    "是": "4",
    "五": "5",
    "六": "6",
    "七": "7",
    "八": "8",
}

CHINESE_FILE_SOUNDS = {
    "诶": "a",
    "欸": "a",
    "贝": "b",
    "必": "b",
    "西": "c",
    "希": "c",
    "迪": "d",
    "第": "d",
    "衣": "e",
    "伊": "e",
    "一": "e",
    "艾弗": "f",
    "夫": "f",
    "鸡": "g",
    "机": "g",
    "艾尺": "h",
}

PIECE_TO_SAN = {
    chess.KING: "K",
    chess.QUEEN: "Q",
    chess.ROOK: "R",
    chess.BISHOP: "B",
    chess.KNIGHT: "N",
    chess.PAWN: "",
}

FILE_WORDS = {
    "a": "a",
    "ay": "a",
    "b": "b",
    "bee": "b",
    "be": "b",
    "c": "c",
    "see": "c",
    "sea": "c",
    "d": "d",
    "dee": "d",
    "e": "e",
    "f": "f",
    "eff": "f",
    "g": "g",
    "gee": "g",
    "h": "h",
    "aitch": "h",
    "eightch": "h",
}

RANK_WORDS = {
    "one": "1",
    "two": "2",
    "too": "2",
    "to": "2",
    "three": "3",
    "four": "4",
    "for": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
}


@dataclass
class ParseResult:
    move: chess.Move | None
    status: str
    message: str = ""
    candidates: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status == "ok" and self.move is not None


def parse_user_move(text: str, board: chess.Board) -> ParseResult:
    raw = text.strip()
    if not raw:
        return ParseResult(None, "empty", "No move was provided.")

    for candidate in _notation_candidates(raw):
        parsed = _try_san(candidate, board) or _try_uci(candidate, board)
        if parsed:
            return ParseResult(parsed, "ok")

    normalized = normalize_spoken_move(raw)
    if normalized != raw.lower():
        for candidate in _notation_candidates(normalized):
            parsed = _try_san(candidate, board) or _try_uci(candidate, board)
            if parsed:
                return ParseResult(parsed, "ok")

    natural = _parse_natural_language(normalized, board)
    if natural:
        return natural

    return ParseResult(
        None,
        "illegal",
        "That move is illegal in the current position. Please try again.",
    )


def normalize_spoken_move(text: str) -> str:
    normalized = normalize_chinese_spoken_move(text)
    normalized = normalized.lower().strip()
    normalized = normalized.replace("king side", "kingside").replace("queen side", "queenside")
    normalized = normalized.replace("short castle", "castle kingside")
    normalized = normalized.replace("long castle", "castle queenside")
    normalized = re.sub(r"\b(night|nite)\b", "knight", normalized)
    normalized = re.sub(r"\b(captures?|capture|takes?)\b", "x", normalized)
    normalized = re.sub(r"[^a-z0-9x=\s-]", " ", normalized)
    tokens = normalized.split()
    tokens = _merge_spoken_squares(tokens)
    return " ".join(tokens)


def normalize_chinese_spoken_move(text: str) -> str:
    normalized = text.lower().strip()
    normalized = normalized.replace("0-0-0", "castle queenside").replace("0-0", "castle kingside")

    phrase_squares = {
        "衣室": "e4",
        "衣四": "e4",
        "伊四": "e4",
        "一四": "e4",
        "e四": "e4",
        "e室": "e4",
    }
    for phrase, square in phrase_squares.items():
        normalized = normalized.replace(phrase, f" {square} ")

    for piece, english in sorted(CHINESE_PIECE_WORDS.items(), key=lambda item: len(item[0]), reverse=True):
        normalized = normalized.replace(piece, f" {english} ")

    normalized = re.sub(r"(王翼|短易位|短车|短王车|王车易位)", " castle kingside ", normalized)
    normalized = re.sub(r"(后翼|长易位|长车|长王车)", " castle queenside ", normalized)
    normalized = re.sub(r"(吃|拿|打|捕获)", " x ", normalized)
    normalized = re.sub(r"(升变|升后|变后)", " promote queen ", normalized)
    normalized = re.sub(r"(我|要|想|走|下|着|到|去|的|了|把|子|棋)", " ", normalized)

    normalized = _replace_chinese_square_words(normalized)
    return normalized


def _replace_chinese_square_words(text: str) -> str:
    for file_word, file_char in CHINESE_FILE_SOUNDS.items():
        for rank_word, rank_char in CHINESE_RANKS.items():
            text = text.replace(file_word + rank_word, f" {file_char}{rank_char} ")
    for rank_word, rank_char in CHINESE_RANKS.items():
        text = re.sub(rf"\b([a-h])\s*{rank_word}\b", rf"\g<1>{rank_char}", text)
    return text


def _merge_spoken_squares(tokens: list[str]) -> list[str]:
    merged: list[str] = []
    i = 0
    while i < len(tokens):
        if i + 1 < len(tokens) and tokens[i] in FILE_WORDS and tokens[i + 1] in RANK_WORDS:
            merged.append(FILE_WORDS[tokens[i]] + RANK_WORDS[tokens[i + 1]])
            i += 2
            continue
        merged.append(tokens[i])
        i += 1
    return merged


def _notation_candidates(text: str) -> list[str]:
    lower = text.lower().strip()
    if lower in {"castle kingside", "castle king side", "kingside castle"}:
        return ["O-O"]
    if lower in {"castle queenside", "castle queen side", "queenside castle"}:
        return ["O-O-O"]

    compact = lower.replace(" ", "")
    candidates = [text, compact]
    words = lower.split()
    if len(words) == 2 and words[0] in PIECE_WORDS and _is_square(words[1]):
        san = PIECE_TO_SAN[PIECE_WORDS[words[0]]] + words[1]
        candidates.append(san)
    if len(words) == 3 and _is_square(words[0]) and words[1] in {"to", "-"} and _is_square(words[2]):
        candidates.append(words[0] + words[2])
    if len(words) == 2 and _is_square(words[0]) and _is_square(words[1]):
        candidates.append(words[0] + words[1])
    return list(dict.fromkeys(candidates))


def _try_san(text: str, board: chess.Board) -> chess.Move | None:
    try:
        return board.parse_san(text)
    except ValueError:
        return None


def _try_uci(text: str, board: chess.Board) -> chess.Move | None:
    compact = text.lower().replace(" ", "").replace("-", "")
    if not re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?", compact):
        return None
    try:
        move = chess.Move.from_uci(compact)
    except ValueError:
        return None
    return move if move in board.legal_moves else None


def _parse_natural_language(text: str, board: chess.Board) -> ParseResult | None:
    words = [w for w in text.split() if w not in {"to", "the"}]
    if not words:
        return None
    if words[:2] == ["castle", "kingside"]:
        return _try_castle(board, kingside=True)
    if words[:2] == ["castle", "queenside"]:
        return _try_castle(board, kingside=False)

    promotion = None
    if "promote" in words:
        for word in words:
            if word in {"queen", "rook", "bishop", "knight"}:
                promotion = PIECE_WORDS[word]

    target = next((word for word in reversed(words) if _is_square(word)), None)
    if not target:
        return None
    piece_type = next((PIECE_WORDS[word] for word in words if word in PIECE_WORDS), None)
    capture = "x" in words

    matches = []
    target_square = chess.parse_square(target)
    for move in board.legal_moves:
        piece = board.piece_at(move.from_square)
        if piece is None:
            continue
        if piece_type is not None and piece.piece_type != piece_type:
            continue
        if move.to_square != target_square:
            continue
        if promotion is not None and move.promotion != promotion:
            continue
        if capture and not board.is_capture(move):
            continue
        matches.append(move)

    if len(matches) == 1:
        return ParseResult(matches[0], "ok")
    if len(matches) > 1:
        return ParseResult(
            None,
            "ambiguous",
            "That move is ambiguous. Please include the starting square.",
            [board.san(move) for move in matches[:6]],
        )
    return None


def _try_castle(board: chess.Board, kingside: bool) -> ParseResult:
    san = "O-O" if kingside else "O-O-O"
    move = _try_san(san, board)
    if move:
        return ParseResult(move, "ok")
    return ParseResult(None, "illegal", "Castling is illegal in the current position.")


def _is_square(text: str) -> bool:
    return bool(re.fullmatch(r"[a-h][1-8]", text.lower()))
