import { useEffect, useMemo, useState } from "react";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { Lightbulb, Plus, RotateCcw, Send, SkipBack, SkipForward, Trash2, X } from "lucide-react";
import { puzzles } from "./data/puzzles";
import { lichessPuzzles } from "./data/lichessPuzzles";
import { students as seedStudents } from "./data/students";
import { accounts as seedAccounts } from "./data/accounts";
import { AttemptHistory } from "./components/AttemptHistory";
import { PuzzlePreviewBoard } from "./components/PuzzlePreviewBoard";
import { ReplayPanel } from "./components/ReplayPanel";
import { SolveBoard } from "./components/SolveBoard";
import type { AccountRole, CoachClass, CoachStudentLink, ConnectionRequest, MoveRecord, Puzzle, PuzzleAssignment, StoredPuzzleState } from "./types";
import { MAX_ATTEMPTS, canSubmitAttempt, makeAttempt } from "./utils/attempts";
import { loadAppState, saveAppState } from "./utils/storage";
import { generateStockfishLine } from "./utils/stockfish";

const LIBRARY_PAGE_SIZE = 24;
const STORAGE_NOTICE_KEY = "chesscoach-storage-notice-v1";

const emptyPuzzleState: StoredPuzzleState = {
  attempts: [],
  solved: false
};

let moveAudioContext: AudioContext | undefined;

function playMoveSound(delayMs = 0) {
  window.setTimeout(() => {
    const AudioContextConstructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;

    moveAudioContext ??= new AudioContextConstructor();
    if (moveAudioContext.state === "suspended") {
      void moveAudioContext.resume();
    }

    const now = moveAudioContext.currentTime;
    const oscillator = moveAudioContext.createOscillator();
    const gain = moveAudioContext.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(560, now);
    oscillator.frequency.exponentialRampToValueAtTime(230, now + 0.075);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);

    oscillator.connect(gain);
    gain.connect(moveAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.09);
  }, delayMs);
}

const seedClasses: CoachClass[] = [
  { id: "class-juniors", name: "Juniors" }
];

const seedCoachStudentLinks: CoachStudentLink[] = seedStudents.map((student) => ({
  id: `seed-coach-elena-${student.id}`,
  coachAccountId: "coach-elena",
  studentId: student.id,
  createdAt: Date.now()
}));

function CookieStorageNotice() {
  const [accepted, setAccepted] = useState(() => window.localStorage.getItem(STORAGE_NOTICE_KEY) === "accepted");

  if (accepted) return null;

  return (
    <aside className="cookieNotice" role="region" aria-label="Cookie and local storage notice">
      <div>
        <strong>Cookies and local storage</strong>
        <p>
          This MVP uses necessary browser storage to keep login state, puzzle attempts, assignments, and coach collections on this device.
          It does not use analytics or marketing cookies.
        </p>
      </div>
      <button
        type="button"
        className="primaryButton"
        onClick={() => {
          window.localStorage.setItem(STORAGE_NOTICE_KEY, "accepted");
          setAccepted(true);
        }}
      >
        Got it
      </button>
    </aside>
  );
}

function formatSide(side: "w" | "b") {
  return side === "w" ? "White" : "Black";
}

function formatMoveList(moves: MoveRecord[]) {
  return moves
    .map((move, index) => (index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ${move.san}` : move.san))
    .join(" ");
}

function getPuzzleSource(puzzleId: string) {
  if (puzzleId.startsWith("lichess-")) return "lichess";
  if (puzzleId.startsWith("custom-")) return "custom";
  return "handmade";
}

function makePuzzleStateKey(studentId: string, puzzleId: string) {
  return `${studentId}:${puzzleId}`;
}

function dedupeAssignments(assignmentsToDedupe: PuzzleAssignment[]) {
  const seen = new Set<string>();
  return assignmentsToDedupe.filter((assignment) => {
    const key = makePuzzleStateKey(assignment.studentId, assignment.puzzleId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeCustomPuzzleId(existingPuzzleIds: Set<string>, coachAccountId?: string) {
  const owner = coachAccountId ?? "local";
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const candidate = `custom-${owner}-${randomPart}`;
  return existingPuzzleIds.has(candidate) ? `custom-${owner}-${Date.now()}-${Math.random().toString(36).slice(2)}` : candidate;
}

function describePuzzleProgress(state: StoredPuzzleState | undefined, solutionUci: string[]) {
  if (!state || state.attempts.length === 0) return "Not started";
  if (state.solved) {
    const correctAttempt = state.attempts.find((attempt) => attempt.correct);
    return correctAttempt ? `Solved in attempt ${correctAttempt.attemptNumber}` : "Solved";
  }

  const latestAttempt = state.attempts[state.attempts.length - 1];
  const mismatchIndex = latestAttempt.moves.findIndex((move, index) => move.uci !== solutionUci[index]);
  if (mismatchIndex >= 0) {
    return `Latest wrong on move ${mismatchIndex + 1}`;
  }

  return `${state.attempts.length}/${MAX_ATTEMPTS} attempts used`;
}

function describeAttemptOutcome(moves: MoveRecord[], correct: boolean, solutionUci: string[]) {
  if (correct) return `Solved in ${moves.length} move${moves.length === 1 ? "" : "s"}`;
  const mismatchIndex = moves.findIndex((move, index) => move.uci !== solutionUci[index]);
  if (mismatchIndex >= 0) return `Wrong on move ${mismatchIndex + 1}: ${moves[mismatchIndex].san}`;
  return `Stopped after ${moves.length} move${moves.length === 1 ? "" : "s"}`;
}

function getInitialState() {
  const saved = loadAppState();
  const savedPuzzles = [...puzzles, ...lichessPuzzles, ...(saved?.customPuzzles ?? [])];
  const accountRoster = saved?.accountRoster?.length ? saved.accountRoster : seedAccounts;
  const savedAccount = accountRoster.find((account) => account.id === saved?.activeAccountId);
  const activePuzzleId = saved?.activePuzzleId && savedPuzzles.some((puzzle) => puzzle.id === saved.activePuzzleId)
    ? saved.activePuzzleId
    : puzzles[0].id;
  const studentRoster = saved?.studentRoster?.length ? saved.studentRoster : seedStudents;
  const accountStudentId = savedAccount?.role === "student" ? savedAccount.studentId : undefined;
  const activeStudentId = accountStudentId && studentRoster.some((student) => student.id === accountStudentId)
    ? accountStudentId
    : saved?.activeStudentId && studentRoster.some((student) => student.id === saved.activeStudentId)
    ? saved.activeStudentId
    : studentRoster[0].id;

  return {
    activePuzzleId,
    activeAccountId: savedAccount?.id,
    accountRoster,
    activeStudentId,
    assignments: saved?.assignments ?? [
      {
        id: "seed-student-maya-puzzle-001",
        studentId: seedStudents[0].id,
        puzzleId: puzzles[0].id,
        assignedAt: Date.now()
      }
    ],
    studentRoster,
    customPuzzles: saved?.customPuzzles ?? [],
    activeRole: savedAccount?.role,
    coachCollectionPuzzleIds: saved?.coachCollectionPuzzleIds ?? [puzzles[0].id],
    coachStudentLinks: saved?.coachStudentLinks ?? seedCoachStudentLinks,
    connectionRequests: saved?.connectionRequests ?? [],
    classRoster: saved?.classRoster ?? seedClasses,
    puzzleStates: saved?.puzzleStates ?? {}
  };
}

export default function App() {
  const initialState = useMemo(getInitialState, []);
  const [activePuzzleId, setActivePuzzleId] = useState(initialState.activePuzzleId);
  const [activeAccountId, setActiveAccountId] = useState<string | undefined>(initialState.activeAccountId);
  const [accountRoster, setAccountRoster] = useState(initialState.accountRoster);
  const [studentRoster, setStudentRoster] = useState(initialState.studentRoster);
  const [activeStudentId, setActiveStudentId] = useState(initialState.activeStudentId);
  const [assignments, setAssignments] = useState<PuzzleAssignment[]>(initialState.assignments);
  const [customPuzzles, setCustomPuzzles] = useState<Puzzle[]>(initialState.customPuzzles);
  const [coachCollectionPuzzleIds, setCoachCollectionPuzzleIds] = useState<string[]>(initialState.coachCollectionPuzzleIds);
  const [coachStudentLinks, setCoachStudentLinks] = useState<CoachStudentLink[]>(initialState.coachStudentLinks);
  const [connectionRequests, setConnectionRequests] = useState<ConnectionRequest[]>(initialState.connectionRequests);
  const [classRoster, setClassRoster] = useState<CoachClass[]>(initialState.classRoster);
  const [coachPuzzleId, setCoachPuzzleId] = useState(initialState.activePuzzleId);
  const [coachSelectedStudentIds, setCoachSelectedStudentIds] = useState<string[]>([initialState.activeStudentId]);
  const [puzzleStates, setPuzzleStates] = useState<Record<string, StoredPuzzleState>>(initialState.puzzleStates);
  const [chess, setChess] = useState(() => new Chess(puzzles[0].fen));
  const [currentMoves, setCurrentMoves] = useState<MoveRecord[]>([]);
  const [attemptStartedAt, setAttemptStartedAt] = useState(Date.now());
  const [lastMessage, setLastMessage] = useState("");
  const [replayAttemptId, setReplayAttemptId] = useState<string | undefined>();
  const [activeRole, setActiveRole] = useState<"coach" | "student" | undefined>(initialState.activeRole);
  const [page, setPage] = useState<"login" | "register" | "coach" | "classes" | "studentDetail" | "student" | "puzzles" | "collection" | "solve" | "replay">(
    initialState.activeRole === "coach" ? "coach" : initialState.activeRole === "student" ? "student" : "login"
  );
  const [selectedCoachStudentId, setSelectedCoachStudentId] = useState(initialState.activeStudentId);
  const [feedback, setFeedback] = useState<"neutral" | "pending" | "correct" | "incorrect">("neutral");
  const [feedbackSquare, setFeedbackSquare] = useState<string | undefined>();
  const [hintSquare, setHintSquare] = useState<string | undefined>();
  const [awaitingNextAttempt, setAwaitingNextAttempt] = useState(false);
  const [newPuzzlePgn, setNewPuzzlePgn] = useState("");
  const [newPuzzlePgnFirstMove, setNewPuzzlePgnFirstMove] = useState<"solver" | "opponent">("solver");
  const [newPuzzleFen, setNewPuzzleFen] = useState("");
  const [newPuzzleSide, setNewPuzzleSide] = useState<"w" | "b">("w");
  const [newPuzzleThemes, setNewPuzzleThemes] = useState("");
  const [newPuzzleDifficulty, setNewPuzzleDifficulty] = useState("1500");
  const [newPuzzleSolution, setNewPuzzleSolution] = useState("");
  const [newPuzzleExplanation, setNewPuzzleExplanation] = useState("");
  const [newPuzzleMessage, setNewPuzzleMessage] = useState("");
  const [isGeneratingSolution, setIsGeneratingSolution] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [librarySource, setLibrarySource] = useState<"all" | "handmade" | "lichess" | "custom">("all");
  const [librarySide, setLibrarySide] = useState<"all" | "w" | "b">("all");
  const [libraryTheme, setLibraryTheme] = useState("all");
  const [libraryMinRating, setLibraryMinRating] = useState("");
  const [libraryMaxRating, setLibraryMaxRating] = useState("");
  const [libraryPage, setLibraryPage] = useState(1);
  const [loginRole, setLoginRole] = useState<AccountRole>("coach");
  const [selectedCoachAccountId, setSelectedCoachAccountId] = useState("coach-elena");
  const [selectedStudentAccountId, setSelectedStudentAccountId] = useState("account-maya");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [registerRole, setRegisterRole] = useState<AccountRole>("student");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerChessCom, setRegisterChessCom] = useState("");
  const [registerLichess, setRegisterLichess] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerLevel, setRegisterLevel] = useState("1200");
  const [registerError, setRegisterError] = useState("");
  const [showAddStudentForm, setShowAddStudentForm] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentInviteEmail, setStudentInviteEmail] = useState("");
  const [coachInviteId, setCoachInviteId] = useState("coach-elena");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [selectedAssignClassId, setSelectedAssignClassId] = useState("manual");

  const coachAccounts = useMemo(() => accountRoster.filter((account) => account.role === "coach"), [accountRoster]);
  const studentAccounts = useMemo(() => accountRoster.filter((account) => account.role === "student"), [accountRoster]);
  const activeAccount = accountRoster.find((account) => account.id === activeAccountId);
  const activeCoachId = activeAccount?.role === "coach" ? activeAccount.id : undefined;
  const coachStudentRoster = useMemo(() => {
    if (!activeCoachId) return [];
    const linkedStudentIds = new Set(
      coachStudentLinks
        .filter((link) => link.coachAccountId === activeCoachId)
        .map((link) => link.studentId)
    );
    return studentRoster.filter((student) => linkedStudentIds.has(student.id));
  }, [activeCoachId, coachStudentLinks, studentRoster]);
  const filteredStudentRoster = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    if (!query) return coachStudentRoster;
    return coachStudentRoster.filter((student) => student.name.toLowerCase().includes(query));
  }, [coachStudentRoster, studentSearch]);
  const publicPuzzles = useMemo(() => [...puzzles, ...lichessPuzzles], []);
  const allPuzzles = useMemo(() => [...publicPuzzles, ...customPuzzles], [customPuzzles, publicPuzzles]);
  const coachCollectionPuzzles = useMemo(
    () => coachCollectionPuzzleIds
      .map((puzzleId) => allPuzzles.find((item) => item.id === puzzleId))
      .filter((item): item is Puzzle => Boolean(item)),
    [allPuzzles, coachCollectionPuzzleIds]
  );
  const libraryThemes = useMemo(() => {
    const themes = new Set<string>();
    allPuzzles.forEach((item) => item.themes.forEach((theme) => themes.add(theme)));
    return [...themes].sort((a, b) => a.localeCompare(b));
  }, [allPuzzles]);
  const filteredLibraryPuzzles = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    const minRating = libraryMinRating.trim() ? Number(libraryMinRating) : undefined;
    const maxRating = libraryMaxRating.trim() ? Number(libraryMaxRating) : undefined;

    return allPuzzles.filter((item) => {
      const source = getPuzzleSource(item.id);
      if (librarySource !== "all" && source !== librarySource) return false;
      if (librarySide !== "all" && item.sideToMove !== librarySide) return false;
      if (libraryTheme !== "all" && !item.themes.includes(libraryTheme)) return false;
      if (minRating !== undefined && Number.isFinite(minRating) && item.difficulty < minRating) return false;
      if (maxRating !== undefined && Number.isFinite(maxRating) && item.difficulty > maxRating) return false;
      if (!query) return true;

      return [
        item.id,
        item.difficulty.toString(),
        item.sideToMove === "w" ? "white" : "black",
        source,
        ...item.themes
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [allPuzzles, libraryMaxRating, libraryMinRating, librarySearch, librarySide, librarySource, libraryTheme]);
  const libraryPageCount = Math.max(1, Math.ceil(filteredLibraryPuzzles.length / LIBRARY_PAGE_SIZE));
  const currentLibraryPage = Math.min(libraryPage, libraryPageCount);
  const pagedLibraryPuzzles = filteredLibraryPuzzles.slice(
    (currentLibraryPage - 1) * LIBRARY_PAGE_SIZE,
    currentLibraryPage * LIBRARY_PAGE_SIZE
  );
  const libraryRangeStart = filteredLibraryPuzzles.length === 0
    ? 0
    : (currentLibraryPage - 1) * LIBRARY_PAGE_SIZE + 1;
  const libraryRangeEnd = Math.min(currentLibraryPage * LIBRARY_PAGE_SIZE, filteredLibraryPuzzles.length);
  const puzzle = allPuzzles.find((item) => item.id === activePuzzleId) ?? allPuzzles[0];
  const activeStudent = studentRoster.find((student) => student.id === activeStudentId) ?? studentRoster[0];
  const activeStudentCoachLinks = coachStudentLinks.filter((link) => link.studentId === activeStudent.id);
  const activeStudentCoaches = activeStudentCoachLinks
    .map((link) => coachAccounts.find((account) => account.id === link.coachAccountId))
    .filter((account): account is (typeof coachAccounts)[number] => Boolean(account));
  const pendingCoachRequests = connectionRequests.filter(
    (request) => request.status === "pending" && activeCoachId && request.coachAccountId === activeCoachId && request.requestedBy === "student"
  );
  const pendingStudentRequests = connectionRequests.filter(
    (request) => request.status === "pending" && request.studentId === activeStudent.id && request.requestedBy === "coach"
  );
  const puzzleInCoachCollection = coachCollectionPuzzleIds.includes(puzzle.id);
  const activePuzzleStateKey = makePuzzleStateKey(activeStudent.id, puzzle.id);
  const puzzleState = puzzleStates[activePuzzleStateKey] ?? emptyPuzzleState;
  const attemptsUsed = puzzleState.attempts.length;
  const locked = !canSubmitAttempt(puzzleState) || puzzleState.solved || awaitingNextAttempt;

  useEffect(() => {
    saveAppState({ activePuzzleId, activeAccountId, accountRoster, activeStudentId, activeRole, coachCollectionPuzzleIds, coachStudentLinks, connectionRequests, classRoster, studentRoster, assignments, customPuzzles, puzzleStates });
  }, [activePuzzleId, activeAccountId, accountRoster, activeStudentId, activeRole, coachCollectionPuzzleIds, coachStudentLinks, connectionRequests, classRoster, studentRoster, assignments, customPuzzles, puzzleStates]);

  useEffect(() => {
    resetCurrentAttempt(puzzle.fen);
    setReplayAttemptId((puzzleStates[activePuzzleStateKey] ?? emptyPuzzleState).attempts[0]?.id);
    setFeedback("neutral");
    setFeedbackSquare(undefined);
    setHintSquare(undefined);
    setAwaitingNextAttempt(false);
  }, [puzzle.id, activeStudent.id]);

  useEffect(() => {
    setLibraryPage(1);
  }, [libraryMaxRating, libraryMinRating, librarySearch, librarySide, librarySource, libraryTheme]);

  function resetCurrentAttempt(fen = puzzle.fen) {
    setChess(new Chess(fen));
    setCurrentMoves([]);
    setAttemptStartedAt(Date.now());
  }

  function changePuzzle(puzzleId: string) {
    setActivePuzzleId(puzzleId);
    const nextPuzzle = allPuzzles.find((item) => item.id === puzzleId);
    if (nextPuzzle) {
      setLastMessage("");
      setFeedback("neutral");
      setFeedbackSquare(undefined);
      setHintSquare(undefined);
      setAwaitingNextAttempt(false);
      setPage("solve");
    }
  }

  function logOut() {
    setActiveAccountId(undefined);
    setActiveRole(undefined);
    setLoginPassword("");
    setLoginError("");
    setPage("login");
  }

  function handleLogin() {
    const accountId = loginRole === "coach" ? selectedCoachAccountId : selectedStudentAccountId;
    const account = accountRoster.find((item) => item.id === accountId);

    if (!account || account.role !== loginRole) {
      setLoginError("Account not found.");
      return;
    }

    if (account.password !== loginPassword) {
      setLoginError("Password is incorrect.");
      return;
    }

    setActiveAccountId(account.id);
    setActiveRole(account.role);
    setLoginPassword("");
    setLoginError("");

    if (account.role === "student" && account.studentId) {
      setActiveStudentId(account.studentId);
      setPage("student");
    } else {
      setPage("coach");
    }
  }

  function handleRegister() {
    const name = registerName.trim();
    const email = registerEmail.trim().toLowerCase();
    const chessComUsername = registerChessCom.trim();
    const lichessUsername = registerLichess.trim();
    const password = registerPassword.trim();

    if (!name || !email || !password) {
      setRegisterError("Name, email, and password are required.");
      return;
    }

    if (accountRoster.some((account) => account.email.toLowerCase() === email)) {
      setRegisterError("An account with this email already exists.");
      return;
    }

    const idSuffix = Date.now();
    if (registerRole === "student") {
      const studentId = `student-${idSuffix}`;
      setStudentRoster((current) => [
        ...current,
        {
          id: studentId,
          name,
          level: registerLevel.trim() || "1200"
        }
      ]);
      setAccountRoster((current) => [
        ...current,
        {
          id: `account-${idSuffix}`,
          role: "student",
          name,
          email,
          password,
          chessComUsername: chessComUsername || undefined,
          lichessUsername: lichessUsername || undefined,
          studentId
        }
      ]);
      setSelectedStudentAccountId(`account-${idSuffix}`);
    } else {
      setAccountRoster((current) => [
        ...current,
        {
          id: `coach-${idSuffix}`,
          role: "coach",
          name,
          email,
          password,
          chessComUsername: chessComUsername || undefined,
          lichessUsername: lichessUsername || undefined
        }
      ]);
      setSelectedCoachAccountId(`coach-${idSuffix}`);
    }

    setLoginRole(registerRole);
    setRegisterName("");
    setRegisterEmail("");
    setRegisterChessCom("");
    setRegisterLichess("");
    setRegisterPassword("");
    setRegisterLevel("1200");
    setRegisterError("");
    setPage("login");
  }

  function updatePuzzleState(updater: (state: StoredPuzzleState) => StoredPuzzleState) {
    setPuzzleStates((current) => ({
      ...current,
      [activePuzzleStateKey]: updater(current[activePuzzleStateKey] ?? emptyPuzzleState)
    }));
  }

  function createMoveRecord(move: ReturnType<Chess["move"]>, fenAfterMove: string, moveNumber: number): MoveRecord {
    const promotion = move.promotion;
    return {
      moveNumber,
      from: move.from,
      to: move.to,
      promotion,
      san: move.san,
      uci: `${move.from}${move.to}${promotion ?? ""}`,
      fenAfterMove,
      timestamp: Date.now()
    };
  }

  function handleDrop(from: string, to: string) {
    if (locked) return false;

    const nextChess = new Chess(chess.fen());
    const move = nextChess.move({ from, to, promotion: "q" });
    if (!move) return false;

    const record = createMoveRecord(move, nextChess.fen(), currentMoves.length + 1);
    const nextMoves = [...currentMoves, record];
    setChess(nextChess);
    setCurrentMoves(nextMoves);
    setHintSquare(undefined);
    playMoveSound();

    const expectedMove = puzzle.solutionUci[currentMoves.length];
    if (record.uci !== expectedMove || nextMoves.length >= puzzle.solutionUci.length) {
      saveSubmittedAttempt(nextMoves);
      return true;
    }

    const opponentReplyUci = puzzle.solutionUci[nextMoves.length];
    if (opponentReplyUci) {
      const opponentMove = nextChess.move({
        from: opponentReplyUci.slice(0, 2),
        to: opponentReplyUci.slice(2, 4),
        promotion: opponentReplyUci.slice(4) || undefined
      });

      if (opponentMove) {
        const opponentRecord = createMoveRecord(opponentMove, nextChess.fen(), nextMoves.length + 1);
        const movesWithReply = [...nextMoves, opponentRecord];
        setChess(nextChess);
        setCurrentMoves(movesWithReply);
        playMoveSound(110);

        if (movesWithReply.length >= puzzle.solutionUci.length) {
          saveSubmittedAttempt(movesWithReply);
          return true;
        }
      }
    }

    setFeedback("pending");
    setFeedbackSquare(undefined);
    setLastMessage("Opponent reply played automatically.");

    return true;
  }

  function saveSubmittedAttempt(movesToSubmit: MoveRecord[]) {
    if (!canSubmitAttempt(puzzleState)) return;

    const submittedAt = Date.now();
    const attemptNumber = attemptsUsed + 1;
    const attempt = makeAttempt({
      puzzle,
      moves: movesToSubmit,
      attemptNumber,
      startedAt: attemptStartedAt,
      submittedAt
    });

    updatePuzzleState((state) => ({
      attempts: [...state.attempts, attempt],
      solved: state.solved || attempt.correct
    }));

    setReplayAttemptId(attempt.id);
    setFeedbackSquare(movesToSubmit[movesToSubmit.length - 1]?.to);
    if (attempt.correct) {
      setFeedback("correct");
      setAwaitingNextAttempt(false);
      setLastMessage("Correct. Attempt saved automatically.");
    } else if (attemptNumber >= MAX_ATTEMPTS) {
      setFeedback("incorrect");
      setAwaitingNextAttempt(false);
      setLastMessage("No attempts remaining.");
    } else {
      setFeedback("incorrect");
      setAwaitingNextAttempt(true);
      setLastMessage(`Incorrect. Attempt ${attemptNumber} was saved automatically. Review the position, then start attempt ${attemptNumber + 1}.`);
    }
  }

  function startNextAttempt() {
    resetCurrentAttempt();
    setFeedback("neutral");
    setFeedbackSquare(undefined);
    setHintSquare(undefined);
    setAwaitingNextAttempt(false);
    setLastMessage(`Attempt ${attemptsUsed + 1} is ready.`);
  }

  function clearPuzzleHistory() {
    updatePuzzleState(() => emptyPuzzleState);
    resetCurrentAttempt();
    setReplayAttemptId(undefined);
    setFeedback("neutral");
    setFeedbackSquare(undefined);
    setHintSquare(undefined);
    setAwaitingNextAttempt(false);
    setLastMessage("Puzzle history cleared.");
  }

  function goToPuzzleOffset(offset: number) {
    const assignedPuzzleIds = assignments
      .filter((assignment) => assignment.studentId === activeStudent.id)
      .map((assignment) => assignment.puzzleId);
    const availablePuzzles = assignedPuzzleIds.length
      ? allPuzzles.filter((item) => assignedPuzzleIds.includes(item.id))
      : allPuzzles;
    const currentIndex = availablePuzzles.findIndex((item) => item.id === puzzle.id);
    const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextPuzzle = availablePuzzles[(normalizedIndex + offset + availablePuzzles.length) % availablePuzzles.length];
    changePuzzle(nextPuzzle.id);
  }

  function assignCoachPuzzle() {
    if (coachCollectionPuzzles.length === 0) return;

    const assignedAt = Date.now();
    const confirmedStudentIds = new Set(coachStudentRoster.map((student) => student.id));
    const nextAssignments = coachSelectedStudentIds
      .filter((studentId) => confirmedStudentIds.has(studentId))
      .filter((studentId) => !assignments.some((assignment) => assignment.studentId === studentId && assignment.puzzleId === coachPuzzleId))
      .map((studentId) => ({
        id: `${studentId}-${coachPuzzleId}-${assignedAt}`,
        studentId,
        puzzleId: coachPuzzleId,
        assignedAt
      }));

    setAssignments((current) => dedupeAssignments([...current, ...nextAssignments]));
  }

  function addPuzzleToCoachCollection(puzzleId: string) {
    setCoachCollectionPuzzleIds((current) => {
      if (current.includes(puzzleId)) return current;
      return [...current, puzzleId];
    });
    setCoachPuzzleId(puzzleId);
  }

  function removePuzzleFromCoachCollection(puzzleId: string) {
    setCoachCollectionPuzzleIds((current) => current.filter((id) => id !== puzzleId));
    if (coachPuzzleId === puzzleId) {
      const nextPuzzleId = coachCollectionPuzzleIds.find((id) => id !== puzzleId) ?? puzzles[0].id;
      setCoachPuzzleId(nextPuzzleId);
    }
  }

  function deleteCustomPuzzle(puzzleId: string) {
    if (getPuzzleSource(puzzleId) !== "custom") return;

    const confirmed = window.confirm("Delete this custom puzzle from your local library?");
    if (!confirmed) return;

    const fallbackPuzzleId = puzzles[0].id;
    setCustomPuzzles((current) => current.filter((item) => item.id !== puzzleId));
    setCoachCollectionPuzzleIds((current) => current.filter((id) => id !== puzzleId));
    setAssignments((current) => current.filter((assignment) => assignment.puzzleId !== puzzleId));

    if (coachPuzzleId === puzzleId) {
      setCoachPuzzleId(fallbackPuzzleId);
    }

    if (activePuzzleId === puzzleId) {
      changePuzzle(fallbackPuzzleId);
    }
  }

  function importPuzzleFromPgn() {
    setNewPuzzleMessage("");
    const pgn = newPuzzlePgn.trim();
    if (!pgn) {
      setNewPuzzleMessage("Paste PGN before importing.");
      return;
    }

    const game = new Chess();
    try {
      game.loadPgn(pgn, { strict: false });
    } catch {
      setNewPuzzleMessage("PGN could not be parsed.");
      return;
    }

    const headers = game.getHeaders();
    const startFen = headers.FEN?.trim() || DEFAULT_POSITION;
    let startPosition: Chess;
    try {
      startPosition = new Chess(startFen);
    } catch {
      setNewPuzzleMessage("PGN FEN header is invalid.");
      return;
    }

    const moves = game.history({ verbose: true });
    if (moves.length === 0) {
      setNewPuzzleMessage("PGN does not contain any moves.");
      return;
    }

    const importedUci = moves.map((move) => `${move.from}${move.to}${move.promotion ?? ""}`);
    let puzzleFen = startFen;
    let puzzleSide = startPosition.turn();
    let solutionUci = importedUci;

    if (newPuzzlePgnFirstMove === "opponent") {
      const opponentMoveUci = importedUci[0];
      if (!opponentMoveUci || importedUci.length < 2) {
        setNewPuzzleMessage("PGN needs at least one opponent move and one solution move.");
        return;
      }

      const positionAfterOpponentMove = new Chess(startFen);
      const opponentMove = positionAfterOpponentMove.move({
        from: opponentMoveUci.slice(0, 2),
        to: opponentMoveUci.slice(2, 4),
        promotion: opponentMoveUci.slice(4) || undefined
      });

      if (!opponentMove) {
        setNewPuzzleMessage("The first PGN move could not be applied as the opponent move.");
        return;
      }

      puzzleFen = positionAfterOpponentMove.fen();
      puzzleSide = positionAfterOpponentMove.turn();
      solutionUci = importedUci.slice(1);
    }

    setNewPuzzleFen(puzzleFen);
    setNewPuzzleSide(puzzleSide);
    setNewPuzzleSolution(solutionUci.join(" "));
    setNewPuzzleMessage(`PGN imported: ${solutionUci.length} solution move${solutionUci.length === 1 ? "" : "s"} added.`);
  }

  function createCustomPuzzle() {
    setNewPuzzleMessage("");
    const fen = newPuzzleFen.trim();
    const solutionUci = newPuzzleSolution
      .split(/[\s,]+/)
      .map((move) => move.trim())
      .filter(Boolean);

    if (!fen || solutionUci.length === 0) {
      setNewPuzzleMessage("FEN and solution are required.");
      return;
    }

    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      setNewPuzzleMessage("FEN is invalid.");
      return;
    }

    if (chess.turn() !== newPuzzleSide) {
      setNewPuzzleMessage("Side to move must match the FEN.");
      return;
    }

    for (const uci of solutionUci) {
      try {
        chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.slice(4) || undefined
        });
      } catch {
        setNewPuzzleMessage(`Illegal solution move: ${uci}`);
        return;
      }
    }

    const id = makeCustomPuzzleId(new Set(allPuzzles.map((item) => item.id)), activeAccount?.role === "coach" ? activeAccount.id : undefined);
    const customPuzzle: Puzzle = {
      id,
      fen,
      sideToMove: newPuzzleSide,
      themes: newPuzzleThemes
        .split(",")
        .map((theme) => theme.trim())
        .filter(Boolean),
      difficulty: Number(newPuzzleDifficulty) || 1500,
      solutionUci,
      explanation: newPuzzleExplanation.trim() || "Custom puzzle.",
      creatorAccountId: activeAccount?.role === "coach" ? activeAccount.id : undefined,
      creatorName: activeAccount?.role === "coach" ? activeAccount.name : undefined
    };

    setCustomPuzzles((current) => [...current, customPuzzle]);
    setCoachPuzzleId(id);
    setActivePuzzleId(id);
    setNewPuzzlePgn("");
    setNewPuzzlePgnFirstMove("solver");
    setNewPuzzleFen("");
    setNewPuzzleThemes("");
    setNewPuzzleDifficulty("1500");
    setNewPuzzleSolution("");
    setNewPuzzleExplanation("");
    setNewPuzzleMessage("Custom puzzle created.");
  }

  async function generateSolutionWithStockfish() {
    setNewPuzzleMessage("");
    const fen = newPuzzleFen.trim();
    if (!fen) {
      setNewPuzzleMessage("Add a FEN before generating with Stockfish.");
      return;
    }

    try {
      const chess = new Chess(fen);
      if (chess.turn() !== newPuzzleSide) {
        setNewPuzzleMessage("Side to move must match the FEN before generation.");
        return;
      }

      setIsGeneratingSolution(true);
      const line = await generateStockfishLine(fen);
      setNewPuzzleSolution(line.join(" "));
      setNewPuzzleMessage(line.length ? "Stockfish line generated." : "Stockfish found no move.");
    } catch (error) {
      setNewPuzzleMessage(error instanceof Error ? error.message : "Could not generate with Stockfish.");
    } finally {
      setIsGeneratingSolution(false);
    }
  }

  function removeAssignment(assignmentId: string) {
    setAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId));
  }

  function requestExists(coachAccountId: string, studentId: string) {
    return connectionRequests.some((request) =>
      request.coachAccountId === coachAccountId &&
      request.studentId === studentId &&
      request.status === "pending"
    );
  }

  function linkExists(coachAccountId: string, studentId: string) {
    return coachStudentLinks.some((link) => link.coachAccountId === coachAccountId && link.studentId === studentId);
  }

  function addConnectionRequest(coachAccountId: string, studentId: string, requestedBy: AccountRole) {
    if (linkExists(coachAccountId, studentId)) {
      setConnectionMessage("This coach and student are already connected.");
      return;
    }

    if (requestExists(coachAccountId, studentId)) {
      setConnectionMessage("A pending request already exists.");
      return;
    }

    setConnectionRequests((current) => [
      ...current,
      {
        id: `request-${Date.now()}`,
        coachAccountId,
        studentId,
        requestedBy,
        status: "pending",
        createdAt: Date.now()
      }
    ]);
    setConnectionMessage("Request sent. The other side needs to confirm.");
  }

  function inviteStudentToCoach() {
    if (!activeCoachId) return;
    const email = studentInviteEmail.trim().toLowerCase();
    const studentAccount = studentAccounts.find((account) => account.email.toLowerCase() === email);

    if (!studentAccount?.studentId) {
      setConnectionMessage("No student account found with that email.");
      return;
    }

    addConnectionRequest(activeCoachId, studentAccount.studentId, "coach");
    setStudentInviteEmail("");
  }

  function requestCoachConnection() {
    if (!coachInviteId) return;
    addConnectionRequest(coachInviteId, activeStudent.id, "student");
  }

  function respondToConnectionRequest(requestId: string, accepted: boolean) {
    const request = connectionRequests.find((item) => item.id === requestId);
    if (!request) return;

    setConnectionRequests((current) =>
      current.map((item) => (
        item.id === requestId
          ? { ...item, status: accepted ? "accepted" : "declined", respondedAt: Date.now() }
          : item
      ))
    );

    if (accepted && !linkExists(request.coachAccountId, request.studentId)) {
      setCoachStudentLinks((current) => [
        ...current,
        {
          id: `link-${Date.now()}`,
          coachAccountId: request.coachAccountId,
          studentId: request.studentId,
          createdAt: Date.now()
        }
      ]);
      setConnectionMessage("Connection accepted.");
    } else {
      setConnectionMessage("Request declined.");
    }
  }

  function toggleCoachStudent(studentId: string) {
    setCoachSelectedStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  }

  function toggleAllCoachStudents() {
    setCoachSelectedStudentIds((current) =>
      current.length === coachStudentRoster.length ? [] : coachStudentRoster.map((student) => student.id)
    );
  }

  function addClass() {
    const name = newClassName.trim();
    if (!name) return;

    setClassRoster((current) => [
      ...current,
      {
        id: `class-${Date.now()}`,
        name
      }
    ]);
    setNewClassName("");
  }

  function updateStudentClass(studentId: string, classId: string) {
    setStudentRoster((current) =>
      current.map((student) => (
        student.id === studentId
          ? { ...student, classId: classId || undefined }
          : student
      ))
    );
  }

  function selectAssignClass(classId: string) {
    setSelectedAssignClassId(classId);
    if (classId === "manual") return;
    setCoachSelectedStudentIds(coachStudentRoster.filter((student) => student.classId === classId).map((student) => student.id));
  }

  function openStudentPuzzle(studentId: string, puzzleId: string) {
    setActiveStudentId(studentId);
    changePuzzle(puzzleId);
    setPage("solve");
  }

  function showHint() {
    const nextSolutionMove = puzzle.solutionUci[currentMoves.length];
    if (!nextSolutionMove || locked) return;

    setHintSquare(nextSolutionMove.slice(0, 2));
  }

  function openReplay(attemptId: string) {
    setReplayAttemptId(attemptId);
    setPage("replay");
  }

  function openReplayForPuzzle(studentId: string, puzzleId: string, attemptId: string) {
    setActiveStudentId(studentId);
    setActivePuzzleId(puzzleId);
    setReplayAttemptId(attemptId);
    setPage("replay");
  }

  function openCoachStudentDetail(studentId: string) {
    setSelectedCoachStudentId(studentId);
    setPage("studentDetail");
  }

  const currentMoveText = currentMoves.length
    ? formatMoveList(currentMoves)
    : "No moves in the current attempt.";

  if (page === "login") {
    const selectedAccounts = loginRole === "coach" ? coachAccounts : studentAccounts;
    const selectedAccountId = loginRole === "coach" ? selectedCoachAccountId : selectedStudentAccountId;
    const selectedAccount = selectedAccounts.find((account) => account.id === selectedAccountId);

    return (
      <main className="appShell loginShell">
        <header className="loginHeader">
          <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
          <h1>Log in</h1>
          <p className="headerPrompt">Use a coach account or a student account.</p>
        </header>

        <section className="loginPanel authPanel" aria-label="Login form">
          <div className="loginRoleSwitch" role="tablist" aria-label="Account type">
            <button
              type="button"
              className={loginRole === "coach" ? "selectedAttempt" : ""}
              onClick={() => { setLoginRole("coach"); setLoginError(""); setLoginPassword(""); }}
            >
              Coach
            </button>
            <button
              type="button"
              className={loginRole === "student" ? "selectedAttempt" : ""}
              onClick={() => { setLoginRole("student"); setLoginError(""); setLoginPassword(""); }}
            >
              Student
            </button>
          </div>

          <label className="formField">
            <span>Account</span>
            <select
              value={selectedAccountId}
              onChange={(event) => {
                if (loginRole === "coach") {
                  setSelectedCoachAccountId(event.target.value);
                } else {
                  setSelectedStudentAccountId(event.target.value);
                }
                setLoginError("");
              }}
            >
              {selectedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.email}
                </option>
              ))}
            </select>
          </label>

          <label className="formField">
            <span>Password</span>
            <input
              type="password"
              value={loginPassword}
              onChange={(event) => { setLoginPassword(event.target.value); setLoginError(""); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleLogin();
              }}
              placeholder={loginRole === "coach" ? "coach123" : "student123"}
            />
          </label>

          <button type="button" className="primaryButton authSubmitButton" onClick={handleLogin}>
            Log in as {loginRole}
          </button>
          {loginError ? <p className="status statusBanner status-incorrect">{loginError}</p> : null}
          <div className="authFooter">
            <span>New here?</span>
            <button
              type="button"
              onClick={() => {
                setRegisterRole(loginRole);
                setRegisterError("");
                setPage("register");
              }}
            >
              Create account
            </button>
          </div>
          <p className="studentSummary">
            Demo credential: {selectedAccount?.email} / {selectedAccount?.password}
          </p>
        </section>
        <CookieStorageNotice />
      </main>
    );
  }

  if (page === "register") {
    return (
      <main className="appShell loginShell">
        <header className="loginHeader">
          <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
          <h1>Create account</h1>
          <p className="headerPrompt">Register a local coach or student account.</p>
        </header>

        <section className="loginPanel authPanel" aria-label="Registration form">
          <div className="loginRoleSwitch" role="tablist" aria-label="Account type">
            <button
              type="button"
              className={registerRole === "coach" ? "selectedAttempt" : ""}
              onClick={() => { setRegisterRole("coach"); setRegisterError(""); }}
            >
              Coach
            </button>
            <button
              type="button"
              className={registerRole === "student" ? "selectedAttempt" : ""}
              onClick={() => { setRegisterRole("student"); setRegisterError(""); }}
            >
              Student
            </button>
          </div>

          <label className="formField">
            <span>Name</span>
            <input
              value={registerName}
              onChange={(event) => { setRegisterName(event.target.value); setRegisterError(""); }}
              placeholder={registerRole === "coach" ? "Coach name" : "Student name"}
            />
          </label>

          <label className="formField">
            <span>Email</span>
            <input
              type="email"
              value={registerEmail}
              onChange={(event) => { setRegisterEmail(event.target.value); setRegisterError(""); }}
              placeholder="name@example.com"
            />
          </label>

          <div className="formGrid">
            <label className="formField">
              <span>Chess.com username optional</span>
              <input
                value={registerChessCom}
                onChange={(event) => { setRegisterChessCom(event.target.value); setRegisterError(""); }}
                placeholder="chess.com username"
              />
            </label>
            <label className="formField">
              <span>Lichess username optional</span>
              <input
                value={registerLichess}
                onChange={(event) => { setRegisterLichess(event.target.value); setRegisterError(""); }}
                placeholder="lichess.org username"
              />
            </label>
          </div>

          <label className="formField">
            <span>Password</span>
            <input
              type="password"
              value={registerPassword}
              onChange={(event) => { setRegisterPassword(event.target.value); setRegisterError(""); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleRegister();
              }}
              placeholder="Create a password"
            />
          </label>

          {registerRole === "student" ? (
            <label className="formField">
              <span>Level</span>
              <input
                value={registerLevel}
                onChange={(event) => { setRegisterLevel(event.target.value); setRegisterError(""); }}
                placeholder="1200"
              />
            </label>
          ) : null}

          <div className="authActions">
            <button type="button" className="primaryButton authSubmitButton" onClick={handleRegister}>
              Create account
            </button>
            <button type="button" onClick={() => { setRegisterError(""); setPage("login"); }}>
              Back to login
            </button>
          </div>

          {registerError ? <p className="status statusBanner status-incorrect">{registerError}</p> : null}
          <p className="studentSummary">
            Accounts are stored locally in this browser for the MVP.
          </p>
        </section>
        <CookieStorageNotice />
      </main>
    );
  }

  if (page === "puzzles") {
    return (
      <main className="appShell">
        <header className="appHeader">
          <div>
            <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
            <h1>Puzzle library</h1>
            <p className="headerPrompt">Browse public puzzles and add them to your coach collection.</p>
          </div>
          <button
            type="button"
            className="primaryButton headerActionButton"
            onClick={() => document.getElementById("create-puzzle-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            <Plus aria-hidden="true" size={16} strokeWidth={2.4} />
            Create puzzle
          </button>
          <nav className="modeNav" aria-label="Workspace">
            <button type="button" onClick={() => setPage(activeRole === "coach" ? "coach" : "student")}>
              {activeRole === "coach" ? "My students" : "My puzzles"}
            </button>
            {activeRole === "coach" ? (
              <button type="button" onClick={() => setPage("collection")}>My puzzle collection</button>
            ) : null}
            <button type="button" className="selectedAttempt">Puzzle library</button>
            <button type="button" onClick={logOut}>Log out</button>
          </nav>
        </header>

        <div className="puzzleLibraryLayout">
          <section className="panel assignmentBoard">
            <div className="sectionHeader">
              <h2>Puzzle library</h2>
              <span>
                Showing {libraryRangeStart}-{libraryRangeEnd} of {filteredLibraryPuzzles.length} puzzles
              </span>
            </div>
            <div className="libraryFilters">
              <label className="formField searchField">
                <span>Search</span>
                <input
                  value={librarySearch}
                  onChange={(event) => setLibrarySearch(event.target.value)}
                  placeholder="Puzzle ID, theme, rating..."
                />
              </label>
              <label className="formField">
                <span>Source</span>
                <select value={librarySource} onChange={(event) => setLibrarySource(event.target.value as typeof librarySource)}>
                  <option value="all">All sources</option>
                  <option value="handmade">Hand-authored</option>
                  <option value="lichess">Lichess</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label className="formField">
                <span>Side</span>
                <select value={librarySide} onChange={(event) => setLibrarySide(event.target.value as typeof librarySide)}>
                  <option value="all">Either side</option>
                  <option value="w">White</option>
                  <option value="b">Black</option>
                </select>
              </label>
              <label className="formField">
                <span>Theme</span>
                <select value={libraryTheme} onChange={(event) => setLibraryTheme(event.target.value)}>
                  <option value="all">Any theme</option>
                  {libraryThemes.map((theme) => (
                    <option key={theme} value={theme}>{theme}</option>
                  ))}
                </select>
              </label>
              <label className="formField">
                <span>Min rating</span>
                <input
                  value={libraryMinRating}
                  onChange={(event) => setLibraryMinRating(event.target.value)}
                  inputMode="numeric"
                  placeholder="800"
                />
              </label>
              <label className="formField">
                <span>Max rating</span>
                <input
                  value={libraryMaxRating}
                  onChange={(event) => setLibraryMaxRating(event.target.value)}
                  inputMode="numeric"
                  placeholder="2400"
                />
              </label>
              <button
                type="button"
                className="selectAllButton clearFiltersButton"
                onClick={() => {
                  setLibrarySearch("");
                  setLibrarySource("all");
                  setLibrarySide("all");
                  setLibraryTheme("all");
                  setLibraryMinRating("");
                  setLibraryMaxRating("");
                }}
              >
                Clear filters
              </button>
            </div>
            <div className="libraryPagination">
              <span>
                Page {currentLibraryPage} / {libraryPageCount}
              </span>
              <div className="buttonRow">
                <button
                  type="button"
                  onClick={() => setLibraryPage((page) => Math.max(1, page - 1))}
                  disabled={currentLibraryPage <= 1}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryPage((page) => Math.min(libraryPageCount, page + 1))}
                  disabled={currentLibraryPage >= libraryPageCount}
                >
                  Next
                </button>
              </div>
            </div>
            <div className="libraryGrid">
              {pagedLibraryPuzzles.map((item) => (
                <article key={item.id} className="libraryPuzzleCard">
                  <PuzzlePreviewBoard fen={item.fen} orientation={item.sideToMove === "w" ? "white" : "black"} />
                  <div className="libraryPuzzleInfo">
                    <div className="attemptTopline">
                      <strong>{item.id}</strong>
                      <span>{formatSide(item.sideToMove)} to move</span>
                    </div>
                    <div className="assignmentMeta">
                      <span>{getPuzzleSource(item.id)}</span>
                      {item.creatorName ? <span>Creator {item.creatorName}</span> : null}
                      <span>Difficulty {item.difficulty}</span>
                      {item.themes.map((theme) => <span key={theme}>{theme}</span>)}
                    </div>
                    <div className="buttonRow">
                      <button
                        type="button"
                        onClick={() => addPuzzleToCoachCollection(item.id)}
                        disabled={coachCollectionPuzzleIds.includes(item.id)}
                      >
                        {coachCollectionPuzzleIds.includes(item.id) ? "In collection" : "Add to collection"}
                      </button>
                      <button type="button" className="primaryButton" onClick={() => openStudentPuzzle(activeStudent.id, item.id)}>
                        Open puzzle
                      </button>
                      {getPuzzleSource(item.id) === "custom" ? (
                        <button
                          type="button"
                          className="iconButton tooltipButton dangerIconButton"
                          data-tooltip="Delete custom puzzle"
                          aria-label="Delete custom puzzle"
                          onClick={() => deleteCustomPuzzle(item.id)}
                        >
                          <Trash2 aria-hidden="true" size={18} strokeWidth={2.4} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              {filteredLibraryPuzzles.length === 0 ? (
                <p className="muted">No puzzles match these filters.</p>
              ) : null}
            </div>
          </section>

          <section className="panel customPuzzlePanel" id="create-puzzle-panel">
            <div className="sectionHeader">
              <h2>Create a puzzle</h2>
              <span>Local only</span>
            </div>
            <div className="pgnImportBox">
              <label className="formField">
                <span>First PGN move</span>
                <select
                  value={newPuzzlePgnFirstMove}
                  onChange={(event) => setNewPuzzlePgnFirstMove(event.target.value as "solver" | "opponent")}
                >
                  <option value="solver">Student best move</option>
                  <option value="opponent">Opponent move before puzzle</option>
                </select>
              </label>
              <label className="formField">
                <span>Import from PGN</span>
                <textarea
                  value={newPuzzlePgn}
                  onChange={(event) => setNewPuzzlePgn(event.target.value)}
                  rows={5}
                  placeholder={'Paste PGN. Use a [FEN "..."] header when the puzzle starts from a tactic position.'}
                />
              </label>
              <button type="button" className="engineButton" onClick={importPuzzleFromPgn} disabled={!newPuzzlePgn.trim()}>
                Fill fields from PGN
              </button>
            </div>
            <label className="formField">
              <span>FEN</span>
              <textarea value={newPuzzleFen} onChange={(event) => setNewPuzzleFen(event.target.value)} rows={3} placeholder="Paste FEN..." />
            </label>
            <div className="formGrid">
              <label className="formField">
                <span>Side</span>
                <select value={newPuzzleSide} onChange={(event) => setNewPuzzleSide(event.target.value as "w" | "b")}>
                  <option value="w">White</option>
                  <option value="b">Black</option>
                </select>
              </label>
              <label className="formField">
                <span>Difficulty</span>
                <input value={newPuzzleDifficulty} onChange={(event) => setNewPuzzleDifficulty(event.target.value)} inputMode="numeric" />
              </label>
            </div>
            <label className="formField">
              <span>Themes</span>
              <input value={newPuzzleThemes} onChange={(event) => setNewPuzzleThemes(event.target.value)} placeholder="mate, back rank" />
            </label>
            <label className="formField">
              <span>Solution UCI</span>
              <input value={newPuzzleSolution} onChange={(event) => setNewPuzzleSolution(event.target.value)} placeholder="e2e8 or f3e5 g4d1 c4f7" />
            </label>
            <button type="button" className="engineButton" onClick={generateSolutionWithStockfish} disabled={isGeneratingSolution || !newPuzzleFen.trim()}>
              {isGeneratingSolution ? "Generating with Stockfish..." : "Generate with Stockfish"}
            </button>
            <label className="formField">
              <span>Explanation</span>
              <textarea value={newPuzzleExplanation} onChange={(event) => setNewPuzzleExplanation(event.target.value)} rows={3} placeholder="Optional coach note..." />
            </label>
            <button type="button" className="primaryButton assignButton" onClick={createCustomPuzzle}>
              <Plus aria-hidden="true" size={16} strokeWidth={2.4} />
              Create puzzle
            </button>
            {newPuzzleMessage ? <p className="studentSummary">{newPuzzleMessage}</p> : null}
          </section>
        </div>
        <CookieStorageNotice />
      </main>
    );
  }

  if (page === "coach") {
    return (
      <main className="appShell">
        <header className="appHeader">
          <div>
            <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
            <h1>Coach workspace</h1>
          <p className="headerPrompt">Review student progress and manage assignments.</p>
          </div>
          <nav className="modeNav" aria-label="Workspace">
            <button type="button" className="selectedAttempt">My students</button>
            <button type="button" onClick={() => setPage("classes")}>My class</button>
            <button type="button" onClick={() => setPage("collection")}>My puzzle collection</button>
            <button type="button" onClick={() => setPage("puzzles")}>Puzzle library</button>
            <button type="button" onClick={logOut}>Log out</button>
          </nav>
        </header>

        <div className="coachLayout">
          <section className="panel assignmentBoard">
            <div className="sectionHeader">
              <h2>My students</h2>
              <span>{filteredStudentRoster.length} / {coachStudentRoster.length} students</span>
            </div>
            <div className="studentToolbar">
              <label className="formField">
                <span>Filter by name</span>
                <input
                  value={studentSearch}
                  onChange={(event) => setStudentSearch(event.target.value)}
                  placeholder="Search students..."
                />
              </label>
              <button type="button" className="primaryButton assignButton" onClick={() => setShowAddStudentForm((current) => !current)}>
                <Plus aria-hidden="true" size={16} strokeWidth={2.4} />
                {showAddStudentForm ? "Cancel" : "Add student"}
              </button>
            </div>
            {showAddStudentForm ? (
              <div className="addStudentForm">
                <label className="formField">
                  <span>Student email</span>
                  <input
                    value={studentInviteEmail}
                    onChange={(event) => { setStudentInviteEmail(event.target.value); setConnectionMessage(""); }}
                    placeholder="student@example.com"
                  />
                </label>
                <button type="button" className="primaryButton assignButton" onClick={inviteStudentToCoach} disabled={!studentInviteEmail.trim()}>
                  Send request
                </button>
              </div>
            ) : null}
            {connectionMessage ? <p className="status statusBanner">{connectionMessage}</p> : null}
            {pendingCoachRequests.length ? (
              <div className="connectionRequestList">
                <strong>Requests from students</strong>
                {pendingCoachRequests.map((request) => {
                  const student = studentRoster.find((item) => item.id === request.studentId);
                  return (
                    <article key={request.id} className="connectionRequestCard">
                      <span>{student?.name ?? "Student"} wants to add you as coach.</span>
                      <div className="buttonRow">
                        <button type="button" className="primaryButton" onClick={() => respondToConnectionRequest(request.id, true)}>Accept</button>
                        <button type="button" onClick={() => respondToConnectionRequest(request.id, false)}>Decline</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
            <div className="studentAssignmentGrid">
              {filteredStudentRoster.map((student) => {
                const studentAssignments = assignments.filter((assignment) => assignment.studentId === student.id);
                const solvedCount = studentAssignments.filter((assignment) => {
                  const state = puzzleStates[makePuzzleStateKey(student.id, assignment.puzzleId)];
                  return state?.solved;
                }).length;
                const attemptCount = studentAssignments.reduce((total, assignment) => {
                  const state = puzzleStates[makePuzzleStateKey(student.id, assignment.puzzleId)];
                  return total + (state?.attempts.length ?? 0);
                }, 0);

                return (
                  <button
                    type="button"
                    key={student.id}
                    className="studentAssignmentCard studentCardButton"
                    onClick={() => openCoachStudentDetail(student.id)}
                  >
                    <div className="attemptTopline">
                      <strong>{student.name}</strong>
                      <span className="badge">{student.level}</span>
                    </div>
                    <div className="studentStats">
                      <span>{studentAssignments.length} assigned</span>
                      <span>{solvedCount} solved</span>
                      <span>{attemptCount} attempts</span>
                      <span>{classRoster.find((item) => item.id === student.classId)?.name ?? "No class"}</span>
                    </div>
                  </button>
                );
              })}
              {filteredStudentRoster.length === 0 ? <p className="muted">No students match that name.</p> : null}
            </div>
          </section>
        </div>
        <CookieStorageNotice />
      </main>
    );
  }

  if (page === "collection") {
    const coachPuzzle = coachCollectionPuzzles.find((item) => item.id === coachPuzzleId)
      ?? coachCollectionPuzzles[0]
      ?? allPuzzles[0];

    return (
      <main className="appShell">
        <header className="appHeader">
          <div>
            <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
            <h1>My puzzle collection</h1>
            <p className="headerPrompt">Choose from your saved puzzles and assign them to students.</p>
          </div>
          <nav className="modeNav" aria-label="Workspace">
            <button type="button" onClick={() => setPage("coach")}>My students</button>
            <button type="button" onClick={() => setPage("classes")}>My class</button>
            <button type="button" className="selectedAttempt">My puzzle collection</button>
            <button type="button" onClick={() => setPage("puzzles")}>Puzzle library</button>
            <button type="button" onClick={logOut}>Log out</button>
          </nav>
        </header>

        <div className="coachLayout">
          <section className="panel assignmentComposer">
            <div className="sectionHeader">
              <h2>My puzzle collection</h2>
              <span>{coachCollectionPuzzles.length} puzzles</span>
            </div>
            {coachCollectionPuzzles.length ? (
              <div className="puzzlePickerWithPreview">
                <PuzzlePreviewBoard
                  fen={coachPuzzle.fen}
                  orientation={coachPuzzle.sideToMove === "w" ? "white" : "black"}
                />
                <div className="puzzlePickerDetails">
                  <label className="compactField">
                    <span>Puzzle</span>
                    <select value={coachPuzzle.id} onChange={(event) => setCoachPuzzleId(event.target.value)}>
                      {coachCollectionPuzzles.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="assignmentMeta">
                    <span>{formatSide(coachPuzzle.sideToMove)} to move</span>
                    <span>Difficulty {coachPuzzle.difficulty}</span>
                    {coachPuzzle.themes.map((theme) => (
                      <span key={theme}>{theme}</span>
                    ))}
                  </div>
                  <div className="buttonRow">
                    <button type="button" className="primaryButton" onClick={() => changePuzzle(coachPuzzle.id)}>
                      Open puzzle
                    </button>
                    <button type="button" className="textButton" onClick={() => removePuzzleFromCoachCollection(coachPuzzle.id)}>
                      Remove from collection
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="emptyCollection">
                <p className="muted">No puzzles in your collection yet.</p>
                <button type="button" className="primaryButton" onClick={() => setPage("puzzles")}>
                  Browse public library
                </button>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <h2>Students</h2>
              <span>{coachSelectedStudentIds.length} selected</span>
            </div>
            <label className="formField">
              <span>Assign by class</span>
              <select value={selectedAssignClassId} onChange={(event) => selectAssignClass(event.target.value)}>
                <option value="manual">Manual selection</option>
                {classRoster.map((coachClass) => (
                  <option key={coachClass.id} value={coachClass.id}>
                    {coachClass.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="selectAllButton" onClick={toggleAllCoachStudents}>
              {coachSelectedStudentIds.length === coachStudentRoster.length ? "Clear selection" : "Select all"}
            </button>
            <div className="studentChecklist">
              {coachStudentRoster.map((student) => (
                <label key={student.id} className="studentCheck">
                  <input
                    type="checkbox"
                    checked={coachSelectedStudentIds.includes(student.id)}
                    onChange={() => toggleCoachStudent(student.id)}
                  />
                  <span>
                    <strong>{student.name}</strong>
                    <small>{classRoster.find((item) => item.id === student.classId)?.name ?? "No class"}</small>
                  </span>
                </label>
              ))}
              {coachStudentRoster.length === 0 ? <p className="muted">No confirmed students yet.</p> : null}
            </div>
            <button
              type="button"
              className="primaryButton assignButton"
              onClick={assignCoachPuzzle}
              disabled={coachSelectedStudentIds.length === 0 || coachCollectionPuzzles.length === 0}
            >
              <Send aria-hidden="true" size={16} strokeWidth={2.4} />
              Assign puzzle
            </button>
          </section>

          <section className="panel assignmentBoard">
            <div className="sectionHeader">
              <h2>Assigned puzzles</h2>
              <span>{assignments.length} total</span>
            </div>
            <div className="studentAssignmentGrid">
              {coachStudentRoster.map((student) => {
                const studentAssignments = assignments.filter((assignment) => assignment.studentId === student.id);
                return (
                  <article key={student.id} className="studentAssignmentCard">
                    <div className="attemptTopline">
                      <strong>{student.name}</strong>
                    </div>
                    <p className="studentSummary">{studentAssignments.length} assigned puzzles</p>
                    {studentAssignments.length ? (
                      studentAssignments.map((assignment) => {
                        const assignedPuzzle = allPuzzles.find((item) => item.id === assignment.puzzleId);
                        const state = puzzleStates[makePuzzleStateKey(student.id, assignment.puzzleId)] ?? emptyPuzzleState;
                        if (!assignedPuzzle) return null;
                        return (
                          <button
                            type="button"
                            key={assignment.id}
                            className="assignmentRow"
                            onClick={() => openStudentPuzzle(student.id, assignedPuzzle.id)}
                          >
                            <span>{assignedPuzzle.id}</span>
                            <strong>{describePuzzleProgress(state, assignedPuzzle.solutionUci)}</strong>
                            <span
                              role="button"
                              tabIndex={0}
                              className="assignmentRemove"
                              aria-label={`Remove ${assignedPuzzle.id} from ${student.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                removeAssignment(assignment.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  removeAssignment(assignment.id);
                                }
                              }}
                            >
                              <X aria-hidden="true" size={15} strokeWidth={2.4} />
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="muted">No assignments yet.</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
        <CookieStorageNotice />
      </main>
    );
  }

  if (page === "classes") {
    return (
      <main className="appShell">
        <header className="appHeader">
          <div>
            <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
            <h1>My class</h1>
            <p className="headerPrompt">Create classes and optionally place students into one class.</p>
          </div>
          <nav className="modeNav" aria-label="Workspace">
            <button type="button" onClick={() => setPage("coach")}>My students</button>
            <button type="button" className="selectedAttempt">My class</button>
            <button type="button" onClick={() => setPage("collection")}>My puzzle collection</button>
            <button type="button" onClick={() => setPage("puzzles")}>Puzzle library</button>
            <button type="button" onClick={logOut}>Log out</button>
          </nav>
        </header>

        <div className="studentPageLayout">
          <section className="panel">
            <div className="sectionHeader">
              <h2>Classes</h2>
              <span>{classRoster.length} classes</span>
            </div>
            <div className="addStudentForm">
              <label className="formField">
                <span>Class name</span>
                <input
                  value={newClassName}
                  onChange={(event) => setNewClassName(event.target.value)}
                  placeholder="e.g. Thursday Group"
                />
              </label>
              <button type="button" className="primaryButton assignButton" onClick={addClass} disabled={!newClassName.trim()}>
                <Plus aria-hidden="true" size={16} strokeWidth={2.4} />
                Add class
              </button>
            </div>
            <div className="studentStats">
              {classRoster.map((coachClass) => (
                <span key={coachClass.id}>{coachClass.name}</span>
              ))}
            </div>
          </section>

          <section className="panel assignmentBoard">
            <div className="sectionHeader">
              <h2>Student class membership</h2>
              <span>{coachStudentRoster.length} students</span>
            </div>
            <div className="studentAssignmentGrid">
              {coachStudentRoster.map((student) => (
                <article key={student.id} className="studentAssignmentCard">
                  <div className="attemptTopline">
                    <strong>{student.name}</strong>
                    <span className="badge">{student.level}</span>
                  </div>
                  <label className="formField">
                    <span>Class</span>
                    <select value={student.classId ?? ""} onChange={(event) => updateStudentClass(student.id, event.target.value)}>
                      <option value="">No class</option>
                      {classRoster.map((coachClass) => (
                        <option key={coachClass.id} value={coachClass.id}>
                          {coachClass.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
              {coachStudentRoster.length === 0 ? <p className="muted">No confirmed students yet.</p> : null}
            </div>
          </section>
        </div>
        <CookieStorageNotice />
      </main>
    );
  }

  if (page === "studentDetail") {
    const selectedStudent = studentRoster.find((student) => student.id === selectedCoachStudentId) ?? studentRoster[0];
    const studentAssignments = assignments.filter((assignment) => assignment.studentId === selectedStudent.id);
    const solvedCount = studentAssignments.filter((assignment) => {
      const state = puzzleStates[makePuzzleStateKey(selectedStudent.id, assignment.puzzleId)];
      return state?.solved;
    }).length;
    const attemptCount = studentAssignments.reduce((total, assignment) => {
      const state = puzzleStates[makePuzzleStateKey(selectedStudent.id, assignment.puzzleId)];
      return total + (state?.attempts.length ?? 0);
    }, 0);

    return (
      <main className="appShell">
        <header className="appHeader">
          <div>
            <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
            <h1>{selectedStudent.name}</h1>
            <p className="headerPrompt">Assigned puzzle progress and solving history.</p>
          </div>
          <nav className="modeNav" aria-label="Workspace">
            <button type="button" onClick={() => setPage("coach")}>My students</button>
            <button type="button" onClick={() => setPage("classes")}>My class</button>
            <button type="button" onClick={() => setPage("collection")}>My puzzle collection</button>
            <button type="button" onClick={() => setPage("puzzles")}>Puzzle library</button>
            <button type="button" onClick={logOut}>Log out</button>
          </nav>
        </header>

        <div className="studentPageLayout">
          <section className="panel">
            <div className="sectionHeader">
              <h2>Student summary</h2>
              <span className="badge">{selectedStudent.level}</span>
            </div>
            <div className="studentStats">
              <span>{studentAssignments.length} assigned</span>
              <span>{solvedCount} solved</span>
              <span>{attemptCount} attempts</span>
            </div>
          </section>

          <section className="panel assignmentBoard">
            <div className="sectionHeader">
              <h2>Assigned puzzles</h2>
              <span>{studentAssignments.length} puzzles</span>
            </div>
            <div className="studentPuzzleGrid">
              {studentAssignments.length ? (
                studentAssignments.map((assignment) => {
                  const assignedPuzzle = allPuzzles.find((item) => item.id === assignment.puzzleId);
                  if (!assignedPuzzle) return null;

                  const state = puzzleStates[makePuzzleStateKey(selectedStudent.id, assignment.puzzleId)] ?? emptyPuzzleState;

                  return (
                    <article key={assignment.id} className="studentPuzzleCard">
                      <div className="attemptTopline">
                        <strong>{assignedPuzzle.id}</strong>
                        <span className={state.solved ? "badge success" : "badge"}>
                          {state.solved ? "Solved" : `${state.attempts.length}/${MAX_ATTEMPTS}`}
                        </span>
                      </div>
                      <p>{formatSide(assignedPuzzle.sideToMove)} to move</p>
                      <p>{assignedPuzzle.themes.join(", ")}</p>
                      <p className="studentSummary">{describePuzzleProgress(state, assignedPuzzle.solutionUci)}</p>
                      <div className="studentHistoryMini">
                        <strong>Attempts</strong>
                        {state.attempts.length ? (
                          state.attempts.map((attempt) => (
                            <button
                              type="button"
                              key={attempt.id}
                              className="historyMiniRow"
                              onClick={() => openReplayForPuzzle(selectedStudent.id, assignedPuzzle.id, attempt.id)}
                            >
                              <span>Attempt {attempt.attemptNumber}: {attempt.correct ? "Correct" : "Incorrect"}</span>
                              <em>{describeAttemptOutcome(attempt.moves, attempt.correct, assignedPuzzle.solutionUci)}</em>
                            </button>
                          ))
                        ) : (
                          <span className="muted">No attempts yet.</span>
                        )}
                      </div>
                      <button type="button" className="primaryButton" onClick={() => openStudentPuzzle(selectedStudent.id, assignedPuzzle.id)}>
                        Open puzzle
                      </button>
                    </article>
                  );
                })
              ) : (
                <p className="muted">No puzzles assigned yet.</p>
              )}
            </div>
          </section>
        </div>
        <CookieStorageNotice />
      </main>
    );
  }

  if (page === "student") {
    const studentAssignments = assignments.filter((assignment) => assignment.studentId === activeStudent.id);

    return (
      <main className="appShell">
        <header className="appHeader">
          <div>
            <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
            <h1>My puzzles</h1>
            <p className="headerPrompt">Welcome, {activeStudent.name}.</p>
          </div>
          <nav className="modeNav" aria-label="Account">
            <button type="button" onClick={logOut}>Log out</button>
          </nav>
        </header>

        <div className="studentPageLayout">
          <section className="panel identityPanel">
            <div className="sectionHeader">
              <h2>Signed in as</h2>
              <span>Student account</span>
            </div>
            <p className="accountName">{activeAccount?.name ?? activeStudent.name}</p>
            <p className="studentSummary">{activeAccount?.email}</p>
            <div className="connectionBox">
              <div className="sectionHeader">
                <h3>My coaches</h3>
                <span>{activeStudentCoaches.length}</span>
              </div>
              {activeStudentCoaches.length ? (
                <div className="studentStats">
                  {activeStudentCoaches.map((coach) => (
                    <span key={coach.id}>{coach.name}</span>
                  ))}
                </div>
              ) : (
                <p className="muted">No coach connected yet.</p>
              )}
              <label className="formField">
                <span>Add coach</span>
                <select value={coachInviteId} onChange={(event) => { setCoachInviteId(event.target.value); setConnectionMessage(""); }}>
                  {coachAccounts.map((coach) => (
                    <option key={coach.id} value={coach.id}>
                      {coach.name} · {coach.email}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="primaryButton assignButton" onClick={requestCoachConnection} disabled={!coachInviteId}>
                Send request
              </button>
            </div>
            {pendingStudentRequests.length ? (
              <div className="connectionRequestList">
                <strong>Requests from coaches</strong>
                {pendingStudentRequests.map((request) => {
                  const coach = coachAccounts.find((account) => account.id === request.coachAccountId);
                  return (
                    <article key={request.id} className="connectionRequestCard">
                      <span>{coach?.name ?? "Coach"} wants to add you as a student.</span>
                      <div className="buttonRow">
                        <button type="button" className="primaryButton" onClick={() => respondToConnectionRequest(request.id, true)}>Accept</button>
                        <button type="button" onClick={() => respondToConnectionRequest(request.id, false)}>Decline</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
            {connectionMessage ? <p className="status statusBanner">{connectionMessage}</p> : null}
          </section>

          <section className="panel assignmentBoard">
            <div className="sectionHeader">
              <h2>My assigned puzzles</h2>
              <span>{studentAssignments.length} puzzles</span>
            </div>
            <div className="studentPuzzleGrid">
              {studentAssignments.length ? (
                studentAssignments.map((assignment) => {
                  const assignedPuzzle = allPuzzles.find((item) => item.id === assignment.puzzleId);
                  const state = puzzleStates[makePuzzleStateKey(activeStudent.id, assignment.puzzleId)] ?? emptyPuzzleState;
                  if (!assignedPuzzle) return null;
                  return (
                    <article key={assignment.id} className="studentPuzzleCard">
                      <div className="attemptTopline">
                        <strong>{assignedPuzzle.id}</strong>
                        <span className={state.solved ? "badge success" : "badge"}>{state.solved ? "Solved" : `${state.attempts.length}/${MAX_ATTEMPTS}`}</span>
                      </div>
                      <p>{formatSide(assignedPuzzle.sideToMove)} to move</p>
                      <p>{assignedPuzzle.themes.join(", ")}</p>
                      <p className="studentSummary">{describePuzzleProgress(state, assignedPuzzle.solutionUci)}</p>
                      <div className="studentHistoryMini">
                        <strong>History</strong>
                        {state.attempts.length ? (
                          state.attempts.map((attempt) => (
                            <button
                              type="button"
                              key={attempt.id}
                              className="historyMiniRow"
                              onClick={() => openReplayForPuzzle(activeStudent.id, assignedPuzzle.id, attempt.id)}
                            >
                              <span>Attempt {attempt.attemptNumber}</span>
                              <em>{describeAttemptOutcome(attempt.moves, attempt.correct, assignedPuzzle.solutionUci)}</em>
                            </button>
                          ))
                        ) : (
                          <span className="muted">No attempts yet.</span>
                        )}
                      </div>
                      <button type="button" className="primaryButton" onClick={() => openStudentPuzzle(activeStudent.id, assignedPuzzle.id)}>
                        Start puzzle
                      </button>
                    </article>
                  );
                })
              ) : (
                <p className="muted">No puzzles assigned yet.</p>
              )}
            </div>
          </section>
        </div>
        <CookieStorageNotice />
      </main>
    );
  }

  if (page === "replay") {
    return (
      <main className="appShell">
        <ReplayPanel
          puzzle={puzzle}
          attempts={puzzleState.attempts}
          selectedAttemptId={replayAttemptId}
          onBack={() => setPage("solve")}
        />
        <CookieStorageNotice />
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">ChessCoach Puzzle Trace MVP</p>
          <h1>{formatSide(puzzle.sideToMove)} to move</h1>
          <p className="headerPrompt">{activeStudent.name}: find the best move.</p>
        </div>
        <nav className="modeNav" aria-label="Workspace">
          <button type="button" onClick={() => setPage(activeRole === "coach" ? "coach" : "student")}>
            {activeRole === "coach" ? "My students" : "My puzzles"}
          </button>
          {activeRole === "coach" ? (
            <button type="button" onClick={() => setPage("classes")}>My class</button>
          ) : null}
          {activeRole === "coach" ? (
            <button type="button" onClick={() => setPage("collection")}>My puzzle collection</button>
          ) : null}
          {activeRole === "coach" ? (
            <button type="button" onClick={() => setPage("puzzles")}>Puzzle library</button>
          ) : null}
          <button type="button" onClick={logOut}>Log out</button>
        </nav>
      </header>

      <div className="layout">
        <section className="leftColumn">
          <div className="panel introPanel">
            <span className="attemptCounter">Attempts used: {attemptsUsed} / {MAX_ATTEMPTS}</span>
          </div>

          <SolveBoard
            key={puzzle.id}
            fen={chess.fen()}
            locked={locked}
            orientation={puzzle.sideToMove === "w" ? "white" : "black"}
            feedback={feedback}
            feedbackSquare={feedbackSquare}
            hintSquare={hintSquare}
            onDrop={handleDrop}
          />

          <section className="panel controlsPanel">
            <div className="buttonRow primaryActions">
              {awaitingNextAttempt && attemptsUsed < MAX_ATTEMPTS ? (
                <button type="button" className="primaryButton" onClick={startNextAttempt}>
                  Next attempt
                </button>
              ) : null}
              <button
                type="button"
                className="iconButton tooltipButton"
                aria-label="Hint"
                data-tooltip="Hint"
                onClick={showHint}
                disabled={locked || currentMoves.length >= puzzle.solutionUci.length}
              >
                <Lightbulb aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="iconButton tooltipButton"
                aria-label="Reset position"
                data-tooltip="Reset position"
                onClick={() => { resetCurrentAttempt(); setFeedback("neutral"); setFeedbackSquare(undefined); setHintSquare(undefined); setLastMessage("Current attempt reset."); }}
                disabled={locked || currentMoves.length === 0}
              >
                <RotateCcw aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="iconButton tooltipButton dangerIconButton"
                aria-label="Clear puzzle history"
                data-tooltip="Clear puzzle history"
                onClick={clearPuzzleHistory}
                disabled={attemptsUsed === 0 && currentMoves.length === 0}
              >
                <Trash2 aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="iconButton tooltipButton"
                aria-label="Previous puzzle"
                data-tooltip="Previous puzzle"
                onClick={() => goToPuzzleOffset(-1)}
              >
                <SkipBack aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="iconButton tooltipButton"
                aria-label="Next puzzle"
                data-tooltip="Next puzzle"
                onClick={() => goToPuzzleOffset(1)}
              >
                <SkipForward aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
            </div>
            {lastMessage ? <p className={`status statusBanner status-${feedback}`}>{lastMessage}</p> : null}
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <h2>Current Move List</h2>
              <span>{currentMoves.length} moves</span>
            </div>
            <p className="moveLine">{currentMoveText}</p>
          </section>
        </section>

        <aside className="rightColumn">
          {activeRole === "coach" ? (
            <section className="panel">
              <div className="sectionHeader">
                <h2>My puzzle collection</h2>
                <span>{puzzleInCoachCollection ? "Saved" : "Not saved"}</span>
              </div>
              <button
                type="button"
                className="primaryButton assignButton"
                onClick={() => addPuzzleToCoachCollection(puzzle.id)}
                disabled={puzzleInCoachCollection}
              >
                <Plus aria-hidden="true" size={16} strokeWidth={2.4} />
                {puzzleInCoachCollection ? "In collection" : "Add to collection"}
              </button>
            </section>
          ) : null}

          <section className="panel metadataGrid">
            <div>
              <span>Difficulty</span>
              <strong>{puzzle.difficulty}</strong>
            </div>
            <div>
              <span>Themes</span>
              <strong>{puzzle.themes.join(", ")}</strong>
            </div>
            <div>
              <span>Side to move</span>
              <strong>{formatSide(puzzle.sideToMove)}</strong>
            </div>
          </section>

          <AttemptHistory attempts={puzzleState.attempts} solutionUci={puzzle.solutionUci} onReplay={openReplay} />
        </aside>
      </div>
      <CookieStorageNotice />
    </main>
  );
}
