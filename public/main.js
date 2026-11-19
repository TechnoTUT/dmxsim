import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadFloorplan, buildVenue, buildProps, makeRaycaster } from './venue.js';
import { createFixture, shared, ceilingUniform } from './fixtures.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const prefs = (() => { try { return JSON.parse(localStorage.getItem('dmxsim.view') || '{}') ?? {}; } catch { return {}; } })();

// ------------------------------------------------------------ 設定読み込み
const [profiles, patch] = await Promise.all([
  fetch('/config/profiles.json').then((r) => r.json()),
  fetch('/config/patch.json').then((r) => r.json()),
]);
const ceiling = patch.venue?.ceiling ?? 3.2;
const plan = await loadFloorplan(patch.venue?.floorplan ?? '/assets/commons.svg');

// ------------------------------------------------------------ レンダラ・シーン
const powerPreference = prefs.gpu === 'high-performance' ? 'high-performance' : 'low-power';
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference, preserveDrawingBuffer: params.has('shot') });
function showGpuRenderer() {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  $('#gpu-renderer').textContent = (info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || 'Unavailable in this browser';
}
showGpuRenderer();
renderer.domElement.addEventListener('webglcontextrestored', showGpuRenderer);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('#view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050608);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 200);

// ------------------------------------------------------------ 一人称カメラ（その場で首を振る）
// 左ドラッグ: 向きを変える / 右ドラッグ: 上下左右に平行移動 / ホイール: 前後移動
const look = { yaw: 0, pitch: 0 };
const PITCH_MAX = 89.5 * (Math.PI / 180);
function applyLook() {
  look.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, look.pitch));
  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
}
function lookAt(target) {
  const d = new THREE.Vector3(...target).sub(camera.position).normalize();
  look.yaw = Math.atan2(-d.x, -d.z);
  look.pitch = Math.asin(d.y);
  applyLook();
}
{
  const el = renderer.domElement;
  let drag = null;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    drag = { button: e.button, x: e.clientX, y: e.clientY };
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.button === 0) {
      // マウスを動かした方向を向く（右へドラッグ→右を向く、下へ→下を向く）
      look.yaw -= dx * 0.0035;
      look.pitch -= dy * 0.0035;
      applyLook();
    } else {
      const k = 0.01;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      camera.position.y = Math.max(0.3, camera.position.y);
    }
  });
  const end = () => (drag = null);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    camera.position.addScaledVector(f, -Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) * 0.01));
    camera.position.y = Math.max(0.3, camera.position.y);
  }, { passive: false });
}

const ambient = new THREE.HemisphereLight(0x8090b0, 0x101014, 0.25);
scene.add(ambient);
const work = new THREE.DirectionalLight(0xffffff, 0);
work.position.set(5, 20, 5);
scene.add(work);

const venue = buildVenue(plan, { ceiling });
scene.add(venue.group);
const props = buildProps(patch.props);
scene.add(props.group);
const cast = makeRaycaster([...venue.colliders, ...props.colliders], ceiling);

// ------------------------------------------------------------ 灯体
ceilingUniform.value = ceiling;
const ctx = { scene, cast, ceiling, bounds: venue.bounds };
const fixtures = [];
for (const cfg of patch.fixtures) {
  const prof = profiles[cfg.profile];
  if (!prof) { console.warn('Profile not found:', cfg.profile); continue; }
  fixtures.push(createFixture(cfg, prof, ctx));
}

// アドレス重複チェック
const warnings = [];
{
  const used = new Map();
  for (const f of fixtures) {
    for (let i = 0; i < f.values.length; i++) {
      const k = `${f.cfg.universe}:${f.cfg.address + i}`;
      if (used.has(k) && used.get(k) !== f) warnings.push(`Address overlap: ${f.cfg.name} and ${used.get(k).cfg.name} (U${f.cfg.universe} ch${f.cfg.address + i})`);
      used.set(k, f);
    }
    if (f.cfg.address + f.values.length - 1 > 512) warnings.push(`${f.cfg.name}: exceeds channel 512`);
  }
}
$('#warnings').innerHTML = [...new Set(warnings)].map((w) => `<div>⚠ ${w}</div>`).join('');

// ------------------------------------------------------------ ポストプロセス
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------ カメラプリセット
const cx = (plan.grid.x0 + plan.grid.x1) / 2;
const cams = {
  overview: { pos: [cx - 9, 12, -4], target: [cx, 0.5, 10] },
  audience: { pos: [cx, 1.6, 3.2], target: [cx, 1.8, 13.5] },
  dj: { pos: [cx - 0.1, 1.7, 13.7], target: [cx, 1.6, 4] },
  top: { pos: [cx, 26, 9.01], target: [cx, 0, 9] },
};
function setCam(name) {
  const c = cams[name];
  camera.position.set(...c.pos);
  lookAt(c.target);
  document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.cam === name));
}
setCam(params.get('cam') || 'overview');
$('#cams').addEventListener('click', (e) => e.target.dataset.cam && setCam(e.target.dataset.cam));

// ------------------------------------------------------------ Art-Net (SSE)
const universes = new Map();
let lastStatus = null;

function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function applyUniverse(u, data) {
  const isNew = !universes.has(u);
  universes.set(u, data);
  for (const f of fixtures) if ((f.cfg.universe ?? 0) === u) f.setDmx(data);
  if (isNew) refreshUniverseSelect();
}

const es = new EventSource('/events');
es.addEventListener('dmx', (e) => {
  const sp = e.data.indexOf(' ');
  applyUniverse(Number(e.data.slice(0, sp)), b64ToBytes(e.data.slice(sp + 1)));
});
es.addEventListener('status', (e) => {
  lastStatus = JSON.parse(e.data);
  renderStatus();
});
es.onerror = () => { lastStatus = null; renderStatus(true); };

let prevPackets = 0;
let pps = 0;
function renderStatus(err = false) {
  const dot = $('#st-dot');
  const txt = $('#st-text');
  if (err || !lastStatus) {
    dot.className = 'dot bad';
    txt.textContent = 'Cannot reach the server (start it with npm run serve)';
    return;
  }
  const s = lastStatus;
  pps = Math.max(0, s.packets - prevPackets);
  prevPackets = s.packets;
  const live = s.universes.filter((u) => u.ageMs !== null && u.ageMs < 2000);
  if (live.length) {
    dot.className = 'dot ok';
    txt.textContent = `Art-Net receiving ${pps} pkt/s · ${live.map((u) => `U${u.universe}`).join(' ')} · from ${s.lastFrom}`;
  } else if (s.universes.length) {
    dot.className = 'dot idle';
    txt.textContent = `Art-Net stopped (holding last values) · from ${s.lastFrom}`;
  } else {
    dot.className = 'dot idle';
    txt.textContent = `Waiting for Art-Net · UDP ${s.artnet} · ${s.addresses.filter((a) => a !== '127.0.0.1').join(', ')}`;
  }
  $('#net-info').textContent = `${s.addresses.join('\n')}\nUDP ${s.artnet}`;
}

// ------------------------------------------------------------ パネル: 灯体
const list = $('#fixture-list');
const swatchColor = new THREE.Color();
let selected = null;
const rows = fixtures.map((f) => {
  const li = document.createElement('li');
  const n = f.values.length;
  li.innerHTML = `
    <div class="fx-head">
      <div class="swatch"></div>
      <div class="fx-name"><b>${f.cfg.name}</b><span class="sub"></span></div>
      <div class="fx-addr">U${f.cfg.universe ?? 0}<br>${f.cfg.address}–${f.cfg.address + n - 1}</div>
    </div>
    <div class="fx-ch">
      ${f.profile.channels.map((c, i) => `<div class="ch"><span class="n">${i + 1}</span><span class="bar"><i></i><span>${c.name}</span></span><span class="v">0</span></div>`).join('')}
      ${f.profile.assumed ? `<div class="assumed">⚠ ${f.profile.source}</div>` : `<div class="muted" style="font-size:11px;margin-top:4px">${f.profile.source ?? ''}</div>`}
    </div>`;
  li.addEventListener('click', () => select(selected === f ? null : f));
  list.appendChild(li);
  return {
    f,
    li,
    swatch: li.querySelector('.swatch'),
    sub: li.querySelector('.sub'),
    bars: [...li.querySelectorAll('.ch i')],
    vals: [...li.querySelectorAll('.ch .v')],
  };
});

function select(f) {
  selected = f;
  for (const r of rows) r.li.classList.toggle('sel', r.f === f);
  if (f) rows.find((r) => r.f === f)?.li.scrollIntoView({ block: 'nearest' });
}

function updateFixturePanel() {
  for (const r of rows) {
    const f = r.f;
    const c = swatchColor.copy(f.color).multiplyScalar(0.25 + f.level * 0.75);
    r.swatch.style.background = f.level > 0.01 ? `#${c.getHexString(THREE.SRGBColorSpace)}` : '#111';
    r.swatch.style.boxShadow = f.level > 0.01 ? `0 0 ${4 + f.level * 10}px #${f.color.getHexString(THREE.SRGBColorSpace)}` : 'none';
    const status = `${Math.round(f.level * 100)}%  ${f.status}`;
    if (r.sub.textContent !== status) r.sub.textContent = status;
    if (f === selected) {
      for (let i = 0; i < f.values.length; i++) {
        r.bars[i].style.width = `${(f.values[i] / 255) * 100}%`;
        if (r.vals[i].textContent !== String(f.values[i])) r.vals[i].textContent = f.values[i];
      }
    }
  }
}

// クリックで灯体選択
const ray = new THREE.Raycaster();
const pick = fixtures.flatMap((f) => f.pickables.map((m) => ((m.userData.fixture = f), m)));
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects(pick, false)[0];
  if (hit) {
    select(hit.object.userData.fixture);
    showTab('fixtures');
    $('#panel').classList.add('open');
  }
});

// ------------------------------------------------------------ パネル: DMX
const grid = $('#dmx-grid');
const cells = [];
for (let i = 0; i < 512; i++) {
  const d = document.createElement('div');
  d.innerHTML = '<i></i><span>0</span>';
  d.title = `ch ${i + 1}`;
  grid.appendChild(d);
  cells.push({ d, bar: d.firstChild, txt: d.lastChild });
}
const uniSel = $('#dmx-universe');
const dmxInfo = $('#dmx-info');
let displayedDmx = null;
function refreshUniverseSelect() {
  const want = new Set([0, ...fixtures.map((f) => f.cfg.universe ?? 0), ...universes.keys()]);
  if (uniSel.options.length === want.size) return;
  const cur = uniSel.value || '0';
  uniSel.innerHTML = [...want].sort((a, b) => a - b).map((u) => `<option value="${u}">${u}</option>`).join('');
  uniSel.value = cur;
  markPatch();
}
function markPatch() {
  const u = Number(uniSel.value || 0);
  for (const c of cells) { c.d.classList.remove('used', 'start'); c.d.style.removeProperty('--fx'); }
  const hues = [210, 0, 120, 45, 280, 170, 330, 90, 20, 250, 60, 300];
  fixtures.forEach((f, k) => {
    if ((f.cfg.universe ?? 0) !== u) return;
    for (let i = 0; i < f.values.length; i++) {
      const c = cells[f.cfg.address - 1 + i];
      if (!c) continue;
      c.d.classList.add('used');
      c.d.style.setProperty('--fx', `hsl(${hues[k % hues.length]} 60% 55%)`);
      c.d.title = `ch ${f.cfg.address + i}: ${f.cfg.name} / ${f.profile.channels[i].name}`;
      if (i === 0) { c.d.classList.add('start'); c.d.dataset.addr = f.cfg.address; }
    }
  });
}
uniSel.addEventListener('change', markPatch);
refreshUniverseSelect();
markPatch();
function updateDmxPanel() {
  const data = universes.get(Number(uniSel.value || 0));
  if (data === displayedDmx) return;
  dmxInfo.textContent = data ? '' : 'Nothing received yet';
  for (let i = 0; i < 512; i++) {
    const v = data?.[i] ?? 0;
    if (v === (displayedDmx?.[i] ?? 0)) continue;
    cells[i].bar.style.height = `${(v / 255) * 100}%`;
    cells[i].txt.textContent = v;
  }
  displayedDmx = data;
}

// ------------------------------------------------------------ パネル: タブ・表示設定
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('#panel section').forEach((s) => s.classList.toggle('on', s.dataset.pane === name));
}
$('.tabs').addEventListener('click', (e) => e.target.dataset.tab && showTab(e.target.dataset.tab));
$('#panel-toggle').addEventListener('click', () => $('#panel').classList.toggle('open'));

const savePrefs = () => { try { localStorage.setItem('dmxsim.view', JSON.stringify(prefs)); } catch {} };
$('#gpu').value = powerPreference;
$('#gpu').addEventListener('change', (e) => {
  prefs.gpu = e.target.value;
  savePrefs();
  location.reload();
});
function bindPref(id, prop, apply) {
  const el = $(id);
  if (prefs[prop] !== undefined) el[el.type === 'checkbox' ? 'checked' : 'value'] = prefs[prop];
  const h = () => { const v = el.type === 'checkbox' ? el.checked : el.value; prefs[prop] = v; savePrefs(); apply(v); };
  el.addEventListener('input', h);
  h();
}
bindPref('#haze', 'haze', (v) => (shared.haze = Number(v)));
bindPref('#bloom', 'bloom', (v) => (shared.bloom = v));
bindPref('#shadows', 'shadows', (v) => {
  if (renderer.shadowMap.enabled === v) return;
  renderer.shadowMap.enabled = v;
  scene.traverse((object) => {
    if (object.isMesh) object.material.needsUpdate = true;
  });
});
bindPref('#walls', 'walls', (v) => {
  venue.wallGroup.visible = v !== 'off';
  venue.wallGroup.scale.y = v === 'low' ? 1.1 / ceiling : 1;
  scene.traverse((object) => {
    if (object.isSpotLight && object.castShadow) object.shadow.needsUpdate = true;
  });
});
bindPref('#worklight', 'work', (v) => { work.intensity = v ? 1.5 : 0; ambient.intensity = v ? 0.9 : 0.25; });
// フレームレート上限（0 = 無制限）。高リフレッシュレートの画面でGPUを使い切らないように
let fpsCap = 60;
bindPref('#fps', 'fps', (v) => (fpsCap = Number(v)));
bindPref('#quality', 'quality', (v) => { renderer.setPixelRatio(Math.min(devicePixelRatio, Number(v))); onResize(); });

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
}
addEventListener('resize', onResize);

// ------------------------------------------------------------ メインループ
// ------------------------------------------------------------ キーボード移動（WASD 前後左右 / Space 上 / Shift 下）
const keys = new Set();
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);
const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range';
addEventListener('keydown', (e) => {
  if (!MOVE_KEYS.has(e.code) || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  keys.add(e.code);
  e.preventDefault(); // Space でボタンが押されたりページがスクロールしたりしないように
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
function keyboardMove(dt) {
  if (!keys.size) return;
  camera.getWorldDirection(_fwd);
  _fwd.y = 0;
  // 真上から見下ろしているときは画面の上方向を「前」にする
  if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0);
  _fwd.normalize();
  _right.crossVectors(_fwd, UP).normalize();
  _move.set(0, 0, 0);
  if (keys.has('KeyW')) _move.add(_fwd);
  if (keys.has('KeyS')) _move.sub(_fwd);
  if (keys.has('KeyD')) _move.add(_right);
  if (keys.has('KeyA')) _move.sub(_right);
  if (keys.has('Space')) _move.y += 1;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) _move.y -= 1;
  if (!_move.lengthSq()) return;
  const speed = 4; // m/s
  _move.normalize().multiplyScalar(speed * dt);
  // 床より下には潜らない
  if (camera.position.y + _move.y < 0.3) _move.y = 0.3 - camera.position.y;
  camera.position.add(_move);
}

const clock = new THREE.Clock();
let uiTick = 0;
let nextFrameAt = 0;
function frame(now = performance.now()) {
  requestAnimationFrame(frame);
  if (fpsCap > 0) {
    // 次に描く時刻を一定間隔で進める（2ms の揺らぎは許容）。遅れたときは今を基準にやり直す
    if (now < nextFrameAt - 2) return;
    nextFrameAt = Math.max(nextFrameAt + 1000 / fpsCap, now);
  }
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  for (const f of fixtures) f.update(dt, t);
  keyboardMove(dt);
  if (shared.bloom) composer.render();
  else renderer.render(scene, camera);
  uiTick += dt;
  if (uiTick > 0.1) {
    uiTick = 0;
    if ($('[data-pane="fixtures"]').classList.contains('on')) updateFixturePanel();
    if ($('[data-pane="dmx"]').classList.contains('on')) updateDmxPanel();
  }
}
renderStatus();
frame();
window.__sim = { fixtures, scene, camera, setCam, applyUniverse, cast, plan, venue };
