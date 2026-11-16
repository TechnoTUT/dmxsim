// テスト用 Art-Net 送信機。patch.json の灯体に向けてデモ演出を送る。
//   node tools/artnet-demo.mjs [送信先IP=127.0.0.1] [--bpm 128] [--still 秒]
// --still を付けるとその時刻の状態で止める（スクリーンショット用）。
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const patch = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/patch.json'), 'utf8'));
const args = process.argv.slice(2);
const host = args.find((a) => !a.startsWith('--') && !/^\d+(\.\d+)?$/.test(a)) || '127.0.0.1';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
const BPM = opt('bpm', 128);
const STILL = opt('still', NaN);

const sock = dgram.createSocket('udp4');
sock.bind(() => sock.setBroadcast(true));
const dmx = new Uint8Array(512);
let seq = 0;

function send(universe = 0) {
  const b = Buffer.alloc(18 + 512);
  b.write('Art-Net\0', 0, 'ascii');
  b.writeUInt16LE(0x5000, 8);
  b.writeUInt16BE(14, 10);
  b[12] = (seq = (seq % 255) + 1);
  b[14] = universe & 0xff;
  b[15] = (universe >> 8) & 0x7f;
  b.writeUInt16BE(512, 16);
  Buffer.from(dmx).copy(b, 18);
  sock.send(b, 6454, host);
}

const set = (addr, vals) => vals.forEach((v, i) => (dmx[addr - 1 + i] = Math.max(0, Math.min(255, Math.round(v)))));
const byProfile = (p) => patch.fixtures.filter((f) => f.profile === p);
const spots = byProfile('stage-evolution/minispot30');
const pars = byProfile('user/glp-185l');
const lasers = byProfile('stage-evolution/laserscan300');
const balls = byProfile('user/twinkle-ball');

const hsv = (h, s = 1, v = 1) => {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
};

const start = Date.now();
function tick() {
  const t = Number.isFinite(STILL) ? STILL : (Date.now() - start) / 1000;
  const beat = (t * BPM) / 60;
  const bar = Math.floor(beat / 4);
  const scene = Math.floor(bar / 4) % 4; // 4小節ごとに演出切替

  spots.forEach((f, i) => {
    const ph = beat * 0.25 * Math.PI + i * (Math.PI / 2);
    const pan = 128 + Math.sin(ph) * (scene === 2 ? 30 : 18);
    const tilt = 128 + (i % 2 ? 1 : -1) * (40 + Math.cos(ph) * 25);
    const color = [10, 50, 70, 20, 0][(bar + i) % 5];
    const gobo = scene === 1 ? 8 + (i % 7) * 8 : scene === 3 ? 140 : 0;
    const dim = scene === 0 ? ((Math.floor(beat) % 4) === i ? 255 : 40) : 255;
    set(f.address, [pan, tilt, color, gobo, 0, dim, 0, 0, 0]);
  });

  pars.forEach((f, i) => {
    const [r, g, b] = hsv(((beat / 16) + i * 0.12) % 1);
    const pulse = 0.35 + 0.65 * Math.pow(1 - (beat % 1), 2);
    // RGBWA（ディマーなし）
    set(f.address, [r * pulse, g * pulse, b * pulse, 0, scene === 3 ? 120 * pulse : 0]);
  });

  balls.forEach((f) => {
    // TWINKLE BALL DMX 8ch: dimmer, strobe, R, G, B, motor, program, programSpeed
    const [r, g, b] = hsv((beat / 32) % 1);
    set(f.address, [scene === 2 ? 0 : 220, 0, r, g, b, 170, scene === 3 ? 174 : 0, 128]);
  });

  lasers.forEach((f, i) => {
    const on = scene !== 0;
    const pattern = ((bar + i * 3) % 16) * 16;
    const group = scene === 3 ? 64 : 0;
    const color = scene === 1 ? 8 + ((bar + i) % 7) * 8 : 120;
    const zrot = scene === 2 ? 200 : 0;
    set(f.address, [on ? 255 : 0, group, pattern, color, 0, 40, 0, 0, 0, 0, 0, zrot, scene === 2 ? 60 : 0, 130, 220, 64, 0]);
  });

  send(0);
}

setInterval(tick, 25);
console.log(`Sending Art-Net demo → ${host}:6454 (BPM ${BPM})${Number.isFinite(STILL) ? ` [still t=${STILL}s]` : ''}  Press Ctrl+C to stop`);
