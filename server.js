const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createGameSession, applyPlayerMove } = require('./lib/game');

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_STATS_FILE = path.join(__dirname, 'data', 'stats.json');
const MAX_SESSIONS = 500;
const MAX_HISTORY = 15;
const MAX_BODY_BYTES = 16 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function createEmptyStats() {
  return {
    pvp: {
      xWins: 0,
      oWins: 0,
      draws: 0,
      total: 0,
    },
    ai: {
      playerWins: 0,
      aiWins: 0,
      draws: 0,
      total: 0,
    },
    history: [],
  };
}

function createStatsStore(statsFile = DEFAULT_STATS_FILE) {
  let writeQueue = Promise.resolve();

  async function ensureFile() {
    const dir = path.dirname(statsFile);
    await fsp.mkdir(dir, { recursive: true });
    if (!fs.existsSync(statsFile)) {
      await fsp.writeFile(statsFile, JSON.stringify(createEmptyStats(), null, 2), 'utf8');
    }
  }

  async function readStats() {
    await ensureFile();
    try {
      const raw = await fsp.readFile(statsFile, 'utf8');
      const parsed = JSON.parse(raw);
      const base = createEmptyStats();
      return {
        pvp: { ...base.pvp, ...(parsed.pvp || {}) },
        ai: { ...base.ai, ...(parsed.ai || {}) },
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, MAX_HISTORY) : [],
      };
    } catch {
      return createEmptyStats();
    }
  }

  function recordMatch(session) {
    writeQueue = writeQueue.then(async () => {
      const stats = await readStats();
      let resultLabel = 'Empate';

      if (session.mode === 'pvp') {
        stats.pvp.total += 1;
        if (session.status === 'draw') {
          stats.pvp.draws += 1;
        } else if (session.winner === 'X') {
          stats.pvp.xWins += 1;
          resultLabel = 'Vitória de X';
        } else if (session.winner === 'O') {
          stats.pvp.oWins += 1;
          resultLabel = 'Vitória de O';
        }
      } else {
        stats.ai.total += 1;
        if (session.status === 'draw') {
          stats.ai.draws += 1;
        } else if (session.winner === session.playerMark) {
          stats.ai.playerWins += 1;
          resultLabel = `Você venceu (${session.playerMark})`;
        } else {
          stats.ai.aiWins += 1;
          resultLabel = `IA venceu (${session.aiMark})`;
        }
      }

      stats.history.unshift({
        id: session.id,
        mode: session.mode,
        difficulty: session.difficulty,
        result: resultLabel,
        winner: session.winner,
        movesCount: session.moves.length,
        finishedAt: new Date().toISOString(),
      });
      stats.history = stats.history.slice(0, MAX_HISTORY);

      await fsp.writeFile(statsFile, JSON.stringify(stats, null, 2), 'utf8');
      return stats;
    });

    return writeQueue;
  }

  function resetStats() {
    writeQueue = writeQueue.then(async () => {
      await ensureFile();
      const empty = createEmptyStats();
      await fsp.writeFile(statsFile, JSON.stringify(empty, null, 2), 'utf8');
      return empty;
    });

    return writeQueue;
  }

  return {
    readStats,
    recordMatch,
    resetStats,
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        const err = new Error('Payload muito grande.');
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      raw += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('JSON inválido.');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', reject);
  });
}

async function serveStaticFile(reqPath, res) {
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  const decodedPath = decodeURIComponent(cleanPath);
  const resolvedPath = path.normalize(path.join(PUBLIC_DIR, decodedPath));

  const relative = path.relative(PUBLIC_DIR, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendJson(res, 403, { error: 'Acesso negado.' });
    return;
  }

  try {
    const stat = await fsp.stat(resolvedPath);
    if (!stat.isFile()) {
      sendJson(res, 404, { error: 'Arquivo não encontrado.' });
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fsp.readFile(resolvedPath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Arquivo não encontrado.' });
  }
}

function createAppServer(options = {}) {
  const statsStore = createStatsStore(options.statsFile || DEFAULT_STATS_FILE);
  const sessions = new Map();

  function saveSession(session) {
    if (sessions.size >= MAX_SESSIONS && !sessions.has(session.id)) {
      const oldestKey = sessions.keys().next().value;
      sessions.delete(oldestKey);
    }
    sessions.set(session.id, session);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      // API: Estatísticas gerais
      if (pathname === '/api/stats' && req.method === 'GET') {
        const stats = await statsStore.readStats();
        sendJson(res, 200, stats);
        return;
      }

      if (pathname === '/api/stats' && req.method === 'DELETE') {
        const stats = await statsStore.resetStats();
        sendJson(res, 200, stats);
        return;
      }

      // API: Criar nova partida
      if (pathname === '/api/games' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const session = createGameSession({
          mode: body.mode,
          difficulty: body.difficulty,
          playerMark: body.playerMark,
          startingMark: body.startingMark,
        });
        saveSession(session);
        sendJson(res, 201, { game: session });
        return;
      }

      // API: Consultar partida existente
      const gameMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9-]+)$/);
      if (gameMatch && req.method === 'GET') {
        const session = sessions.get(gameMatch[1]);
        if (!session) {
          sendJson(res, 404, { error: 'Partida não encontrada.' });
          return;
        }
        sendJson(res, 200, { game: session });
        return;
      }

      // API: Realizar jogada
      const moveMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9-]+)\/move$/);
      if (moveMatch && req.method === 'POST') {
        const session = sessions.get(moveMatch[1]);
        if (!session) {
          sendJson(res, 404, { error: 'Partida não encontrada.' });
          return;
        }

        const body = await readJsonBody(req);
        const result = applyPlayerMove(session, body.index);

        let stats = null;
        if (result.game.status !== 'playing') {
          stats = await statsStore.recordMatch(result.game);
        }

        sendJson(res, 200, {
          game: result.game,
          playerMove: result.playerMove,
          aiMove: result.aiMove,
          stats,
        });
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Rota da API não encontrada.' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Método não permitido.' });
        return;
      }

      await serveStaticFile(pathname, res);
    } catch (err) {
      const statusCode = err.statusCode || 500;
      sendJson(res, statusCode, {
        error: err.message || 'Erro interno no servidor.',
      });
    }
  });

  return server;
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(DEFAULT_PORT, () => {
    console.log(`🎮 Tic-Tac-Toe rodando em http://localhost:${DEFAULT_PORT}`);
  });
}

module.exports = {
  createAppServer,
  createStatsStore,
};
