from __future__ import annotations

import re
from dataclasses import dataclass, field

import chess


PIECE_WORDS = {
    "k": chess.KING,
    "king": chess.KING,
    "q": chess.QUEEN,
    "queen": chess.QUEEN,
    "lady": chess.QUEEN,
    "r": chess.ROOK,
    "rook": chess.ROOK,
    "castlepiece": chess.ROOK,
    "tower": chess.ROOK,
    "b": chess.BISHOP,
    "bishop": chess.BISHOP,
    "elephant": chess.BISHOP,
    "n": chess.KNIGHT,
    "knight": chess.KNIGHT,
    "night": chess.KNIGHT,
    "nite": chess.KNIGHT,
    "horse": chess.KNIGHT,
    "p": chess.PAWN,
    "pawn": chess.PAWN,
    "peon": chess.PAWN,
}

CHINESE_PIECE_WORDS = {
    "王": "king",
    "国王": "king",
    "老王": "king",
    "后": "queen",
    "皇后": "queen",
    "王后": "queen",
    "女王": "queen",
    "车": "rook",
    "城堡子": "rook",
    "塔": "rook",
    "象": "bishop",
    "相": "bishop",
    "主教": "bishop",
    "马": "knight",
    "骑士": "knight",
    "马儿": "knight",
    "小兵": "pawn",
    "兵": "pawn",
    "兵卒": "pawn",
    "卒": "pawn",
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
    "阿": "a",
    "a": "a",
    "贝": "b",
    "必": "b",
    "比": "b",
    "b": "b",
    "西": "c",
    "希": "c",
    "赛": "c",
    "c": "c",
    "迪": "d",
    "第": "d",
    "低": "d",
    "d": "d",
    "衣": "e",
    "伊": "e",
    "一": "e",
    "e": "e",
    "艾弗": "f",
    "夫": "f",
    "埃夫": "f",
    "f": "f",
    "鸡": "g",
    "机": "g",
    "基": "g",
    "g": "g",
    "艾尺": "h",
    "h": "h",
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
    "alpha": "a",
    "b": "b",
    "bee": "b",
    "be": "b",
    "bravo": "b",
    "c": "c",
    "see": "c",
    "sea": "c",
    "charlie": "c",
    "d": "d",
    "dee": "d",
    "delta": "d",
    "e": "e",
    "echo": "e",
    "f": "f",
    "eff": "f",
    "foxtrot": "f",
    "g": "g",
    "gee": "g",
    "golf": "g",
    "h": "h",
    "aitch": "h",
    "eightch": "h",
    "hotel": "h",
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
    "ate": "8",
}


@dataclass
class ParseResult:
    move: chess.Move | None
    status: str
    message: str = ""
    candidates: list[str] = field(default_factory=list)
    candidate_moves: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status == "ok" and self.move is not None


def parse_user_move(text: str, board: chess.Board) -> ParseResult:
    raw = text.strip()
    if not raw:
        return ParseResult(None, "empty", "No move was provided.")

    castle_result = _parse_unspecified_castle(raw, board)
    if castle_result:
        return castle_result

    target_ambiguity = _target_square_ambiguity(raw, board)
    if target_ambiguity:
        return target_ambiguity

    for candidate in _notation_candidates(raw):
        parsed = _try_san(candidate, board) or _try_uci(candidate, board)
        if parsed:
            return ParseResult(parsed, "ok")

    normalized = normalize_spoken_move(raw)
    castle_result = _parse_unspecified_castle(normalized, board)
    if castle_result:
        return castle_result

    target_ambiguity = _target_square_ambiguity(normalized, board)
    if target_ambiguity:
        return target_ambiguity

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
    normalized = normalized.replace("castle piece", "castlepiece")
    normalized = normalized.replace("short castle", "castle kingside")
    normalized = normalized.replace("long castle", "castle queenside")
    normalized = re.sub(r"\b(night|nite|horse)\b", "knight", normalized)
    normalized = re.sub(r"\b(captures?|capture|takes?|take|x)\b", " x ", normalized)
    normalized = re.sub(r"\b(checkmate|mate|check|plus|sharp)\b", " ", normalized)
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
        "王翼": "castle kingside",
        "王侧": "castle kingside",
        "后翼": "castle queenside",
        "后侧": "castle queenside",
    }
    for phrase, square in phrase_squares.items():
        normalized = normalized.replace(phrase, f" {square} ")

    normalized = re.sub(
        r"(王翼|王侧|短易位|短移位|短翼位|短一位|短异位|短车|短王车|王车易位|王翼易位|王侧易位)",
        " castle kingside ",
        normalized,
    )
    normalized = re.sub(
        r"(后翼|后侧|长易位|长移位|长翼位|长一位|长异位|长车|长王车|后翼易位|后侧易位)",
        " castle queenside ",
        normalized,
    )

    normalized = re.sub(r"(升变为后|升变成后|升后|变后)", " promote queen ", normalized)
    normalized = re.sub(r"(升变为车|升变成车|升车|变车)", " promote rook ", normalized)
    normalized = re.sub(r"(升变为象|升变成象|升象|变象)", " promote bishop ", normalized)
    normalized = re.sub(r"(升变为马|升变成马|升马|变马)", " promote knight ", normalized)

    for piece, english in sorted(CHINESE_PIECE_WORDS.items(), key=lambda item: len(item[0]), reverse=True):
        normalized = normalized.replace(piece, f" {english} ")
    normalized = re.sub(r"(吃掉|吃|拿掉|拿|打掉|打|捕获)", " x ", normalized)
    normalized = re.sub(r"(将军|将死|将杀|王手|打将)", " ", normalized)
    normalized = re.sub(r"(我|要|想|走|下|着|到|去|的|了|把|子|棋|移动|走到)", " ", normalized)

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
    if len(words) == 4 and words[0] == "from" and _is_square(words[1]) and words[2] in {"to", "-"} and _is_square(words[3]):
        candidates.append(words[1] + words[3])
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
    words = [
        w
        for w in text.split()
        if w not in {"to", "the", "a", "my", "move", "play", "go", "on", "at"}
    ]
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
    from_square = None
    if "from" in words:
        from_index = words.index("from")
        if from_index + 1 < len(words) and _is_square(words[from_index + 1]):
            from_square = chess.parse_square(words[from_index + 1])
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
        if from_square is not None and move.from_square != from_square:
            continue
        if promotion is not None and move.promotion != promotion:
            continue
        if capture and not board.is_capture(move):
            continue
        matches.append(move)

    if len(matches) == 1:
        return ParseResult(matches[0], "ok")
    if len(matches) > 1:
        return _ambiguous_result(board, target, matches)
    return None


def _target_square_ambiguity(text: str, board: chess.Board) -> ParseResult | None:
    normalized = text.lower().strip()
    if not _is_square(normalized):
        return None

    target_square = chess.parse_square(normalized)
    matches = [move for move in board.legal_moves if move.to_square == target_square]
    if len(matches) <= 1:
        return None
    return _ambiguous_result(board, normalized, matches)


def _ambiguous_result(board: chess.Board, target: str, moves: list[chess.Move]) -> ParseResult:
    limited = moves[:6]
    candidates = [board.san(move) for move in limited]
    return ParseResult(
        None,
        "ambiguous",
        f"Multiple legal moves can land on {target}. Please confirm which move you mean.",
        candidates,
        [move.uci() for move in limited],
    )


def _try_castle(board: chess.Board, kingside: bool) -> ParseResult:
    san = "O-O" if kingside else "O-O-O"
    move = _try_san(san, board)
    if move:
        return ParseResult(move, "ok")
    return ParseResult(None, "illegal", "Castling is illegal in the current position.")


def _parse_unspecified_castle(text: str, board: chess.Board) -> ParseResult | None:
    normalized = text.lower().strip()
    if normalized not in {"castle", "castles", "castling", "易位", "王车易位"}:
        return None

    legal_castles = [move for move in board.legal_moves if board.is_castling(move)]
    if len(legal_castles) == 1:
        return ParseResult(legal_castles[0], "ok")
    if len(legal_castles) > 1:
        return _ambiguous_result(board, "castling", legal_castles)
    return ParseResult(None, "illegal", "Castling is illegal in the current position.")


def _is_square(text: str) -> bool:
    return bool(re.fullmatch(r"[a-h][1-8]", text.lower()))
