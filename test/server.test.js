const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAppServer } = require('../server');

async function withTestServer(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ttt-test-'));
  const statsFile = path.join(tmpDir, 'stats.json');
  const server = createAppServer({ statsFile });

  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\ttt-test-${crypto.randomUUID()}`
      : path.join(tmpDir, 'server.sock');

  await new Promise((resolve) => server.listen(socketPath, resolve));

  function request(urlPath, { method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const req = http.request(
        {
          socketPath,
          path: urlPath,
          method,
          headers: payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {},
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text,
              json: () => JSON.parse(text),
            });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    await fn(request);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test('Servidor entrega index.html e arquivos estáticos', async () => {
  await withTestServer(async (request) => {
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /text\/html/);
    assert.match(res.text, /Tic-Tac-Toe/);

    const jsRes = await request('/app.js');
    assert.equal(jsRes.status, 200);
    assert.match(jsRes.headers['content-type'] || '', /javascript/);
  });
});

test('API conduz partida completa de 2 jogadores e grava estatísticas', async () => {
  await withTestServer(async (request) => {
    const createRes = await request('/api/games', {
      method: 'POST',
      body: { mode: 'pvp', startingMark: 'X' },
    });
    assert.equal(createRes.status, 201);
    const { game } = createRes.json();
    assert.ok(game.id);

    // X: 0, O: 3, X: 1, O: 4, X: 2 (X vence)
    const moves = [0, 3, 1, 4, 2];
    let lastPayload = null;

    for (const index of moves) {
      const moveRes = await request(`/api/games/${game.id}/move`, {
        method: 'POST',
        body: { index },
      });
      assert.equal(moveRes.status, 200);
      lastPayload = moveRes.json();
    }

    assert.equal(lastPayload.game.status, 'win');
    assert.equal(lastPayload.game.winner, 'X');
    assert.equal(lastPayload.stats.pvp.xWins, 1);
    assert.equal(lastPayload.stats.history.length, 1);

    // Zerar estatísticas
    const delRes = await request('/api/stats', { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    const resetStats = delRes.json();
    assert.equal(resetStats.pvp.xWins, 0);
    assert.equal(resetStats.history.length, 0);
  });
});

test('API responde com jogada da IA ao jogar no modo ai', async () => {
  await withTestServer(async (request) => {
    const createRes = await request('/api/games', {
      method: 'POST',
      body: {
        mode: 'ai',
        difficulty: 'hard',
        playerMark: 'X',
        startingMark: 'X',
      },
    });
    const { game } = createRes.json();

    const moveRes = await request(`/api/games/${game.id}/move`, {
      method: 'POST',
      body: { index: 4 },
    });
    assert.equal(moveRes.status, 200);
    const payload = moveRes.json();

    assert.equal(payload.playerMove.index, 4);
    assert.ok(payload.aiMove);
    assert.equal(payload.aiMove.mark, 'O');
    assert.notEqual(payload.aiMove.index, 4);
  });
});
