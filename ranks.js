/* Loopball ranks: shared by the server and the web pages.
   Ratings work like Elo/MMR: beating a higher-rated team earns more, losing to a lower-rated team costs more.
   Ranks climb the cosmic scale; the top three have no divisions and big gaps between them. */
(function (root) {
  'use strict';
  const TIERS = [
    { key: 'stardust', name: 'Stardust', color: '#9fb0c6', divs: 3 },
    { key: 'comet', name: 'Comet', color: '#46d6c3', divs: 3 },
    { key: 'moon', name: 'Moon', color: '#d5deea', divs: 3 },
    { key: 'planet', name: 'Planet', color: '#4f8cff', divs: 3 },
    { key: 'star', name: 'Star', color: '#ffc843', divs: 3 },
    { key: 'nova', name: 'Nova', color: '#ff8a3d', divs: 3 },
    { key: 'pulsar', name: 'Pulsar', color: '#c06bff', divs: 3 },
    { key: 'supernova', name: 'Supernova', color: '#ff4f6d', divs: 0 },
    { key: 'quasar', name: 'Quasar', color: '#6ff0ff', divs: 0 },
    { key: 'singularity', name: 'Singularity', color: '#f7f3e3', divs: 0 }
  ];
  // rating floor of every step on the ladder (tier, division)
  const STEPS = [];
  const FLOORS = [0, 600, 680, 760, 830, 900, 970, 1040, 1110, 1180, 1250, 1320, 1390, 1460, 1530, 1600, 1670, 1740, 1810, 1880, 1950, 2075, 2275, 2475];
  let k = 0;
  TIERS.forEach((t, ti) => {
    if (t.divs) for (let d = 1; d <= t.divs; d++) STEPS.push({ t: ti, d, min: FLOORS[k++] });
    else STEPS.push({ t: ti, d: 0, min: FLOORS[k++] });
  });
  const ROMAN = ['', 'I', 'II', 'III'];
  const START = 900, PLACEMENTS = 5, K_PLACE = 50, K_RANKED = 22;
  const MODES = [1, 2, 3], GAMES = ['2d', '3d'];

  function stepIndex(mmr) { let i = 0; while (i + 1 < STEPS.length && mmr >= STEPS[i + 1].min) i++; return i; }
  function rankOf(mmr, placed) {
    if (placed === false) return { unranked: true, name: 'Unranked', t: -1, d: 0, color: '#93a6bc' };
    const i = stepIndex(mmr), s = STEPS[i], t = TIERS[s.t], nx = STEPS[i + 1];
    return {
      t: s.t, d: s.d, key: t.key, color: t.color,
      tier: t.name, name: t.name + (s.d ? ' ' + ROMAN[s.d] : ''),
      min: s.min, next: nx ? nx.min : null, nextName: nx ? TIERS[nx.t].name + (nx.d ? ' ' + ROMAN[nx.d] : '') : null,
      progress: nx ? Math.max(0, Math.min(1, (mmr - s.min) / (nx.min - s.min))) : 1,
      top: s.t >= 7, step: i
    };
  }
  function expected(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
  // rating change for one player whose team averaged `mine` against a team averaging `theirs`
  function delta(mine, theirs, won, placing) {
    const K = placing ? K_PLACE : K_RANKED;
    return Math.round(K * ((won ? 1 : 0) - expected(mine, theirs)));
  }
  // ranked bots: skill 0..1 from rating (Stardust bots are gentle, Singularity bots are ruthless).
  // Calibrated from bot-vs-bot series: the old "Elite" bot plays like about 1250 (Planet II).
  // From Pulsar up the bots think ahead about every dash and turn; Quasar and Singularity bots go
  // past 1, thinking further ahead and more often (and, in 3D, going for aerials).
  const SK = [[500, 0], [900, .25], [1300, .5], [1600, .65], [1950, .84], [2075, .93], [2275, 1.06], [2475, 1.2], [2800, 1.25]];
  function botSkill(mmr) {
    if (mmr <= SK[0][0]) return 0;
    for (let i = 1; i < SK.length; i++) if (mmr <= SK[i][0]) { const a = SK[i - 1], b = SK[i]; return a[1] + (b[1] - a[1]) * (mmr - a[0]) / (b[0] - a[0]); }
    return SK[SK.length - 1][1];
  }

  /* ---------- badges: inline SVG, one look per tier ---------- */
  function pips(n, c) {
    if (!n) return '';
    let s = '';
    for (let i = 0; i < n; i++) s += `<circle cx="${32 + (i - (n - 1) / 2) * 9}" cy="58" r="3" fill="${c}"/>`;
    return s;
  }
  const ART = {
    stardust: c => `<circle cx="22" cy="24" r="5" fill="${c}"/><circle cx="38" cy="18" r="3.4" fill="${c}" opacity=".8"/><circle cx="42" cy="34" r="6" fill="${c}"/><circle cx="26" cy="40" r="3.6" fill="${c}" opacity=".75"/><circle cx="33" cy="29" r="2.4" fill="${c}" opacity=".6"/>`,
    comet: c => `<path d="M44 16 L14 46 L21 49 L49 22 Z" fill="${c}" opacity=".35"/><path d="M44 16 L18 40 L24 44 L48 20 Z" fill="${c}" opacity=".6"/><circle cx="44" cy="20" r="8" fill="${c}"/>`,
    moon: c => `<path d="M38 10 A20 20 0 1 0 50 40 A16 16 0 1 1 38 10 Z" fill="${c}"/><circle cx="26" cy="36" r="2.6" fill="#0e1a2b" opacity=".25"/><circle cx="21" cy="26" r="1.8" fill="#0e1a2b" opacity=".25"/>`,
    planet: c => `<circle cx="32" cy="29" r="13" fill="${c}"/><ellipse cx="32" cy="29" rx="25" ry="7.5" fill="none" stroke="${c}" stroke-width="3.2" transform="rotate(-18 32 29)" opacity=".9"/><path d="M19.5 25.3 A13 13 0 0 1 44.5 32.7" fill="none" stroke="#0e1a2b" stroke-width="0" />`,
    star: c => `<path d="M32 6 L37 24 L55 29 L37 34 L32 52 L27 34 L9 29 L27 24 Z" fill="${c}"/>`,
    nova: c => `<path d="M32 4 L36 20 L48 10 L42 25 L58 27 L43 33 L52 47 L37 39 L32 54 L27 39 L12 47 L21 33 L6 27 L22 25 L16 10 L28 20 Z" fill="${c}"/><circle cx="32" cy="29" r="6" fill="#fff" opacity=".85"/>`,
    pulsar: c => `<path d="M30 2 L34 2 L33.2 24 L30.8 24 Z M30.8 34 L33.2 34 L34 56 L30 56 Z" fill="${c}"/><circle cx="32" cy="29" r="7" fill="${c}"/><path d="M18 20 A16 16 0 0 0 18 38 M46 20 A16 16 0 0 1 46 38" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" opacity=".7"/>`,
    supernova: c => `<circle cx="32" cy="29" r="22" fill="none" stroke="${c}" stroke-width="2.4" opacity=".55"/><path d="M32 6 L35 22 L47 13 L40 26 L55 29 L40 32 L47 45 L35 36 L32 52 L29 36 L17 45 L24 32 L9 29 L24 26 L17 13 L29 22 Z" fill="${c}"/><circle cx="32" cy="29" r="6.5" fill="#fff"/>`,
    quasar: c => `<path d="M32 2 L35 21 L29 21 Z M32 56 L29 37 L35 37 Z" fill="${c}"/><ellipse cx="32" cy="29" rx="24" ry="7" fill="${c}" opacity=".35"/><ellipse cx="32" cy="29" rx="15" ry="4.5" fill="${c}" opacity=".8"/><circle cx="32" cy="29" r="5" fill="#fff"/>`,
    singularity: c => `<defs><radialGradient id="sg" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="#ffd27a"/><stop offset="80%" stop-color="#ff7a59" stop-opacity=".7"/><stop offset="100%" stop-color="#ff7a59" stop-opacity="0"/></radialGradient></defs><ellipse cx="32" cy="29" rx="27" ry="9" fill="url(#sg)" opacity=".9"/><circle cx="32" cy="29" r="13" fill="#05070c" stroke="${c}" stroke-width="2.4"/><path d="M14 22 A19 19 0 0 1 50 22" fill="none" stroke="#ffd27a" stroke-width="2.2" opacity=".85"/>`
  };
  function icon(r, size) {
    size = size || 40;
    if (!r || r.unranked) return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="29" r="18" fill="none" stroke="#93a6bc" stroke-width="3" stroke-dasharray="6 6"/><text x="32" y="35" text-anchor="middle" font-size="18" font-weight="700" fill="#93a6bc" font-family="system-ui,sans-serif">?</text></svg>`;
    const t = TIERS[r.t];
    return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${ART[t.key](t.color)}${pips(r.d, t.color)}</svg>`;
  }

  function fromStep(step) { const s = STEPS[Math.max(0, Math.min(STEPS.length - 1, step | 0))]; return rankOf(s.min); }

  /* ---------- identity (browser only): no accounts, just an id and a secret key kept on this device ---------- */
  const ID_RE = /^[a-z0-9]{10,24}$/, KEY_RE = /^[A-Za-z0-9]{16,48}$/;
  function rand(n, abc) { const b = new Uint32Array(n); crypto.getRandomValues(b); let s = ''; for (let i = 0; i < n; i++) s += abc[b[i] % abc.length]; return s; }
  function identity(create) {
    try {
      let id = localStorage.getItem('lb.rid'), key = localStorage.getItem('lb.rkey');
      if (!ID_RE.test(id || '') || !KEY_RE.test(key || '')) {
        if (!create) return null;
        id = rand(12, 'abcdefghijklmnopqrstuvwxyz0123456789');
        key = rand(24, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789');
        localStorage.setItem('lb.rid', id); localStorage.setItem('lb.rkey', key);
      }
      return { id, key };
    } catch (e) { return null; }
  }
  // the recovery code moves your ranks to another device or browser
  function recoveryCode(me) { return me ? 'LB-' + me.id + '-' + me.key : ''; }
  function restore(code) {
    const m = /^\s*LB-([a-z0-9]{10,24})-([A-Za-z0-9]{16,48})\s*$/.exec(code || '');
    if (!m) return false;
    try { localStorage.setItem('lb.rid', m[1]); localStorage.setItem('lb.rkey', m[2]); return true; } catch (e) { return false; }
  }

  const api = { TIERS, STEPS, START, PLACEMENTS, MODES, GAMES, rankOf, fromStep, expected, delta, botSkill, icon, ROMAN, identity, recoveryCode, restore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LoopRanks = api;
})(typeof self !== 'undefined' ? self : this);
