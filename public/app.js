(() => {
  // Coordenadas dos centros das 9 células no viewBox 300x300 (considerando gap proporcional)
  const CELL_CENTERS = [
    { x: 46, y: 46 },   { x: 150, y: 46 },  { x: 254, y: 46 },
    { x: 46, y: 150 },  { x: 150, y: 150 }, { x: 254, y: 150 },
    { x: 46, y: 254 },  { x: 150, y: 254 }, { x: 254, y: 254 },
  ];

  const DIFFICULTY_LABELS = {
    easy: 'Fácil',
    medium: 'Médio',
    hard: 'Imbatível',
  };

  const state = {
    mode: 'ai',          // 'ai' | 'pvp'
    difficulty: 'hard',  // 'easy' | 'medium' | 'hard'
    playerMark: 'X',     // 'X' | 'O' (usado no modo IA)
    pvpStarter: 'X',     // Alterna quem começa no modo 2 jogadores
    game: null,
    sessionScore: { X: 0, O: 0, draw: 0 },
    isBusy: false,
    soundEnabled: true,
    requestSeq: 0,
  };

  // Elementos do DOM
  const boardEl = document.getElementById('board');
  const cellEls = Array.from(boardEl.querySelectorAll('.cell'));
  const aiOptionsEl = document.getElementById('aiOptions');
  const modeBtns = Array.from(document.querySelectorAll('[data-mode]'));
  const difficultyBtns = Array.from(document.querySelectorAll('[data-difficulty]'));
  const markBtns = Array.from(document.querySelectorAll('[data-mark]'));

  const scoreCardX = document.getElementById('scoreCardX');
  const scoreCardO = document.getElementById('scoreCardO');
  const labelX = document.getElementById('labelX');
  const labelO = document.getElementById('labelO');
  const scoreXEl = document.getElementById('scoreX');
  const scoreOEl = document.getElementById('scoreO');
  const scoreDrawEl = document.getElementById('scoreDraw');

  const statusBanner = document.getElementById('statusBanner');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  const winLineSvg = document.getElementById('winLineSvg');
  const winLine = document.getElementById('winLine');
  const newGameBtn = document.getElementById('newGameBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const soundIcon = document.getElementById('soundIcon');
  const soundLabel = document.getElementById('soundLabel');

  const statAiPlayerWins = document.getElementById('statAiPlayerWins');
  const statAiDraws = document.getElementById('statAiDraws');
  const statAiCpuWins = document.getElementById('statAiCpuWins');
  const statPvpXWins = document.getElementById('statPvpXWins');
  const statPvpDraws = document.getElementById('statPvpDraws');
  const statPvpOWins = document.getElementById('statPvpOWins');
  const historyList = document.getElementById('historyList');
  const resetStatsBtn = document.getElementById('resetStatsBtn');

  // Efeitos sonoros via Web Audio API (sem arquivos externos)
  let audioCtx = null;

  function playTone(freq, duration = 0.09, type = 'sine', delay = 0, gainVal = 0.08) {
    if (!state.soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const startAt = audioCtx.currentTime + delay;

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startAt);

      gain.gain.setValueAtTime(gainVal, startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration);
    } catch {
      // Ignora bloqueios de autoplay do navegador
    }
  }

  function playMoveSound(mark) {
    if (mark === 'X') {
      playTone(520, 0.08, 'triangle', 0, 0.07);
    } else {
      playTone(390, 0.09, 'sine', 0, 0.08);
    }
  }

  function playEndSound(status, isPlayerLoss = false) {
    if (status === 'win') {
      if (isPlayerLoss) {
        playTone(360, 0.14, 'sawtooth', 0, 0.05);
        playTone(270, 0.22, 'sawtooth', 0.12, 0.05);
      } else {
        playTone(523.25, 0.11, 'triangle', 0, 0.08);
        playTone(659.25, 0.11, 'triangle', 0.1, 0.08);
        playTone(783.99, 0.22, 'triangle', 0.2, 0.09);
      }
    } else if (status === 'draw') {
      playTone(440, 0.12, 'sine', 0, 0.06);
      playTone(392, 0.18, 'sine', 0.12, 0.06);
    }
  }

  function createMarkMarkup(mark) {
    if (mark === 'X') {
      return `
        <svg class="mark-svg mark-svg-x" viewBox="0 0 100 100" aria-hidden="true">
          <line x1="20" y1="20" x2="80" y2="80" />
          <line x1="80" y1="20" x2="20" y2="80" />
        </svg>
      `;
    }
    return `
      <svg class="mark-svg mark-svg-o" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="33" />
      </svg>
    `;
  }

  function updateScoreboardLabels() {
    if (state.mode === 'ai') {
      if (state.playerMark === 'X') {
        labelX.textContent = 'Você (X)';
        labelO.textContent = 'IA (O)';
      } else {
        labelX.textContent = 'IA (X)';
        labelO.textContent = 'Você (O)';
      }
    } else {
      labelX.textContent = 'Jogador 1 (X)';
      labelO.textContent = 'Jogador 2 (O)';
    }

    scoreXEl.textContent = String(state.sessionScore.X);
    scoreOEl.textContent = String(state.sessionScore.O);
    scoreDrawEl.textContent = String(state.sessionScore.draw);
  }

  function resetCellsUI() {
    cellEls.forEach((cell, idx) => {
      cell.innerHTML = '';
      cell.dataset.mark = '';
      cell.classList.remove('win-cell');
      cell.disabled = false;
      cell.setAttribute(
        'aria-label',
        `Casa ${idx + 1}, linha ${Math.floor(idx / 3) + 1} coluna ${(idx % 3) + 1} vazia`
      );
    });
    winLineSvg.classList.remove('visible');
  }

  function renderBoard(board, winningLine = null, disableAll = false) {
    const winSet = new Set(winningLine || []);

    cellEls.forEach((cell, idx) => {
      const mark = board[idx];
      const currentRendered = cell.dataset.mark || '';

      if (mark && currentRendered !== mark) {
        cell.innerHTML = createMarkMarkup(mark);
        cell.dataset.mark = mark;
        cell.setAttribute(
          'aria-label',
          `Casa ${idx + 1} marcada com ${mark}`
        );
      } else if (!mark && currentRendered) {
        cell.innerHTML = '';
        cell.dataset.mark = '';
      }

      cell.classList.toggle('win-cell', winSet.has(idx));
      cell.disabled = disableAll || Boolean(mark);
    });

    if (winningLine && winningLine.length === 3) {
      const start = CELL_CENTERS[winningLine[0]];
      const end = CELL_CENTERS[winningLine[2]];
      winLine.setAttribute('x1', String(start.x));
      winLine.setAttribute('y1', String(start.y));
      winLine.setAttribute('x2', String(end.x));
      winLine.setAttribute('y2', String(end.y));
      winLineSvg.classList.add('visible');
    } else {
      winLineSvg.classList.remove('visible');
    }
  }

  function updateStatusAndTurnUI(game, customThinking = false) {
    statusBanner.classList.remove('win-banner', 'draw-banner');
    scoreCardX.classList.remove('active-turn');
    scoreCardO.classList.remove('active-turn');

    if (customThinking) {
      const aiMark = state.playerMark === 'X' ? 'O' : 'X';
      boardEl.dataset.turn = '';
      statusDot.className = `status-dot ${aiMark === 'X' ? 'dot-x' : 'dot-o'}`;
      statusText.textContent = `IA (${aiMark}) está calculando a jogada...`;
      if (aiMark === 'X') scoreCardX.classList.add('active-turn');
      else scoreCardO.classList.add('active-turn');
      return;
    }

    if (!game) return;

    if (game.status === 'win') {
      boardEl.dataset.turn = '';
      statusBanner.classList.add('win-banner');
      statusDot.className = 'status-dot dot-win';

      if (game.mode === 'ai') {
        if (game.winner === game.playerMark) {
          statusText.textContent = `🎉 Você venceu com ${game.winner}!`;
        } else {
          statusText.textContent = `🤖 A IA venceu com ${game.winner}!`;
        }
      } else {
        const winnerNum = game.winner === 'X' ? '1' : '2';
        statusText.textContent = `🎉 Jogador ${winnerNum} (${game.winner}) venceu!`;
      }
      return;
    }

    if (game.status === 'draw') {
      boardEl.dataset.turn = '';
      statusBanner.classList.add('draw-banner');
      statusDot.className = 'status-dot dot-draw';
      statusText.textContent = '🤝 Deu velha! Partida empatada.';
      return;
    }

    // Jogo em andamento
    boardEl.dataset.turn = game.turn;
    statusDot.className = `status-dot ${game.turn === 'X' ? 'dot-x' : 'dot-o'}`;

    if (game.turn === 'X') scoreCardX.classList.add('active-turn');
    else scoreCardO.classList.add('active-turn');

    if (game.mode === 'ai') {
      statusText.textContent =
        game.turn === game.playerMark
          ? `Sua vez de jogar (${game.turn})`
          : `Vez da IA (${game.turn})`;
    } else {
      const playerNum = game.turn === 'X' ? '1' : '2';
      statusText.textContent = `Vez do Jogador ${playerNum} (${game.turn})`;
    }
  }

  function renderServerStats(stats) {
    if (!stats) return;

    statAiPlayerWins.textContent = String(stats.ai?.playerWins ?? 0);
    statAiDraws.textContent = String(stats.ai?.draws ?? 0);
    statAiCpuWins.textContent = String(stats.ai?.aiWins ?? 0);

    statPvpXWins.textContent = String(stats.pvp?.xWins ?? 0);
    statPvpDraws.textContent = String(stats.pvp?.draws ?? 0);
    statPvpOWins.textContent = String(stats.pvp?.oWins ?? 0);

    const history = Array.isArray(stats.history) ? stats.history : [];
    if (history.length === 0) {
      historyList.innerHTML = '<li class="history-empty">Nenhuma partida finalizada ainda.</li>';
      return;
    }

    historyList.innerHTML = history
      .map((item) => {
        const badgeText =
          item.mode === 'ai'
            ? `IA · ${DIFFICULTY_LABELS[item.difficulty] || 'Difícil'}`
            : '2 Jogadores';
        const timeStr = new Date(item.finishedAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        });

        return `
          <li class="history-item">
            <div class="history-meta">
              <span class="history-result">${escapeHtml(item.result)}</span>
              <span class="history-sub">${item.movesCount} jogadas · às ${timeStr}</span>
            </div>
            <span class="history-badge">${escapeHtml(badgeText)}</span>
          </li>
        `;
      })
      .join('');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const stats = await res.json();
      renderServerStats(stats);
    } catch {
      // Falha silenciosa caso offline
    }
  }

  async function startNewGame() {
    const seq = ++state.requestSeq;
    state.isBusy = true;
    resetCellsUI();
    updateScoreboardLabels();

    const startingMark = state.mode === 'ai' ? 'X' : state.pvpStarter;

    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: state.mode,
          difficulty: state.difficulty,
          playerMark: state.playerMark,
          startingMark,
        }),
      });

      if (seq !== state.requestSeq) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao iniciar partida');

      state.game = data.game;

      // Se a IA começou jogando (ex.: jogador escolheu O), dá um leve delay visual
      if (state.mode === 'ai' && state.playerMark === 'O' && state.game.moves.length === 1) {
        renderBoard(Array(9).fill(null), null, true);
        updateStatusAndTurnUI(state.game, true);

        setTimeout(() => {
          if (seq !== state.requestSeq) return;
          playMoveSound('X');
          renderBoard(state.game.board, state.game.winningLine, false);
          updateStatusAndTurnUI(state.game, false);
          state.isBusy = false;
        }, 260);
      } else {
        renderBoard(state.game.board, state.game.winningLine, false);
        updateStatusAndTurnUI(state.game, false);
        state.isBusy = false;
      }
    } catch (err) {
      statusText.textContent = err.message || 'Erro de conexão com o servidor.';
      state.isBusy = false;
    }
  }

  function handleMatchEnd(game, stats) {
    if (game.status === 'win') {
      state.sessionScore[game.winner] += 1;
      const isPlayerLoss = game.mode === 'ai' && game.winner !== game.playerMark;
      playEndSound('win', isPlayerLoss);
    } else if (game.status === 'draw') {
      state.sessionScore.draw += 1;
      playEndSound('draw');
    }

    if (state.mode === 'pvp') {
      state.pvpStarter = state.pvpStarter === 'X' ? 'O' : 'X';
    }

    updateScoreboardLabels();
    if (stats) renderServerStats(stats);
  }

  async function handleCellClick(index) {
    if (state.isBusy || !state.game || state.game.status !== 'playing') return;
    if (state.game.board[index] !== null) return;

    const seq = ++state.requestSeq;
    state.isBusy = true;

    const optimisticBoard = state.game.board.slice();
    const actingMark = state.game.turn;
    optimisticBoard[index] = actingMark;

    playMoveSound(actingMark);
    renderBoard(optimisticBoard, null, true);

    if (state.mode === 'ai') {
      updateStatusAndTurnUI(state.game, true);
    }

    try {
      const res = await fetch(`/api/games/${state.game.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });

      if (seq !== state.requestSeq) return;
      const data = await res.json();

      if (!res.ok) {
        // Se a sessão expirou no servidor, inicia outra automaticamente
        if (res.status === 404) {
          await startNewGame();
          return;
        }
        throw new Error(data.error || 'Jogada inválida');
      }

      state.game = data.game;

      if (data.aiMove) {
        setTimeout(() => {
          if (seq !== state.requestSeq) return;
          playMoveSound(data.aiMove.mark);
          const gameEnded = state.game.status !== 'playing';
          renderBoard(state.game.board, state.game.winningLine, gameEnded);
          updateStatusAndTurnUI(state.game, false);

          if (gameEnded) {
            handleMatchEnd(state.game, data.stats);
          }
          state.isBusy = false;
        }, 260);
      } else {
        const gameEnded = state.game.status !== 'playing';
        renderBoard(state.game.board, state.game.winningLine, gameEnded);
        updateStatusAndTurnUI(state.game, false);

        if (gameEnded) {
          handleMatchEnd(state.game, data.stats);
        }
        state.isBusy = false;
      }
    } catch (err) {
      renderBoard(state.game.board, state.game.winningLine, false);
      statusText.textContent = err.message || 'Falha ao enviar jogada.';
      state.isBusy = false;
    }
  }

  function resetSessionScores() {
    state.sessionScore = { X: 0, O: 0, draw: 0 };
    state.pvpStarter = 'X';
    updateScoreboardLabels();
  }

  // Event Listeners
  cellEls.forEach((cell) => {
    cell.addEventListener('click', () => {
      const idx = Number(cell.dataset.index);
      handleCellClick(idx);
    });
  });

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextMode = btn.dataset.mode;
      if (nextMode === state.mode) return;

      state.mode = nextMode;
      modeBtns.forEach((b) => {
        const active = b.dataset.mode === nextMode;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });

      aiOptionsEl.classList.toggle('hidden', state.mode !== 'ai');
      resetSessionScores();
      startNewGame();
    });
  });

  difficultyBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextDiff = btn.dataset.difficulty;
      if (nextDiff === state.difficulty) return;

      state.difficulty = nextDiff;
      difficultyBtns.forEach((b) =>
        b.classList.toggle('active', b.dataset.difficulty === nextDiff)
      );
      startNewGame();
    });
  });

  markBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextMark = btn.dataset.mark;
      if (nextMark === state.playerMark) return;

      state.playerMark = nextMark;
      markBtns.forEach((b) => b.classList.toggle('active', b.dataset.mark === nextMark));
      resetSessionScores();
      startNewGame();
    });
  });

  newGameBtn.addEventListener('click', () => {
    startNewGame();
  });

  soundToggleBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    soundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
    soundLabel.textContent = state.soundEnabled ? 'Som ligado' : 'Som mudo';
  });

  resetStatsBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/stats', { method: 'DELETE' });
      if (!res.ok) return;
      const stats = await res.json();
      renderServerStats(stats);
      resetSessionScores();
    } catch {
      // Ignora erro
    }
  });

  // Atalhos de teclado: 1-9 para células, R para reiniciar
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.key >= '1' && e.key <= '9') {
      const idx = Number(e.key) - 1;
      handleCellClick(idx);
    } else if (e.key === 'r' || e.key === 'R') {
      startNewGame();
    }
  });

  // Inicialização
  fetchStats();
  startNewGame();
})();
