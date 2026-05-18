import { Chess } from "chess.js";

const ENGINE_TIMEOUT_MS = 12000;
const DEFAULT_DEPTH = 12;
const DEFAULT_MAX_PLIES = 5;

function createStockfishWorker() {
  const engineUrl = new URL("stockfish/bin/stockfish-18-lite-single.js", import.meta.url);
  const wasmUrl = new URL("stockfish/bin/stockfish-18-lite-single.wasm", import.meta.url);
  return new Worker(`${engineUrl.toString()}#${encodeURIComponent(wasmUrl.toString())}`);
}

function waitFor(worker: Worker, predicate: (line: string) => boolean, timeoutMs = ENGINE_TIMEOUT_MS) {
  return new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener("message", onMessage);
      reject(new Error("Stockfish timed out."));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      const line = String(event.data);
      if (!predicate(line)) return;
      window.clearTimeout(timeout);
      worker.removeEventListener("message", onMessage);
      resolve(line);
    }

    worker.addEventListener("message", onMessage);
  });
}

async function sendAndWait(worker: Worker, command: string, predicate: (line: string) => boolean) {
  const result = waitFor(worker, predicate);
  worker.postMessage(command);
  return result;
}

async function initializeEngine(worker: Worker) {
  await sendAndWait(worker, "uci", (line) => line === "uciok");
  await sendAndWait(worker, "isready", (line) => line === "readyok");
  worker.postMessage("ucinewgame");
  await sendAndWait(worker, "isready", (line) => line === "readyok");
}

async function findBestMove(worker: Worker, fen: string, depth: number) {
  worker.postMessage(`position fen ${fen}`);
  const bestMoveLine = await sendAndWait(worker, `go depth ${depth}`, (line) => line.startsWith("bestmove "));
  const bestMove = bestMoveLine.split(/\s+/)[1];
  if (!bestMove || bestMove === "(none)") {
    throw new Error("Stockfish did not return a move.");
  }
  return bestMove;
}

export async function generateStockfishLine(fen: string, maxPlies = DEFAULT_MAX_PLIES, depth = DEFAULT_DEPTH) {
  const chess = new Chess(fen);
  const worker = createStockfishWorker();
  const line: string[] = [];

  try {
    await initializeEngine(worker);

    for (let ply = 0; ply < maxPlies && !chess.isGameOver(); ply += 1) {
      const bestMove = await findBestMove(worker, chess.fen(), depth);
      const move = chess.move({
        from: bestMove.slice(0, 2),
        to: bestMove.slice(2, 4),
        promotion: bestMove.slice(4) || undefined
      });
      if (!move) break;
      line.push(bestMove);
      if (chess.isCheckmate()) break;
    }

    return line;
  } finally {
    worker.postMessage("quit");
    worker.terminate();
  }
}
