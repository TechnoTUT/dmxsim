// LASER SCAN 300 のビルトインパターン（取扱説明書 p.11 の表）を近似生成する。
// 各パターンは単位座標 [-1,1] の点列。null 要素はペンアップ（線を切る）。
// group 1,2 は図形を数式で、group 3〜5 は絵文字・文字の輪郭をキャンバスから抽出する。

const TAU = Math.PI * 2;
const N = 120;

function poly(verts, n = N, close = true) {
  const v = close ? [...verts, verts[0]] : verts;
  const seg = [];
  let total = 0;
  for (let i = 1; i < v.length; i++) {
    const l = Math.hypot(v[i][0] - v[i - 1][0], v[i][1] - v[i - 1][1]);
    seg.push(l);
    total += l;
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    let d = (k / (n - 1)) * total;
    let i = 0;
    while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const t = seg[i] ? d / seg[i] : 0;
    out.push([v[i][0] + (v[i + 1][0] - v[i][0]) * t, v[i][1] + (v[i + 1][1] - v[i][1]) * t]);
  }
  return out;
}
const circle = (r = 0.8, n = N, cx = 0, cy = 0, a0 = 0, a1 = TAU) =>
  Array.from({ length: n }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / (n - 1);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
const ngon = (k, r = 0.85, rot = -Math.PI / 2) => Array.from({ length: k }, (_, i) => [Math.cos(rot + (TAU * i) / k) * r, Math.sin(rot + (TAU * i) / k) * r]);
const star = (k = 5, r0 = 0.9, r1 = 0.38) =>
  Array.from({ length: k * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * i) / k;
    const r = i % 2 ? r1 : r0;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
const join = (...parts) => parts.flatMap((p, i) => (i ? [null, ...p] : p));
const line = (a, b, n = 30) => poly([a, b], n, false);
const fn = (f, n = N, x0 = -0.9, x1 = 0.9) => Array.from({ length: n }, (_, i) => { const x = x0 + ((x1 - x0) * i) / (n - 1); return [x, f(x)]; });

// ---- グループ1（列1）
const G1 = [
  () => circle(0.8),
  () => circle(0.55),
  () => { const out = []; for (let k = 0; k < 12; k++) out.push(...(k ? [null] : []), ...circle(0.8, 10, 0, 0, (TAU * k) / 12, (TAU * (k + 0.55)) / 12)); return out; },
  () => Array.from({ length: N }, (_, i) => { const t = i / (N - 1); const a = t * TAU * 2.6; const r = 0.08 + 0.8 * t; return [Math.cos(a) * r, Math.sin(a) * r]; }),
  () => poly(ngon(3, 0.9)),
  () => poly(ngon(4, 0.9, Math.PI / 4)),
  () => poly(ngon(4, 0.6, Math.PI / 4)),
  () => poly(star(5)),
  () => poly(star(5, 0.7, 0.3)),
  () => join(...[[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]].map(([x, y]) => poly([[x - 0.12, y - 0.12], [x + 0.12, y - 0.12], [x + 0.12, y + 0.12], [x - 0.12, y + 0.12]], 16))),
  () => join(poly([[-0.15, -0.9], [0.15, -0.9], [0.15, 0.9], [-0.15, 0.9]], 40), ...Array.from({ length: 8 }, (_, i) => line([-0.15, -0.9 + (i + 1) * 0.2], [0.15, -0.9 + (i + 1) * 0.2], 6))),
  () => join(...Array.from({ length: 7 }, (_, i) => circle(0.06, 8, -0.75 + i * 0.25, 0))),
  () => join(...[[-0.6, -0.5], [0, -0.7], [0.6, -0.5], [-0.3, -0.1], [0.3, -0.1], [-0.6, 0.3], [0, 0.2], [0.6, 0.3], [-0.3, 0.65], [0.3, 0.65]].map(([x, y]) => circle(0.06, 8, x, y))),
  () => join(circle(0.8, 40, 0, 0, Math.PI * 0.55, Math.PI * 0.95), circle(0.8, 40, 0, 0, -Math.PI * 0.45, -Math.PI * 0.05)),
  () => join(...[0, 1, 2, 3].map((k) => circle(0.8, 24, 0, 0, (k * TAU) / 4 + 0.25, ((k + 1) * TAU) / 4 - 0.25))),
  () => fn((x) => Math.sin(x * Math.PI * 1.2) * 0.25),
];

// ---- グループ2（列2）
const G2 = [
  () => fn((x) => Math.sin(x * Math.PI * 5) * 0.08),
  () => fn((x) => 0.7 - 1.5 * Math.exp(-(x * x) * 6)),
  () => fn((x) => Math.cos(x * Math.PI * 2.2) * 0.7),
  () => poly([[-0.9, -0.8], [-0.65, 0.8], [-0.4, -0.8], [-0.15, 0.8], [0.1, -0.8], [0.35, 0.8], [0.6, -0.8], [0.85, 0.8]], N, false),
  () => Array.from({ length: N }, (_, i) => { const a = (TAU * i) / (N - 1); return [Math.sin(a) * 0.85, Math.sin(2 * a) * 0.6]; }),
  () => line([-0.9, 0], [0.9, 0], 60),
  () => line([-0.6, 0], [0.6, 0], 60),
  () => join(line([-0.9, 0], [0.9, 0], 40), line([0, -0.9], [0, 0.9], 40)),
  () => join(line([-0.9, -0.4], [0.9, -0.4], 40), line([-0.9, 0.4], [0.9, 0.4], 40)),
  () => fn((x) => ((((x * 4 + 10) % 1) + 1) % 1 > 0.5 ? 1 : -1) * 0.1 + 0, N),
  () => poly(Array.from({ length: 9 }, (_, i) => [-0.8 + i * 0.2, -0.8 + i * 0.2 + (i % 2) * 0.1]), N, false),
  () => join(...Array.from({ length: 5 }, (_, i) => line([-0.6 + i * 0.3, -0.8], [-0.6 + i * 0.3, 0.8], 20))),
  () => join(...Array.from({ length: 9 }, (_, i) => { const a = Math.PI + (Math.PI * (i + 0.5)) / 9; return line([Math.cos(a) * 0.35, Math.sin(a) * 0.35 + 0.4], [Math.cos(a) * 0.9, Math.sin(a) * 0.9 + 0.4], 8); })),
  () => poly([[-0.9, 0.3], [-0.5, -0.2], [-0.2, 0.4], [0.1, -0.5], [0.4, 0.2], [0.65, -0.3], [0.9, 0.3]], N, false),
  () => join(...Array.from({ length: 4 }, (_, i) => { const a = (Math.PI * i) / 4; return line([Math.cos(a) * -0.85, Math.sin(a) * -0.85], [Math.cos(a) * 0.85, Math.sin(a) * 0.85], 24); })),
  () => join(...Array.from({ length: 6 }, (_, i) => line([-0.8 + (i % 2) * 0.3, -0.7 + i * 0.28], [0.3 + (i % 2) * 0.4, -0.7 + i * 0.28], 12))),
];

// ---- グループ3〜5は文字/絵文字の輪郭から
const G3 = ['🎃', '💰', '🍸', '👅', '💘', '👽', '🌹', '❓', '❗', '🎀', '🐟', '🕒', '☁', '👩', '🧔', '😎'];
const G4 = ['✔', '✖', '🏃', '🧍', '👍', '✋', '✌', '🕊', '♥', 'OPEN', '🌙', '☺', 'MUSIC', 'PARTY', 'DANCE', 'HAPPY'];
const G5 = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '@', '$', 'LOVE', 'money', 'CRAZY', '+'];

let glyphCanvas;
function glyphOutline(str) {
  const S = 96;
  glyphCanvas ??= document.createElement('canvas');
  glyphCanvas.width = S;
  glyphCanvas.height = S;
  const ctx = glyphCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fs = 80;
  ctx.font = `bold ${fs}px sans-serif`;
  const w = ctx.measureText(str).width;
  if (w > S * 0.92) { fs = Math.floor((fs * S * 0.92) / w); ctx.font = `bold ${fs}px sans-serif`; }
  ctx.fillText(str, S / 2, S / 2 + 4);
  const img = ctx.getImageData(0, 0, S, S).data;
  const on = (x, y) => x >= 0 && y >= 0 && x < S && y < S && img[(y * S + x) * 4 + 3] > 110;
  const edge = [];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (on(x, y) && (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1))) edge.push([x, y]);
  if (!edge.length) return circle(0.5);
  // 近傍連結で並べる（遠い点に飛ぶときはペンアップ）
  const step = Math.max(1, Math.floor(edge.length / 220));
  const pts = edge.filter((_, i) => i % step === 0);
  const used = new Uint8Array(pts.length);
  const out = [];
  let cur = 0;
  used[0] = 1;
  for (let k = 1; k <= pts.length; k++) {
    out.push([(pts[cur][0] / S) * 2 - 1, (pts[cur][1] / S) * 2 - 1]);
    let bi = -1, bd = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (used[j]) continue;
      const d = (pts[j][0] - pts[cur][0]) ** 2 + (pts[j][1] - pts[cur][1]) ** 2;
      if (d < bd) { bd = d; bi = j; }
    }
    if (bi < 0) break;
    if (bd > (step * 3) ** 2) out.push(null);
    used[bi] = 1;
    cur = bi;
  }
  return out;
}

const cache = new Map();
/** group: 0..4, index: 0..15 */
export function getPattern(group, index) {
  const key = group * 16 + index;
  if (cache.has(key)) return cache.get(key);
  let pts;
  if (group === 0) pts = G1[index]();
  else if (group === 1) pts = G2[index]();
  else pts = glyphOutline([G3, G4, G5][group - 2][index]);
  // y軸は上向きを正に（キャンバスは下向き）
  pts = pts.map((p) => (p ? [p[0], -p[1]] : null));
  cache.set(key, pts);
  return pts;
}

export const PATTERN_LABELS = [
  ['circle', 'small circle', 'dashed circle', 'spiral', 'triangle', 'square', 'small square', 'star', 'small star', '4 squares', 'ladder', 'dot row', 'scattered dots', '2 arcs', '4 arcs', 'wave'],
  ['ripple', 'V', 'W', 'zigzag', 'figure 8', 'line', 'short line', 'cross', 'double line', 'square wave', 'stairs', '5 vertical lines', 'rays', 'lightning', 'asterisk', 'dashed lines'],
  G3, G4, G5,
];
