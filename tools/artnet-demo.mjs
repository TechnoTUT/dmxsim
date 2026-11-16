// テスト用 Art-Net 送信機。config/patch.json の灯体に向けてデモ演出を送る。
// 使い方は `node tools/artnet-demo.mjs --help`（npm なら `npm run demo -- --help`）。
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: npm run demo -- [options] [host]
       node tools/artnet-demo.mjs [options] [host]

Sends a demo light show over Art-Net to the fixtures in config/patch.json.

Options:
  -H, --host <ip>       Destination IP (default 127.0.0.1). A broadcast address
                        such as 192.168.1.255 also works. Can also be given as
                        the first argument.
  -p, --port <port>     Destination UDP port (default 6454)
  -b, --bpm <bpm>       Tempo (default 128)
  -s, --scene <1-4>     Stay on one look instead of cycling through all four
      --bars <n>        Bars per look when cycling (default 4)
      --only <list>     Drive only these fixture types, comma-separated:
                        spot, par, laser, ball (others are kept dark)
      --still <sec>     Freeze the show at this time in seconds (for screenshots)
      --fps <n>         Packets per second per universe (default 40)
  -h, --help            Show this help

Looks:
  1  moving heads chase one at a time, lasers off
  2  gobos in, lasers change color
  3  wider moving-head sweep, lasers rotate, twinkle ball off
  4  gobo wheel spins, pars add amber, twinkle ball in sound mode

Examples:
  npm run demo
  npm run demo -- 192.168.50.10 --bpm 140
  npm run demo -- --scene 3 --only spot,laser
`;

// ------------------------------------------------------------ 引数
function fail(msg) {
  console.error(`artnet-demo: ${msg}\nRun with --help for usage.`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      host: { type: 'string', short: 'H' },
      port: { type: 'string', short: 'p', default: '6454' },
      bpm: { type: 'string', short: 'b', default: '128' },
      scene: { type: 'string', short: 's' },
      bars: { type: 'string', default: '4' },
      only: { type: 'string' },
      still: { type: 'string' },
      fps: { type: 'string', default: '40' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  fail(e.message);
}
const { values: v, positionals } = parsed;
if (v.help) {
  console.log(HELP);
  process.exit(0);
}
if (positionals.length > 1) fail(`unexpected arguments: ${positionals.slice(1).join(' ')}`);
if (v.host && positionals.length) fail('give the host either as an argument or with --host, not both');

function num(name, value, { min = -Infinity, max = Infinity, int = false } = {}) {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n)))
    fail(`--${name} must be ${int ? 'an integer' : 'a number'}${min > -Infinity ? ` from ${min}` : ''}${max < Infinity ? ` to ${max}` : ''} (got "${value}")`);
  return n;
}

const HOST = v.host ?? positionals[0] ?? '127.0.0.1';
const PORT = num('port', v.port, { min: 1, max: 65535, int: true });
const BPM = num('bpm', v.bpm, { min: 1, max: 400 });
const SCENE = v.scene === undefined ? null : num('scene', v.scene, { min: 1, max: 4, int: true }) - 1;
const BARS = num('bars', v.bars, { min: 1, max: 64, int: true });
const STILL = v.still === undefined ? null : num('still', v.still, { min: 0 });
const FPS = num('fps', v.fps, { min: 1, max: 100 });

const TYPES = { spot: 'stage-evolution/minispot30', par: 'user/glp-185l', laser: 'stage-evolution/laserscan300', ball: 'user/twinkle-ball' };
let only = null;
if (v.only !== undefined) {
  only = new Set(v.only.split(',').map((s) => s.trim()).filter(Boolean));
  const bad = [...only].filter((s) => !(s in TYPES));
  if (bad.length || !only.size) fail(`--only accepts ${Object.keys(TYPES).join(', ')} (got "${v.only}")`);
}

// ------------------------------------------------------------ パッチ
const patch = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/patch.json'), 'utf8'));
const byType = (type) => (only && !only.has(type) ? [] : patch.fixtures.filter((f) => f.profile === TYPES[type]));
const spots = byType('spot');
const pars = byType('par');
const lasers = byType('laser');
const balls = byType('ball');

// 灯体ごとのユニバースに送る（ユニバースごとに512chのバッファ）
const universes = new Map();
for (const f of patch.fixtures) {
  const u = f.universe ?? 0;
  if (!universes.has(u)) universes.set(u, new Uint8Array(512));
}
const set = (f, vals) => {
  const buf = universes.get(f.universe ?? 0);
  vals.forEach((x, i) => (buf[f.address - 1 + i] = Math.max(0, Math.min(255, Math.round(x)))));
};

// ------------------------------------------------------------ Art-Net 送信
const sock = dgram.createSocket('udp4');
sock.on('error', (e) => fail(`UDP error: ${e.message}`));
sock.bind(() => sock.setBroadcast(true));
let seq = 0;

function send(universe, data) {
  const b = Buffer.alloc(18 + 512);
  b.write('Art-Net\0', 0, 'ascii');
  b.writeUInt16LE(0x5000, 8); // OpDmx
  b.writeUInt16BE(14, 10); // protocol version
  b[12] = seq;
  b[14] = universe & 0xff; // SubUni
  b[15] = (universe >> 8) & 0x7f; // Net
  b.writeUInt16BE(512, 16);
  Buffer.from(data).copy(b, 18);
  sock.send(b, PORT, HOST);
}

// ------------------------------------------------------------ 演出
const hsv = (h, s = 1, val = 1) => {
  const f = (n) => { const k = (n + h * 6) % 6; return val - val * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
};

const start = Date.now();
function tick() {
  const t = STILL ?? (Date.now() - start) / 1000;
  const beat = (t * BPM) / 60;
  const bar = Math.floor(beat / 4);
  const scene = SCENE ?? Math.floor(bar / BARS) % 4;

  spots.forEach((f, i) => {
    const ph = beat * 0.25 * Math.PI + i * (Math.PI / 2);
    const pan = 128 + Math.sin(ph) * (scene === 2 ? 30 : 18);
    const tilt = 128 + (i % 2 ? 1 : -1) * (40 + Math.cos(ph) * 25);
    const color = [10, 50, 70, 20, 0][(bar + i) % 5];
    const gobo = scene === 1 ? 8 + (i % 7) * 8 : scene === 3 ? 140 : 0;
    const dim = scene === 0 ? (Math.floor(beat) % 4 === i ? 255 : 40) : 255;
    set(f, [pan, tilt, color, gobo, 0, dim, 0, 0, 0]);
  });

  pars.forEach((f, i) => {
    // RGBWA（ディマーなし）
    const [r, g, b] = hsv((beat / 16 + i * 0.12) % 1);
    const pulse = 0.35 + 0.65 * Math.pow(1 - (beat % 1), 2);
    set(f, [r * pulse, g * pulse, b * pulse, 0, scene === 3 ? 120 * pulse : 0]);
  });

  balls.forEach((f) => {
    // TWINKLE BALL DMX 8ch: dimmer, strobe, R, G, B, motor, program, programSpeed
    const [r, g, b] = hsv((beat / 32) % 1);
    set(f, [scene === 2 ? 0 : 220, 0, r, g, b, 170, scene === 3 ? 174 : 0, 128]);
  });

  lasers.forEach((f, i) => {
    const on = scene !== 0;
    const pattern = ((bar + i * 3) % 16) * 16;
    const group = scene === 3 ? 64 : 0;
    const color = scene === 1 ? 8 + ((bar + i) % 7) * 8 : 120;
    const zrot = scene === 2 ? 200 : 0;
    set(f, [on ? 255 : 0, group, pattern, color, 0, 40, 0, 0, 0, 0, 0, zrot, scene === 2 ? 60 : 0, 130, 220, 64, 0]);
  });

  seq = (seq % 255) + 1;
  for (const [u, data] of universes) send(u, data);
}

setInterval(tick, 1000 / FPS);

const parts = [
  `→ ${HOST}:${PORT}`,
  `universe ${[...universes.keys()].join(', ')}`,
  `BPM ${BPM}`,
  SCENE === null ? `looks cycle every ${BARS} bars` : `look ${SCENE + 1}`,
  only ? `only ${[...only].join(', ')}` : null,
  STILL === null ? null : `frozen at t=${STILL}s`,
].filter(Boolean);
console.log(`Sending Art-Net demo ${parts.join(' · ')}  (Ctrl+C to stop)`);
