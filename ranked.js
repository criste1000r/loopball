'use strict';
// Ranked play: matchmaking queues, server-run matches (the server is the host, so nobody can fake a result),
// ratings and stats, and the leaderboard. Uses the same game physics as the web pages.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./ranks.js');

const MATCH_SECONDS = Number(process.env.RANKED_SECONDS) || 180;   // override only for testing
const SNAP_HZ = 45;
const JOIN_WAIT = 14;          // seconds to wait for matched players to arrive before bots stand in
const LEAVE_GRACE = 6;         // seconds a player may drop out before a bot takes over and it counts as a loss
const BOT_WAIT_ALONE = 7;      // nobody else queueing: a bot match starts after this many seconds
const BOT_WAIT_CROWD = 20;     // others queueing but too far apart in rating: wait this long before bots fill
const PID_RE = /^[a-z0-9]{10,24}$/, KEY_RE = /^[A-Za-z0-9]{16,48}$/;
const BOT_TAGS = ['Nyx', 'orbitz', 'Kairo', 'zeph', 'Mako', 'lumen', 'Brixx', 'Sora', 'vanta', 'Rook', 'Ember', 'Pax', 'juno_k', 'Halcyon',
  'Tycho', 'Vesper', 'Kestrel', 'Quinn', 'nova7', 'Ash', 'Calyx', 'drift', 'Okami', 'pixl', 'Rune', 'Selk', 'tidal', 'Umbra', 'Vex', 'Wisp'];

/* ---------- game engines, loaded from the built game pages ---------- */
function loadEngine(file) {
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf('/* ================= constants'), b = html.indexOf('/* ================= audio');
  if (a < 0 || b < 0) throw new Error('Game code markers not found in ' + file);
  // Runs in this realm (not a vm sandbox, which made the physics ~3x slower). It is our own game code.
  const stubs = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    performance: { now: () => Number(process.hrtime.bigint() / 1000000n) }
  };
  const make = new Function('matchMedia', 'localStorage', 'performance', '"use strict";\n' + html.slice(a, b) + `
return {Game, assignRoles, botControl, num, clamp, RI, OR,
  HB: typeof HB === 'undefined' ? 0 : HB,
  botParams: typeof botParams === 'function' ? botParams : null,
  DIFF: typeof DIFF === 'undefined' ? null : DIFF};`);
  const api = make(stubs.matchMedia, stubs.localStorage, stubs.performance);
  return api;
}

function hashKey(k) { return crypto.createHash('sha256').update('loopball:' + k).digest('hex'); }
function code5() { let s = ''; for (let i = 0; i < 5; i++) s += 'abcdefghjkmnpqrstuvwxyz'[crypto.randomInt(23)]; return s; }
const cleanName = v => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').trim().slice(0, 14) || 'Player';
const modeKey = (game, md) => game + md;
function blankMode() { return { mmr: R.START, peak: R.START, w: 0, l: 0, g: 0, best: 0, mvp: 0, st: 0, bst: 0, pl: 0 }; }

function createRanked({ relay, store, publicDir }) {
  const engines = {};
  function engine(game) {
    if (!engines[game]) engines[game] = loadEngine(path.join(publicDir, game, 'index.html'));
    return engines[game];
  }
  const queues = new Map();     // modeKey -> [entry]
  const byPid = new Map();      // pid -> entry (queued) | {match}
  const matches = new Set();
  let cpuEma = 0, lite = 0, liteT = 0;
  // Load governor: the free server has a sliver of one CPU. If matches start to cost too much,
  // bots think ahead less often (and at the extreme, only time their dashes) until things calm down.
  function liteP(P0) {
    if (!P0 || !P0.look) return P0;
    const P = Object.assign({}, P0);
    if (lite > 0) {
      P.lookP = Math.max(.08, P0.lookP * Math.pow(.7, lite));
      P.lookEvery = Math.min(.3, P0.lookEvery * Math.pow(1.25, lite));
      if (lite >= 4) P.steer = 0;
    }
    return P;
  }
  function applyLite() {
    for (const M of matches) if (M.g) for (const r of M.g.rings) if (r.P0) r.P = liteP(r.P0);
  }

  /* ---------- players ---------- */
  function auth(pid, key, create) {
    if (typeof pid !== 'string' || typeof key !== 'string' || !PID_RE.test(pid) || !KEY_RE.test(key)) return null;
    let p = store.get(pid);
    if (p) return p.kh === hashKey(key) ? p : null;
    if (!create) return { fresh: true };
    p = { kh: hashKey(key), nm: 'Player', made: Date.now(), last: Date.now(), m: {} };
    store.put(pid, p);
    return p;
  }
  function modeOf(p, k) { return p.m[k] || (p.m[k] = blankMode()); }
  function botSkill(mmr) { return R.botSkill(mmr); }
  function botParamsFor(eng, mmr) {
    const sk = botSkill(mmr);
    if (eng.botParams) return { P: eng.botParams(sk), diff: 'pro' };
    return { P: null, diff: sk < .33 ? 'rookie' : sk < .62 ? 'pro' : 'elite' };
  }

  /* ---------- queue ---------- */
  function enqueue(conn, m) {
    const game = m.g === '3d' ? '3d' : '2d', md = [1, 2, 3].includes(m.md) ? m.md : 1;
    const p = auth(m.pid, m.key, true);
    if (!p || p.fresh) return conn.send(JSON.stringify({ t: 'rq', st: 'denied', why: 'This device’s ranked key does not match. Restore it from the Star Chart on the main page.' }));
    p.nm = cleanName(m.nm); p.last = Date.now(); store.put(m.pid, p);
    const cur = byPid.get(m.pid);
    if (cur && cur.match && cur.match.state !== 'done') {
      // already playing: send them back into their match
      const M = cur.match, h = M.humans.find(x => x.pid === m.pid);
      if (h && !h.gone) { h.peer = conn.id; if (h.ring) h.ring.peer = conn.id; M.Ljson = ''; return conn.send(JSON.stringify({ t: 'rgo', code: M.code, g: M.game, md: M.md, back: 1 })); }
    }
    if (cur && cur.queued) removeFromQueue(cur);
    const mk = modeKey(game, md);
    const e = { queued: true, pid: m.pid, conn, peer: conn.id, name: p.nm, mmr: modeOf(p, mk).mmr, placing: modeOf(p, mk).pl < R.PLACEMENTS, game, md, mk, t0: Date.now() };
    if (!queues.has(mk)) queues.set(mk, []);
    queues.get(mk).push(e);
    byPid.set(m.pid, e);
    conn.send(JSON.stringify({ t: 'rq', st: 'queued', g: game, md, n: queues.get(mk).length }));
  }
  function removeFromQueue(e) {
    const q = queues.get(e.mk); if (q) { const i = q.indexOf(e); if (i >= 0) q.splice(i, 1); }
    if (byPid.get(e.pid) === e) byPid.delete(e.pid);
    e.queued = false;
  }
  function cancel(conn) {
    for (const q of queues.values()) for (const e of [...q]) if (e.conn === conn) removeFromQueue(e);
  }

  function matchmake() {
    const now = Date.now();
    for (const [mk, q] of queues) {
      for (const e of [...q]) if (e.conn.closed) removeFromQueue(e);
      while (q.length) {
        q.sort((a, b) => a.t0 - b.t0);
        const e = q[0], need = e.md * 2, waited = (now - e.t0) / 1000;
        const win = Math.min(700, 120 + waited * 22);
        const near = q.filter(x => Math.abs(x.mmr - e.mmr) <= win).sort((a, b) => Math.abs(a.mmr - e.mmr) - Math.abs(b.mmr - e.mmr)).slice(0, need);
        const alone = q.length === 1;
        if (near.length >= need || waited >= (alone ? BOT_WAIT_ALONE : BOT_WAIT_CROWD)) {
          for (const x of near) removeFromQueue(x);
          startMatch(e.game, e.md, near);
          continue;
        }
        break;
      }
      for (const e of q) {
        const sec = Math.floor((now - e.t0) / 1000);
        if (sec !== e.lastSec) { e.lastSec = sec; e.conn.send(JSON.stringify({ t: 'rq', st: 'wait', sec, n: q.length, bots: q.length === 1 ? BOT_WAIT_ALONE : BOT_WAIT_CROWD })); }
      }
    }
  }

  /* ---------- matches ---------- */
  function startMatch(game, md, entries) {
    const eng = engine(game);
    // balance teams: strongest first, each to the team with the lower rating total that still has room
    const sorted = entries.slice().sort((a, b) => b.mmr - a.mmr), teams = [[], []], sum = [0, 0];
    for (const e of sorted) {
      const t = teams[0].length >= md ? 1 : teams[1].length >= md ? 0 : (sum[0] <= sum[1] ? 0 : 1);
      teams[t].push(e); sum[t] += e.mmr;
    }
    const avg = entries.reduce((s, e) => s + e.mmr, 0) / entries.length;
    const names = BOT_TAGS.slice().sort(() => Math.random() - .5);
    const slots = [], humans = [], bots = [];
    let k = 0;
    for (const t of [0, 1]) {
      for (const e of teams[t]) { slots.push({ team: t, name: e.name, peer: e.peer }); humans.push({ pid: e.pid, peer: e.peer, name: e.name, mmr: e.mmr, placing: e.placing, team: t, missing: 0, gone: false, done: false }); }
      for (let i = teams[t].length; i < md; i++) {
        // bots sit right at the match's rating, with a little spread so they do not all feel identical
        const bm = Math.round(avg + (Math.random() - .5) * 40);
        slots.push({ team: t, name: names[k++ % names.length], bot: true, diff: 'pro' }); bots.push({ team: t, mmr: bm });
      }
    }
    let code; do code = code5(); while (relay.roomExists((game === '3d' ? 'l3-' : 'lb-') + code));
    const M = {
      game, md, code, room: (game === '3d' ? 'l3-' : 'lb-') + code, eng, slots, humans, bots,
      state: 'wait', t: 0, sendT: 0, Ljson: '', lastD: {}, lastH: {}, ack: {}, claimDone: {}, best: {}, g: null, endT: 0
    };
    M.peer = relay.virtualPeer('rk' + code);
    relay.join(M.peer, M.room);
    matches.add(M);
    for (const h of humans) byPid.set(h.pid, { match: M });
    publishL(M);
    for (const h of humans) relay.sendTo(h.peer, { t: 'rgo', code, g: game, md, host: M.peer.id });
    return M;
  }

  function ratingOf(M, i) {
    const r = M.g ? M.g.rings[i] : null; const s = M.slots[i];
    if (s.bot) { let n = 0; for (let j = 0; j < i; j++) if (M.slots[j].bot) n++; return M.bots[n].mmr; }
    const h = M.humans.find(x => x.peer === s.peer || x.slot === i); return h ? h.mmr : R.START;
  }
  function L(M) {
    const rings = M.g ? M.g.rings : null;
    return {
      md: M.md, st: M.state === 'wait' ? 0 : 1, du: MATCH_SECONDS, pub: 0, bd: 'pro', kk: [], rk: 1,
      sl: M.slots.map((s, i) => { const r = rings && rings[i]; return [s.team, r ? (r.bot ? null : r.peer) : (s.bot ? null : s.peer), r ? r.name : s.name, (r ? r.bot : s.bot) ? 1 : 0]; }),
      rs: M.slots.map((s, i) => R.rankOf(M.ratings ? M.ratings[i] : ratingOf(M, i)).step)
    };
  }
  function publishL(M) {
    const l = L(M), j = JSON.stringify(l);
    if (j !== M.Ljson) { M.Ljson = j; relay.presence(M.peer, M.room, { h: 1, L: l }); }
  }

  function begin(M) {
    const eng = M.eng;
    M.ratings = M.slots.map((s, i) => ratingOf(M, i));
    M.g = new eng.Game({ mode: 'match', size: M.md, duration: MATCH_SECONDS, slots: M.slots.map(s => Object.assign({}, s)) });
    let b = 0;
    M.g.rings.forEach((r, i) => {
      const s = M.slots[i];
      if (s.bot) { const bp = botParamsFor(eng, M.bots[b++].mmr); if (bp.P) { r.P0 = bp.P; r.P = liteP(bp.P); } r.diff = bp.diff; }
      else { const h = M.humans.find(x => x.peer === s.peer); h.slot = i; h.ring = r; r.peer = h.peer; }
    });
    for (const h of M.humans) if (h.missing >= JOIN_WAIT - .01 && !h.here) toBot(M, h, false);
    M.state = 'live';
    publishL(M);
  }
  function toBot(M, h, penalize) {
    const r = M.g.rings[h.slot];
    const bp = botParamsFor(M.eng, h.mmr);
    r.bot = true; r.peer = null; if (bp.P) { r.P0 = bp.P; r.P = liteP(bp.P); } r.diff = bp.diff; r.ai = { t: 0 };
    h.gone = true;
    if (penalize) settle(M, h, false, true);
    else { h.done = true; if (byPid.get(h.pid) && byPid.get(h.pid).match === M) byPid.delete(h.pid); }
  }

  function settle(M, h, won, abandoned) {
    if (h.done) return; h.done = true;
    if (byPid.get(h.pid) && byPid.get(h.pid).match === M) byPid.delete(h.pid);
    const p = store.get(h.pid); if (!p) return;
    const mk = modeKey(M.game, M.md), s = modeOf(p, mk);
    const team = h.team, my = [], their = [];
    M.slots.forEach((sl, i) => (sl.team === team ? my : their).push(M.ratings[i]));
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    const placing = s.pl < R.PLACEMENTS, wasPlaced = !placing;
    let d = R.delta(avg(my), avg(their), won, placing);
    if (won && d < 1) d = 1; if (!won && d > -1) d = -1;
    const prev = s.mmr;
    s.mmr = Math.max(0, s.mmr + d); s.peak = Math.max(s.peak, s.mmr);
    if (won) { s.w++; s.st = s.st > 0 ? s.st + 1 : 1; s.bst = Math.max(s.bst, s.st); } else { s.l++; s.st = s.st < 0 ? s.st - 1 : -1; }
    s.pl = Math.min(R.PLACEMENTS, s.pl + 1);
    const ring = M.g.rings[h.slot], goals = ring ? ring.goals : 0;
    s.g += goals; s.best = Math.max(s.best, M.best[h.slot] || 0);
    let mvp = false;
    if (!abandoned && won && M.g) {
      const top = Math.max(...M.g.rings.map(r => r.goals));
      mvp = goals > 0 && goals === top && M.g.rings.filter(r => r.team === team && r.goals === top)[0] === ring;
      if (mvp) s.mvp++;
    }
    s.last = Date.now(); p.last = Date.now();
    store.put(h.pid, p);
    relay.sendTo(h.peer, { t: 'rres', g: M.game, md: M.md, won: won ? 1 : 0, d, prev, mmr: s.mmr, pl: s.pl, placed: s.pl >= R.PLACEMENTS, wp: wasPlaced ? 1 : 0, ab: abandoned ? 1 : 0, goals, mvp: mvp ? 1 : 0, st: s.st, peak: s.peak });
    lbCache.delete(mk);
  }

  function claim(M, g, r, cl) {
    const eng = M.eng, num = eng.num;
    const id = num(cl[0]) | 0;
    if (!id || M.claimDone[r.peer] === id || g.phase !== 'play' || r.stun > 0) return;
    const o = g.orb;
    if (M.game === '3d') {
      if (Math.hypot(o.x - r.x, o.z - r.z) > 190) return;
      if (g.carrier >= 0 && g.carrier !== r.i) return;
      if (o.y > r.y + eng.HB + 70) return;
      let dx = num(cl[1]), dz = num(cl[2]); const l = Math.hypot(dx, dz), m = eng.RI - eng.OR - 1; if (l > m) { dx *= m / (l || 1); dz *= m / (l || 1); }
      o.x = r.x + dx; o.z = r.z + dz; o.vx = r.vx; o.vz = r.vz; o.last = r.i; o.y = eng.clamp(r.y + num(cl[3]), eng.OR, r.y + eng.HB); o.vy = Math.max(r.vy, 0);
    } else {
      if (Math.hypot(o.x - r.x, o.y - r.y) > 190) return;
      if (g.carrier >= 0 && g.carrier !== r.i) return;
      let dx = num(cl[1]), dz = num(cl[2]); const l = Math.hypot(dx, dz), m = eng.RI - eng.OR - 1; if (l > m) { dx *= m / (l || 1); dz *= m / (l || 1); }
      o.x = r.x + dx; o.y = r.y + dz; o.vx = r.vx; o.vy = r.vy; o.last = r.i;
    }
    M.claimDone[r.peer] = id;
  }

  function frame(M, dt) {
    M.t += dt;
    const pm = relay.peersIn(M.room);  // Map peer -> presence
    for (const h of M.humans) {
      if (h.gone) continue;
      const pr = pm.get(h.peer);
      h.here = !!(pr && pr.j === 1);
      h.missing = h.here ? 0 : h.missing + dt;
    }
    if (M.state === 'wait') {
      if (M.humans.every(h => h.here) || M.t >= JOIN_WAIT) begin(M);
      else return publishL(M);
    }
    const g = M.g, eng = M.eng, num = eng.num, clamp = eng.clamp;
    if (M.state === 'live') {
      for (const h of M.humans) if (!h.gone && h.missing > LEAVE_GRACE) toBot(M, h, true);
      if (M.humans.every(h => h.gone)) { finish(M, true); return; }
      for (const r of g.rings) {
        if (r.bot) continue;
        const pr = pm.get(r.peer), inp = pr && pr.in;
        if (pr && Array.isArray(pr.cl)) claim(M, g, r, pr.cl);
        if (M.game === '3d') {
          if (g.phase === 'replay' && pr && num(pr.sk, -1) === g.goalId) g.skips.add(r.i);
          if (Array.isArray(inp)) {
            r.ix = clamp(num(inp[0]), -1, 1); r.iz = clamp(num(inp[1]), -1, 1);
            const ds = num(inp[2]) | 0, hs = num(inp[3]) | 0;
            if (M.lastD[r.peer] === undefined) M.lastD[r.peer] = ds; else if (ds > M.lastD[r.peer]) { r.dashReq = true; M.lastD[r.peer] = ds; }
            if (M.lastH[r.peer] === undefined) M.lastH[r.peer] = hs; else if (hs > M.lastH[r.peer]) { r.hopReq = true; M.lastH[r.peer] = hs; }
            M.ack[r.i] = num(inp[4]);
          } else { r.ix = r.iz = 0; }
        } else {
          if (Array.isArray(inp)) {
            r.ix = clamp(num(inp[0]), -1, 1); r.iy = clamp(num(inp[1]), -1, 1);
            const ds = num(inp[2]) | 0;
            if (M.lastD[r.peer] === undefined) M.lastD[r.peer] = ds; else if (ds > M.lastD[r.peer]) { r.dashReq = true; M.lastD[r.peer] = ds; }
            M.ack[r.i] = num(inp[3]);
          } else { r.ix = r.iy = 0; }
        }
      }
      eng.assignRoles(g, dt);
      for (const r of g.rings) if (r.bot) eng.botControl(g, r, dt);
      g.tick(dt);
      for (const e of g.events) if (e.type === 'goal' && e.by >= 0 && !e.own) M.best[e.by] = Math.max(M.best[e.by] || 0, e.spd | 0);
      g.events.length = 0;
      if (g.phase === 'end') finish(M, false);
    }
    publishL(M);
    M.sendT -= dt;
    if (M.sendT <= 0 && g) {
      M.sendT = 1 / SNAP_HZ;
      relay.presence(M.peer, M.room, { s: g.snap(g.rings.map(r => Math.round(M.ack[r.i] || 0))) });
    }
  }
  function finish(M, aborted) {
    if (M.state === 'done') return;
    M.state = 'done'; M.endT = Date.now();
    if (!aborted) {
      const win = M.g.score[0] > M.g.score[1] ? 0 : 1;
      for (const h of M.humans) if (!h.done) settle(M, h, h.team === win, false);
    }
  }

  /* ---------- clock ---------- */
  let last = process.hrtime.bigint(), mmT = 0;
  const clock = setInterval(() => {
    const now = process.hrtime.bigint();
    const dt = Math.min(.05, Math.max(0, Number(now - last) / 1e9)); last = now;
    for (const M of matches) {
      try {
        if (M.state === 'done') {
          // keep the final score up for a little while, then close the room
          if (M.g) { M.sendT -= dt; if (M.sendT <= 0) { M.sendT = .5; relay.presence(M.peer, M.room, { s: M.g.snap(null) }); } }
          if (Date.now() - M.endT > 30000) { relay.leave(M.peer, M.room); matches.delete(M); }
          continue;
        }
        frame(M, dt);
      } catch (e) {
        console.error('Ranked match error', M.code, e);
        finish(M, true); relay.leave(M.peer, M.room); matches.delete(M);
        for (const h of M.humans) if (byPid.get(h.pid) && byPid.get(h.pid).match === M) byPid.delete(h.pid);
      }
    }
    const spent = Number(process.hrtime.bigint() - now) / 1e6;
    cpuEma = cpuEma * .98 + spent * .02;
    mmT += dt; if (mmT >= 1) { mmT = 0; matchmake(); }
    liteT += dt;
    if (liteT >= 2) {
      liteT = 0;
      const was = lite;
      if (cpuEma > 2.2) lite = Math.min(6, lite + 1); else if (cpuEma < .9 && lite > 0) lite--;
      if (lite !== was) { applyLite(); console.log('Ranked load ' + cpuEma.toFixed(2) + ' ms/tick, bot thinking level ' + (6 - lite) + '/6'); }
    }
  }, 1000 / 60);
  clock.unref && clock.unref();

  /* ---------- leaderboard + profile ---------- */
  const lbCache = new Map();
  function leaderboard(game, md) {
    const mk = modeKey(game, md), c = lbCache.get(mk);
    if (c && Date.now() - c.t < 15000) return c.v;
    const rows = [];
    for (const [pid, p] of store.entries()) {
      const s = p.m && p.m[mk]; if (!s || s.pl < R.PLACEMENTS) continue;
      rows.push({ id: pid.slice(0, 6), n: p.nm, mmr: s.mmr, s: R.rankOf(s.mmr).step, w: s.w, l: s.l });
    }
    rows.sort((a, b) => b.mmr - a.mmr);
    const v = { game, md, total: rows.length, rows: rows.slice(0, 100) };
    lbCache.set(mk, { t: Date.now(), v });
    return v;
  }
  function profile(pid, key) {
    const p = auth(pid, key, false);
    if (!p) return { error: 'mismatch' };
    if (p.fresh) return { fresh: true };
    const out = { nm: p.nm, m: {} };
    for (const k of Object.keys(p.m)) {
      const s = p.m[k];
      let pos = null;
      if (s.pl >= R.PLACEMENTS) { const lb = leaderboard(k.slice(0, 2), +k[2]); const i = lb.rows.findIndex(r => r.id === pid.slice(0, 6) && r.mmr === s.mmr); if (i >= 0) pos = i + 1; }
      out.m[k] = Object.assign({ pos }, s);
    }
    return out;
  }
  function stats() {
    const q = {}; for (const [k, v] of queues) q[k] = v.length;
    let live = 0; for (const M of matches) if (M.state !== 'done') live++;
    return { queues: q, live, cpu: Math.round(cpuEma * 100) / 100, lite, store: store.info() };
  }

  function onMessage(conn, m) {
    if (m.t === 'rq') enqueue(conn, m);
    else if (m.t === 'rx') cancel(conn);
  }
  function onClose(conn) { cancel(conn); }

  return { onMessage, onClose, leaderboard, profile, stats, _matches: matches, _engine: engine };
}

module.exports = { createRanked, loadEngine };
