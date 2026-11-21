const crypto = require('node:crypto');

const WINNING_LINES = [
  [0, 1, 2], // Linhas
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6], // Colunas
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8], // Diagonais
  [2, 4, 6],
];

const VALID_MODES = new Set(['pvp', 'ai']);
const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const VALID_MARKS = new Set(['X', 'O']);

function getOpponent(mark) {
  return mark === 'X' ? 'O' : 'X';
}

function getAvailableMoves(board) {
  const moves = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === null) moves.push(i);
  }
  return moves;
}

function evaluateBoard(board) {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return {
        status: 'win',
        winner: board[a],
        winningLine: line,
      };
    }
  }

  if (board.every((cell) => cell !== null)) {
    return {
      status: 'draw',
      winner: null,
      winningLine: null,
    };
  }

  return {
    status: 'playing',
    winner: null,
    winningLine: null,
  };
}

function findImmediateWinningMove(board, mark) {
  for (const [a, b, c] of WINNING_LINES) {
    const cells = [board[a], board[b], board[c]];
    const markCount = cells.filter((v) => v === mark).length;
    const nullCount = cells.filter((v) => v === null).length;
    if (markCount === 2 && nullCount === 1) {
      if (board[a] === null) return a;
      if (board[b] === null) return b;
      return c;
    }
  }
  return null;
}

function minimax(board, currentMark, aiMark, depth, alpha, beta) {
  const evaluation = evaluateBoard(board);
  if (evaluation.status === 'win') {
    return evaluation.winner === aiMark ? 10 - depth : depth - 10;
  }
  if (evaluation.status === 'draw') {
    return 0;
  }

  const nextMark = getOpponent(currentMark);
  const isMaximizing = currentMark === aiMark;

  if (isMaximizing) {
    let bestScore = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] !== null) continue;
      board[i] = currentMark;
      const score = minimax(board, nextMark, aiMark, depth + 1, alpha, beta);
      board[i] = null;
      if (score > bestScore) bestScore = score;
      if (score > alpha) alpha = score;
      if (beta <= alpha) break;
    }
    return bestScore;
  } else {
    let bestScore = Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] !== null) continue;
      board[i] = currentMark;
      const score = minimax(board, nextMark, aiMark, depth + 1, alpha, beta);
      board[i] = null;
      if (score < bestScore) bestScore = score;
      if (score < beta) beta = score;
      if (beta <= alpha) break;
    }
    return bestScore;
  }
}

function chooseBestMinimaxMove(board, aiMark, rng = Math.random) {
  const available = getAvailableMoves(board);
  if (available.length === 0) return null;

  // Otimização rápida para tabuleiro vazio: cantos e centro são ótimos
  if (available.length === 9) {
    const openings = [0, 2, 4, 6, 8];
    return openings[Math.floor(rng() * openings.length)];
  }

  const opponentMark = getOpponent(aiMark);
  let bestScore = -Infinity;
  let bestMoves = [];

  const scratch = board.slice();
  for (const move of available) {
    scratch[move] = aiMark;
    const score = minimax(scratch, opponentMark, aiMark, 0, -Infinity, Infinity);
    scratch[move] = null;

    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }

  return bestMoves[Math.floor(rng() * bestMoves.length)];
}

function chooseAiMove(board, aiMark, difficulty = 'hard', rng = Math.random) {
  const available = getAvailableMoves(board);
  if (available.length === 0) return null;

  const normalizedDifficulty = VALID_DIFFICULTIES.has(difficulty) ? difficulty : 'hard';
  const humanMark = getOpponent(aiMark);

  if (normalizedDifficulty === 'easy') {
    return available[Math.floor(rng() * available.length)];
  }

  if (normalizedDifficulty === 'medium') {
    // 1. Ganha imediatamente se tiver oportunidade
    const winMove = findImmediateWinningMove(board, aiMark);
    if (winMove !== null) return winMove;

    // 2. Bloqueia vitória imediata do oponente (80% de atenção)
    const blockMove = findImmediateWinningMove(board, humanMark);
    if (blockMove !== null && rng() < 0.8) return blockMove;

    // 3. Mistura jogada ótima com jogada casual
    if (rng() < 0.45) {
      return chooseBestMinimaxMove(board, aiMark, rng);
    }
    return available[Math.floor(rng() * available.length)];
  }

  // hard (Minimax Imbatível)
  return chooseBestMinimaxMove(board, aiMark, rng);
}

function createGameSession(options = {}) {
  const mode = VALID_MODES.has(options.mode) ? options.mode : 'ai';
  const difficulty = VALID_DIFFICULTIES.has(options.difficulty) ? options.difficulty : 'hard';
  const playerMark = VALID_MARKS.has(options.playerMark) ? options.playerMark : 'X';
  const startingMark = VALID_MARKS.has(options.startingMark) ? options.startingMark : 'X';

  const aiMark = mode === 'ai' ? getOpponent(playerMark) : null;
  const board = Array(9).fill(null);

  const session = {
    id: crypto.randomUUID(),
    mode,
    difficulty: mode === 'ai' ? difficulty : null,
    playerMark,
    aiMark,
    board,
    turn: startingMark,
    status: 'playing',
    winner: null,
    winningLine: null,
    moves: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Se for modo IA e a IA começar a partida, faz a primeira jogada
  if (mode === 'ai' && session.turn === aiMark) {
    const openingIndex = chooseAiMove(session.board, aiMark, difficulty);
    if (openingIndex !== null) {
      session.board[openingIndex] = aiMark;
      session.moves.push({ index: openingIndex, mark: aiMark, actor: 'ai' });
      session.turn = playerMark;
      session.updatedAt = new Date().toISOString();
    }
  }

  return session;
}

function applyPlayerMove(session, rawIndex) {
  if (!session || typeof session !== 'object') {
    throw new Error('Sessão de jogo inválida.');
  }

  if (session.status !== 'playing') {
    const err = new Error('A partida já foi encerrada.');
    err.statusCode = 409;
    throw err;
  }

  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    const err = new Error('Posição inválida. Escolha uma célula entre 0 e 8.');
    err.statusCode = 400;
    throw err;
  }

  if (session.board[index] !== null) {
    const err = new Error('Esta célula já está ocupada.');
    err.statusCode = 409;
    throw err;
  }

  const currentMark = session.turn;
  session.board[index] = currentMark;
  const playerMove = {
    index,
    mark: currentMark,
    actor: session.mode === 'ai' ? 'human' : `player-${currentMark}`,
  };
  session.moves.push(playerMove);

  let evaluation = evaluateBoard(session.board);
  session.status = evaluation.status;
  session.winner = evaluation.winner;
  session.winningLine = evaluation.winningLine;

  let aiMove = null;

  if (session.status === 'playing') {
    session.turn = getOpponent(currentMark);

    if (session.mode === 'ai' && session.turn === session.aiMark) {
      const aiIndex = chooseAiMove(session.board, session.aiMark, session.difficulty);
      if (aiIndex !== null) {
        session.board[aiIndex] = session.aiMark;
        aiMove = {
          index: aiIndex,
          mark: session.aiMark,
          actor: 'ai',
        };
        session.moves.push(aiMove);

        evaluation = evaluateBoard(session.board);
        session.status = evaluation.status;
        session.winner = evaluation.winner;
        session.winningLine = evaluation.winningLine;

        if (session.status === 'playing') {
          session.turn = session.playerMark;
        }
      }
    }
  }

  session.updatedAt = new Date().toISOString();

  return {
    game: session,
    playerMove,
    aiMove,
  };
}

module.exports = {
  WINNING_LINES,
  getOpponent,
  getAvailableMoves,
  evaluateBoard,
  findImmediateWinningMove,
  chooseAiMove,
  chooseBestMinimaxMove,
  createGameSession,
  applyPlayerMove,
};
