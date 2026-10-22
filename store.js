'use strict';
// Player storage for ranked play.
// With DATABASE_URL set (a Neon Postgres connection string) players are kept in Neon, talked to over
// Neon's HTTPS SQL endpoint, so no database driver is needed. Without it they go in a local JSON file,
// which is fine for testing but is wiped whenever Render restarts the free server.
const fs = require('fs');
const path = require('path');
const https = require('https');

const URL_ = process.env.DATABASE_URL || '';
const FILE = process.env.LOOPBALL_DATA || path.join(__dirname, 'data', 'players.json');

function neonTarget(conn) {
  const u = new URL(conn);
  return { host: u.hostname.replace(/^[^.]+\./, 'api.'), conn };
}

function neonQuery(t, query, params) {
  const body = JSON.stringify({ query, params: params || [] });
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: t.host, path: '/sql', method: 'POST', timeout: 20000,
      headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
        'Neon-Connection-String': t.conn, 'Neon-Raw-Text-Output': 'true', 'Neon-Array-Mode': 'true'
      }
    }, res => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => { d += c; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch {}
        if (res.statusCode !== 200) return reject(new Error('Neon ' + res.statusCode + ': ' + ((j && j.message) || d.slice(0, 200))));
        resolve(j || { rows: [] });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Neon request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

function createStore() {
  const players = new Map();   // pid -> record
  const dirty = new Set();
  let kind = 'memory', neon = null, flushing = false, timer = null, lastErr = '';

  async function load() {
    if (URL_) {
      try {
        neon = neonTarget(URL_);
        await neonQuery(neon, 'CREATE TABLE IF NOT EXISTS players (pid text PRIMARY KEY, data jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())');
        const r = await neonQuery(neon, 'SELECT pid, data FROM players');
        for (const row of r.rows || []) { try { players.set(row[0], JSON.parse(row[1])); } catch {} }
        kind = 'neon';
        console.log('Ranked storage: Neon (' + players.size + ' players)');
        return;
      } catch (e) {
        lastErr = String(e.message || e);
        console.error('Could not reach Neon, falling back to a local file:', lastErr);
        neon = null;
      }
    }
    try {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      for (const k of Object.keys(j)) players.set(k, j[k]);
    } catch {}
    kind = 'file';
    console.log('Ranked storage: local file (' + players.size + ' players). Set DATABASE_URL to keep ranks across restarts.');
  }

  async function flush() {
    if (flushing || !dirty.size) return;
    flushing = true;
    const ids = [...dirty]; dirty.clear();
    try {
      if (kind === 'neon') {
        // one statement per batch of up to 50 players
        for (let i = 0; i < ids.length; i += 50) {
          const part = ids.slice(i, i + 50).filter(id => players.has(id));
          if (!part.length) continue;
          const vals = [], params = [];
          part.forEach((id, k) => { vals.push(`($${k * 2 + 1}, $${k * 2 + 2}::jsonb, now())`); params.push(id, JSON.stringify(players.get(id))); });
          await neonQuery(neon, 'INSERT INTO players (pid, data, updated) VALUES ' + vals.join(',') +
            ' ON CONFLICT (pid) DO UPDATE SET data = EXCLUDED.data, updated = now()', params);
        }
      } else if (kind === 'file') {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        const tmp = FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(players)));
        fs.renameSync(tmp, FILE);
      }
      lastErr = '';
    } catch (e) {
      lastErr = String(e.message || e);
      console.error('Saving players failed, will retry:', lastErr);
      for (const id of ids) dirty.add(id);
    } finally { flushing = false; }
  }

  return {
    load,
    get: pid => players.get(pid),
    all: () => players.values(),
    entries: () => players.entries(),
    size: () => players.size,
    put(pid, rec) { players.set(pid, rec); dirty.add(pid); if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 3000); },
    flush,
    info: () => ({ kind, players: players.size, pending: dirty.size, error: lastErr || undefined })
  };
}

module.exports = { createStore };
