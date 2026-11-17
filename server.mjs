// DMX照明シミュレータ: Art-Net受信 + HTTP/SSE配信サーバ（依存なし）
//
//   node server.mjs [--http 8080] [--artnet 6454] [--bind 0.0.0.0] [--advertise host,ip,...]
//
// Art-Net (UDP 6454) で受けた ArtDmx をユニバースごとに保持し、
// ブラウザへ Server-Sent Events で送る。ArtPoll には ArtPollReply を返すので
// コンソール側のノード検索にも表示される。

import dgram from 'node:dgram';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const HTTP_PORT = Number(arg('http', process.env.HTTP_PORT || 8080));
const ARTNET_PORT = Number(arg('artnet', process.env.ARTNET_PORT || 6454));
const BIND = arg('bind', '0.0.0.0');
// 画面と ArtPollReply に出す送信先アドレス。コンテナ内などで、自分のインターフェイスの IP
// （Pod の IP など）が外から届かないときに、LoadBalancer の IP や DNS 名を指定する。
const ADVERTISE = String(arg('advertise', process.env.ADVERTISE || ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const isIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const PUSH_HZ = 44; // ブラウザへ送る最大レート

// ---------------------------------------------------------------- DMX state
/** @type {Map<number, {data: Uint8Array, dirty: boolean, from: string, seq: number, last: number, count: number}>} */
const universes = new Map();
const stats = { packets: 0, polls: 0, lastFrom: '', startedAt: Date.now() };

function universe(u) {
  let s = universes.get(u);
  if (!s) {
    s = { data: new Uint8Array(512), dirty: true, from: '', seq: 0, last: 0, count: 0 };
    universes.set(u, s);
  }
  return s;
}

// ---------------------------------------------------------------- Art-Net
const ARTNET_ID = Buffer.from('Art-Net\0', 'ascii');
const OP_POLL = 0x2000;
const OP_POLL_REPLY = 0x2100;
const OP_DMX = 0x5000;

const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udp.on('message', (msg, rinfo) => {
  if (msg.length < 12 || !msg.subarray(0, 8).equals(ARTNET_ID)) return;
  const op = msg.readUInt16LE(8);
  if (op === OP_DMX) {
    if (msg.length < 18) return;
    const seq = msg[12];
    const portAddr = ((msg[15] & 0x7f) << 8) | msg[14]; // Net:SubNet:Universe (15bit)
    const len = Math.min(msg.readUInt16BE(16), msg.length - 18, 512);
    const u = universe(portAddr);
    // 内容が変わったときだけ dirty にする
    const incoming = msg.subarray(18, 18 + len);
    for (let i = 0; i < len; i++) {
      if (u.data[i] !== incoming[i]) { u.data.set(incoming); u.dirty = true; break; }
    }
    u.from = rinfo.address;
    u.seq = seq;
    u.last = Date.now();
    u.count++;
    stats.packets++;
    stats.lastFrom = rinfo.address;
  } else if (op === OP_POLL) {
    stats.polls++;
    sendPollReply(rinfo.address);
  }
});

function localIPv4() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) return { ...ni };
  }
  return { address: '127.0.0.1', mac: '00:00:00:00:00:00' };
}

function sendPollReply(to) {
  const ni = localIPv4();
  const advertised = ADVERTISE.find(isIPv4);
  if (advertised) ni.address = advertised;
  const b = Buffer.alloc(239);
  ARTNET_ID.copy(b, 0);
  b.writeUInt16LE(OP_POLL_REPLY, 8);
  ni.address.split('.').forEach((v, i) => (b[10 + i] = Number(v)));
  b.writeUInt16LE(ARTNET_PORT, 14);
  b.writeUInt16BE(1, 16); // VersInfo
  b[18] = 0; // NetSwitch
  b[19] = 0; // SubSwitch
  b.writeUInt16BE(0xffff, 20); // Oem: unknown
  b[23] = 0xd0; // Status1: indicators normal, network config
  b.write('DMX SIM', 26, 17, 'ascii');
  b.write('DMX Lighting Simulator (Art-Net -> 3D view)', 44, 63, 'ascii');
  b.write(`#0001 [${String(stats.packets % 10000).padStart(4, '0')}] OK`, 108, 63, 'ascii');
  b.writeUInt16BE(4, 172); // NumPorts
  for (let i = 0; i < 4; i++) {
    b[174 + i] = 0x80; // PortTypes: output DMX512
    b[182 + i] = 0x80; // GoodOutput: data being transmitted
    b[190 + i] = i; // SwOut: universe 0..3
  }
  b[200] = 0x00; // Style: StNode
  (ni.mac || '0:0:0:0:0:0').split(':').forEach((v, i) => (b[201 + i] = parseInt(v, 16) || 0));
  ni.address.split('.').forEach((v, i) => (b[207 + i] = Number(v))); // BindIp
  b[211] = 1; // BindIndex
  b[212] = 0x08; // Status2: supports 15-bit port address
  udp.send(b, ARTNET_PORT, to);
}

udp.on('error', (e) => {
  console.error(`[artnet] UDP ${ARTNET_PORT} error: ${e.message}`);
  if (e.code === 'EADDRINUSE') console.error('  Another Art-Net application may already be using this port.');
});
udp.bind(ARTNET_PORT, BIND, () => {
  udp.setBroadcast(true);
  console.log(`[artnet] Listening on UDP ${BIND}:${ARTNET_PORT}`);
});

// ---------------------------------------------------------------- HTTP + SSE
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
// URLプレフィックス → ディレクトリ
const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/')],
  ['/config/', path.join(ROOT, 'config/')],
  ['/assets/', ROOT + '/'], // commons.svg, layout.png
  ['/', path.join(ROOT, 'public/')],
];

/** @type {Set<http.ServerResponse>} */
const clients = new Set();

function serveStatic(req, res) {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    let rel = url.slice(prefix.length) || 'index.html';
    if (prefix === '/assets/' && !/^[\w.-]+\.(svg|png)$/.test(rel)) break; // ルート直下の図面のみ公開
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) break;
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
}

function statusJson() {
  const now = Date.now();
  return {
    http: HTTP_PORT,
    artnet: ARTNET_PORT,
    addresses: ADVERTISE.length
      ? ADVERTISE
      : Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4').map((n) => n.address),
    packets: stats.packets,
    polls: stats.polls,
    lastFrom: stats.lastFrom,
    universes: [...universes.entries()].map(([u, s]) => ({ universe: u, from: s.from, ageMs: s.last ? now - s.last : null, count: s.count })),
  };
}

const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    // 接続直後に全ユニバースを送る
    for (const [u, s] of universes) res.write(`event: dmx\ndata: ${u} ${Buffer.from(s.data).toString('base64')}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statusJson()));
    return;
  }
  serveStatic(req, res);
});

setInterval(() => {
  for (const [u, s] of universes) {
    if (!s.dirty) continue;
    s.dirty = false;
    const line = `event: dmx\ndata: ${u} ${Buffer.from(s.data).toString('base64')}\n\n`;
    for (const c of clients) c.write(line);
  }
}, 1000 / PUSH_HZ);

setInterval(() => {
  const line = `event: status\ndata: ${JSON.stringify(statusJson())}\n\n`;
  for (const c of clients) c.write(line);
}, 1000);

server.listen(HTTP_PORT, () => {
  console.log(`[http]   Open the simulator at http://localhost:${HTTP_PORT}/`);
  const addrs = statusJson().addresses.filter((a) => a !== '127.0.0.1');
  if (addrs.length) console.log(`[artnet] Send Art-Net to: ${addrs.join(', ')}${ADVERTISE.length ? '' : ' (or 127.0.0.1 / broadcast)'}`);
});

// コンテナの PID 1 で動くとき、シグナルに既定の処理がないので自分で終了する
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    udp.close();
    process.exit(0);
  });
}
