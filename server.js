'use strict';
// Loopball game server: serves the website (main page, /2d, /3d) and relays online matches.
// No dependencies. Run with: node server.js   (PORT env var is respected)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createStore } = require('./store.js');
const { createRanked } = require('./ranked.js');

const PORT = Number(process.env.PORT) || 3000;
// Testing aid only: SIM_LAG_MS adds that much delay each way to every message (leave unset in production).
const SIM_LAG = Math.max(0, Number(process.env.SIM_LAG_MS) || 0);
const later = fn => SIM_LAG ? setTimeout(fn, SIM_LAG) : fn();
const PUB = path.join(__dirname, 'public');
const MAX_MSG = 16 * 1024;      // biggest message a player may send
const MAX_PRES = 4096;          // biggest presence object per player per room
const MAX_ROOM = 24;            // players per match room
const MAX_ROOMS_PER_PLAYER = 17;
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain'
};

/* ---------- static files ---------- */
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  // which game a match code belongs to (2D rooms are "lb-", 3D rooms are "l3-")
  const cm = /^\/api\/code\/([a-z]{5})$/.exec(p.toLowerCase());
  if (cm) {
    const has = n => { const s = rooms.get(n); return !!(s && s.size); };
    const game = has('lb-' + cm[1]) ? '2d' : has('l3-' + cm[1]) ? '3d' : null;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ game }));
  }
  if (p === '/api/stats') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    const rs = ranked ? ranked.stats() : null;
    return res.end(JSON.stringify({ online: byId.size, queues: rs ? rs.queues : {}, live: rs ? rs.live : 0 }));
  }
  if (p === '/api/leaderboard') {
    const q = new URL(req.url, 'http://x').searchParams;
    const game = q.get('g') === '3d' ? '3d' : '2d', md = [1, 2, 3].includes(+q.get('m')) ? +q.get('m') : 1;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(ranked ? ranked.leaderboard(game, md) : { game, md, total: 0, rows: [] }));
  }
  if (p === '/api/me' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      let j = null; try { j = JSON.parse(body); } catch {}
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(j && ranked ? ranked.profile(j.pid, j.key) : { error: 'bad' }));
    });
    return;
  }
  if (p === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(Object.assign({ online: byId.size }, ranked ? ranked.stats() : {})));
  }
  if (p === '/2d' || p === '/3d') { res.writeHead(301, { location: p + '/' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '') }); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(PUB, path.normalize(p));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': (ext === '.html' || p === '/sw.js' || p === '/manifest.webmanifest') ? 'no-cache' : 'public, max-age=86400',
      'x-content-type-options': 'nosniff'
    });
    res.end(data);
  });
});

/* ---------- minimal WebSocket (RFC 6455) ---------- */
server.on('upgrade', (req, socket) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch {}
  const key = req.headers['sec-websocket-key'];
  if (pathname !== '/ws' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  makeConn(socket);
});

function frame(op, payload) {
  const n = payload.length; let h;
  if (n < 126) h = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, payload]);
}

function makeConn(socket) {
  const c = {
    socket, buf: Buffer.alloc(0), frag: null, alive: true, closed: false,
    id: null, rooms: new Map(), tokens: 120, lastFill: Date.now(),
    send(str) { const f = frame(1, Buffer.from(str)); later(() => { if (!c.closed && !socket.destroyed) socket.write(f); }); },
    close() {
      if (c.closed) return; c.closed = true;
      try { socket.end(frame(8, Buffer.alloc(0))); } catch {}
      onClose(c);
    }
  };
  socket.on('data', d => {
    c.alive = true;
    c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d;
    if (c.buf.length > MAX_MSG * 4) { c.close(); return; }
    parse(c);
  });
  socket.on('close', () => { if (!c.closed) { c.closed = true; onClose(c); } });
  socket.on('error', () => {});
  all.add(c);
}

function parse(c) {
  for (;;) {
    const b = c.buf;
    if (b.length < 2) return;
    const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) { c.close(); return; } len = Number(big); off = 10; }
    if (!masked || len > MAX_MSG) { c.close(); return; }
    if (b.length < off + 4 + len) return;
    const mask = b.subarray(off, off + 4); off += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
    c.buf = Buffer.from(b.subarray(off + len));
    if (op === 8) { c.close(); return; }
    if (op === 9) { if (!c.socket.destroyed) c.socket.write(frame(10, payload.subarray(0, 125))); continue; }
    if (op === 10) { c.alive = true; continue; }
    if (op === 1 || op === 2) c.frag = [payload];
    else if (op === 0 && c.frag) c.frag.push(payload);
    else { c.close(); return; }
    if (fin) {
      const msg = Buffer.concat(c.frag).toString('utf8'); c.frag = null;
      if (msg.length > MAX_MSG) { c.close(); return; }
      later(() => { if (!c.closed) onMessage(c, msg); });
    }
  }
}

/* ---------- rooms + presence ---------- */
const all = new Set();
const byId = new Map();
const rooms = new Map(); // name -> Set(conn); '' is the lobby everyone joins

function onMessage(c, raw) {
  const now = Date.now();
  c.tokens = Math.min(120, c.tokens + (now - c.lastFill) * 0.08); c.lastFill = now; // ~80 msgs/s sustained
  if (c.tokens < 1) return;
  c.tokens -= 1;
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object') return;

  if (!c.id) {
    if (m.t !== 'hello') return;
    const want = typeof m.resume === 'string' && /^[0-9a-f]{16}$/.test(m.resume) && !byId.has(m.resume) ? m.resume : null;
    c.id = want || crypto.randomBytes(8).toString('hex');
    byId.set(c.id, c);
    c.send(JSON.stringify({ t: 'welcome', peer: c.id }));
    joinRoom(c, '');
    return;
  }
  if (m.t === 'join') {
    if (typeof m.room === 'string' && ROOM_RE.test(m.room) && c.rooms.size < MAX_ROOMS_PER_PLAYER) joinRoom(c, m.room);
  } else if (m.t === 'leave') {
    if (typeof m.room === 'string' && m.room !== '') leaveRoom(c, m.room);
  } else if (m.t === 'pres') {
    setPresence(c, typeof m.room === 'string' ? m.room : '', m.p, MAX_PRES);
  } else if ((m.t === 'rq' || m.t === 'rx') && ranked) {
    ranked.onMessage(c, m);
  }
}

function setPresence(c, room, p, limit) {
  const cur0 = c.rooms.get(room);
  if (!cur0 || !p || typeof p !== 'object' || Array.isArray(p)) return;
  const cur = Object.assign({}, cur0);
  for (const k of Object.keys(p)) {
    if (!KEY_RE.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (p[k] === null) delete cur[k]; else cur[k] = p[k];
  }
  const s = JSON.stringify(cur);
  if (s.length > limit) return;
  c.rooms.set(room, cur);
  broadcast(room, '{"t":"pres","room":' + JSON.stringify(room) + ',"peer":"' + c.id + '","p":' + s + '}', c);
}

/* ---------- ranked: the server joins match rooms as the host ---------- */
const relay = {
  virtualPeer(id) {
    return { id, virtual: true, closed: false, rooms: new Map(), socket: { destroyed: false, write() {} }, send() {} };
  },
  join(c, room) { joinRoom(c, room); },
  leave(c, room) { leaveRoom(c, room); },
  presence(c, room, patch) { setPresence(c, room, patch, 64 * 1024); },
  peersIn(room) { const out = new Map(); const set = rooms.get(room); if (set) for (const x of set) out.set(x.id, x.rooms.get(room) || {}); return out; },
  sendTo(peer, obj) { const c = byId.get(peer); if (c && !c.closed) c.send(JSON.stringify(obj)); },
  roomExists(name) { return rooms.has(name); }
};
const store = createStore();
let ranked = null;
try { ranked = createRanked({ relay, store, publicDir: PUB }); } catch (e) { console.error('Ranked play is off:', e); }

function joinRoom(c, name) {
  let set = rooms.get(name);
  if (!set) { set = new Set(); rooms.set(name, set); }
  if (!set.has(c)) {
    if (name !== '' && set.size >= MAX_ROOM) { c.send(JSON.stringify({ t: 'full', room: name })); return; }
    set.add(c); c.rooms.set(name, {});
    broadcast(name, JSON.stringify({ t: 'pres', room: name, peer: c.id, p: {} }), c);
  }
  c.send(JSON.stringify({ t: 'peers', room: name, list: [...set].map(x => ({ peer: x.id, p: x.rooms.get(name) || {} })) }));
}

function leaveRoom(c, name) {
  const set = rooms.get(name);
  c.rooms.delete(name);
  if (!set || !set.delete(c)) return;
  if (!set.size) rooms.delete(name);
  else broadcast(name, JSON.stringify({ t: 'left', room: name, peer: c.id }), null);
}

function broadcast(name, str, except) {
  const set = rooms.get(name); if (!set) return;
  const f = frame(1, Buffer.from(str));
  const targets = [...set].filter(x => x !== except);
  later(() => { for (const x of targets) if (!x.closed && !x.socket.destroyed) x.socket.write(f); });
}

function onClose(c) {
  all.delete(c);
  if (ranked) ranked.onClose(c);
  if (!c.id) return;
  for (const name of [...c.rooms.keys()]) leaveRoom(c, name);
  if (byId.get(c.id) === c) byId.delete(c.id);
}

// Drop dead connections
setInterval(() => {
  for (const c of all) {
    if (!c.alive) { try { c.socket.destroy(); } catch {} if (!c.closed) { c.closed = true; onClose(c); } continue; }
    c.alive = false;
    try { c.socket.write(frame(9, Buffer.alloc(0))); } catch {}
  }
}, 25000).unref();

store.load().finally(() => server.listen(PORT, () => console.log('Loopball running on http://localhost:' + PORT)));
// Render stops the old server on every deploy: save anything pending first
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { store.flush().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); });
