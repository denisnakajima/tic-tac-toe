const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateBoard,
  chooseAiMove,
  createGameSession,
  applyPlayerMove,
  getAvailableMoves,
} = require('../lib/game');

test('evaluateBoard detecta vitória em linhas, colunas e diagonais', () => {
  const rowWin = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
  assert.deepEqual(evaluateBoard(rowWin), {
    status: 'win',
    winner: 'X',
    winningLine: [0, 1, 2],
  });

  const diagWin = ['O', 'X', 'X', null, 'O', null, null, 'X', 'O'];
  assert.deepEqual(evaluateBoard(diagWin), {
    status: 'win',
    winner: 'O',
    winningLine: [0, 4, 8],
  });
});

test('evaluateBoard detecta empate quando o tabuleiro está cheio sem vencedor', () => {
  const drawBoard = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  assert.deepEqual(evaluateBoard(drawBoard), {
    status: 'draw',
    winner: null,
    winningLine: null,
  });
});

test('IA Imbatível (Minimax) finaliza vitória imediata e bloqueia ameaça imediata', () => {
  // IA joga com O e pode vencer na casa 2
  const canWinBoard = ['O', 'O', null, 'X', 'X', null, null, null, 'X'];
  assert.equal(chooseAiMove(canWinBoard, 'O', 'hard'), 2);

  // IA joga com O e precisa bloquear X na casa 8
  const mustBlockBoard = ['X', null, null, null, 'X', null, 'O', null, null];
  assert.equal(chooseAiMove(mustBlockBoard, 'O', 'hard'), 8);
});

test('IA Imbatível (Minimax) nunca perde contra todas as sequências possíveis', () => {
  // Simula exaustivamente todas as partidas onde Humano = X e IA = O (com rng determinístico)
  const fixedRng = () => 0;

  function playAllBranches(board, turn) {
    const evalResult = evaluateBoard(board);
    if (evalResult.status !== 'playing') {
      assert.notEqual(evalResult.winner, 'X', `IA perdeu no tabuleiro: ${board.join(',')}`);
      return;
    }

    if (turn === 'X') {
      for (const move of getAvailableMoves(board)) {
        const next = board.slice();
        next[move] = 'X';
        playAllBranches(next, 'O');
      }
    } else {
      const aiIndex = chooseAiMove(board, 'O', 'hard', fixedRng);
      const next = board.slice();
      next[aiIndex] = 'O';
      playAllBranches(next, 'X');
    }
  }

  playAllBranches(Array(9).fill(null), 'X');
});

test('Sessão PvP alterna turnos e rejeita jogadas inválidas', () => {
  const session = createGameSession({ mode: 'pvp', startingMark: 'X' });
  assert.equal(session.turn, 'X');

  applyPlayerMove(session, 0); // X
  assert.equal(session.turn, 'O');

  assert.throws(() => applyPlayerMove(session, 0), /ocupada/);
  assert.throws(() => applyPlayerMove(session, 12), /Posição inválida/);

  applyPlayerMove(session, 3); // O
  applyPlayerMove(session, 1); // X
  applyPlayerMove(session, 4); // O
  applyPlayerMove(session, 2); // X vence na linha [0,1,2]

  assert.equal(session.status, 'win');
  assert.equal(session.winner, 'X');
  assert.deepEqual(session.winningLine, [0, 1, 2]);
  assert.throws(() => applyPlayerMove(session, 5), /encerrada/);
});

test('Sessão IA faz a primeira jogada automaticamente quando humano escolhe O', () => {
  const session = createGameSession({
    mode: 'ai',
    difficulty: 'hard',
    playerMark: 'O',
    startingMark: 'X',
  });

  assert.equal(session.moves.length, 1);
  assert.equal(session.moves[0].mark, 'X');
  assert.equal(session.turn, 'O');
});
