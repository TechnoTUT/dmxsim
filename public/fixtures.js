// 灯体モデル。DMX値（その灯体のチャンネル分のスライス）を受け取り、見た目に反映する。
import * as THREE from 'three';
import { getPattern } from './laser-patterns.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const inRange = (v, a, b) => v >= a && v <= b;

// ------------------------------------------------------------ 共有リソース

/** plan(x, y, h) → world Vector3 */
export const P = (x, y, h) => new THREE.Vector3(x, h, y);

let glowTex;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

function makeGlow() {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(0.4);
  return s;
}

/** ゴボ画像（0=オープン）。白=光が通る。 */
const goboCache = [];
export function goboTexture(i) {
  if (goboCache[i]) return goboCache[i];
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  const R = S * 0.48;
  const disc = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  switch (i) {
    case 0: disc(0, 0, R); break;
    case 1: for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; disc(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62, R * 0.2); } disc(0, 0, R * 0.18); break;
    case 2: for (let k = 0; k < 3; k++) { g.save(); g.rotate((k / 3) * Math.PI * 2); g.beginPath(); g.moveTo(R * 0.12, 0); g.lineTo(R * 0.95, -R * 0.42); g.lineTo(R * 0.95, R * 0.42); g.closePath(); g.fill(); g.restore(); } break;
    case 3: g.lineWidth = R * 0.07; for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2); g.lineTo(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95); g.stroke(); } break;
    case 4: g.lineWidth = R * 0.1; for (let k = 0; k < 4; k++) { g.save(); g.rotate((k / 4) * Math.PI * 2); g.beginPath(); for (let t = 0; t < 1; t += 0.02) { const a = t * 2.4, r = R * (0.1 + 0.85 * t); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke(); g.restore(); } break;
    case 5: g.lineWidth = R * 0.09; for (const r of [0.25, 0.52, 0.82]) { g.beginPath(); g.arc(0, 0, R * r, 0, Math.PI * 2); g.stroke(); } break;
    case 6: for (let k = 0; k < 6; k++) { g.save(); g.rotate((k / 6) * Math.PI * 2); g.beginPath(); g.ellipse(R * 0.5, 0, R * 0.42, R * 0.16, 0, 0, Math.PI * 2); g.fill(); g.restore(); } break;
    case 7: { let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); for (let k = 0; k < 26; k++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R * 0.85; disc(Math.cos(a) * r, Math.sin(a) * r, R * (0.05 + rnd() * 0.1)); } break; }
  }
  // 外周をマスク
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  goboCache[i] = tex;
  return tex;
}

// ---- ボリュームビーム（コーン内部をレイマーチしてヘイズ中の光を描く）

const beamGeo = (() => {
  // 頂点が原点、+Z方向に長さ1、半径1の円錐（底面あり）
  const g = new THREE.ConeGeometry(1, 1, 40, 1, false);
  g.translate(0, -0.5, 0);
  g.rotateX(-Math.PI / 2);
  return g;
})();

const BEAM_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform sampler2D uGobo;
uniform float uGoboRot;
uniform mat4 uInvModel;
uniform float uCeiling;
uniform float uLength;
uniform float uSpread;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 ro = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
  vec3 pb = (uInvModel * vec4(vWorld, 1.0)).xyz;
  vec3 rd = pb - ro;
  float tEnter = 1.0;
  float a = rd.x * rd.x + rd.y * rd.y - rd.z * rd.z;
  float b = 2.0 * (ro.x * rd.x + ro.y * rd.y - ro.z * rd.z);
  float c = ro.x * ro.x + ro.y * ro.y - ro.z * ro.z;
  if (abs(a) > 1e-7) {
    float disc = b * b - 4.0 * a * c;
    if (disc >= 0.0) {
      float s = sqrt(disc);
      float t1 = (-b - s) / (2.0 * a);
      float t2 = (-b + s) / (2.0 * a);
      float z1 = ro.z + rd.z * t1;
      float z2 = ro.z + rd.z * t2;
      if (z1 >= 0.0 && z1 <= 1.0) tEnter = min(tEnter, t1);
      if (z2 >= 0.0 && z2 <= 1.0) tEnter = min(tEnter, t2);
    }
  }
  if (abs(rd.z) > 1e-7) {
    float t = (1.0 - ro.z) / rd.z;
    vec2 q = ro.xy + rd.xy * t;
    if (dot(q, q) <= 1.0) tEnter = min(tEnter, t);
  }
  tEnter = clamp(tEnter, 0.0, 1.0);
  float worldLen = length(vWorld - cameraPosition) * (1.0 - tEnter);

  const int STEPS = 32;
  float dt = (1.0 - tEnter) / float(STEPS);
  float jitter = hash(gl_FragCoord.xy);
  float cr = cos(uGoboRot), sr = sin(uGoboRot);
  float acc = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float t = tEnter + dt * (float(i) + jitter);
    // 天井より上・床より下のサンプルは数えない（光が天井を抜けない）
    float wy = mix(cameraPosition.y, vWorld.y, t);
    if (wy > uCeiling || wy < 0.0) continue;
    vec3 p = ro + rd * t;
    float z = max(p.z, 1e-4);
    vec2 q = p.xy / z;
    float r = length(q);
    if (r > 1.0) continue;
    vec2 uv = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y) * 0.5 + 0.5;
    float g = texture2D(uGobo, uv).r;
    float edge = smoothstep(1.0, 0.75, r);
    float d = z * uLength;
    float fall = 1.0 / (0.12 + d * d * 0.22);
    acc += g * edge * fall;
  }
  acc *= worldLen / float(STEPS) * uSpread;
  gl_FragColor = vec4(uColor * uIntensity * acc, 1.0);
}`;

export const shared = { haze: 1.5, bloom: true };
/** 全ビームで共有する天井高 uniform（main.js が patch.json の値を入れる） */
export const ceilingUniform = { value: 3.2 };

class Beam {
  constructor(scene, halfAngleRad) {
    this.half = halfAngleRad;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 0 },
        uGobo: { value: goboTexture(0) },
        uGoboRot: { value: 0 },
        uInvModel: { value: new THREE.Matrix4() },
        uLength: { value: 10 },
        uSpread: { value: (Math.tan(6 * DEG) / Math.tan(halfAngleRad)) ** 1.2 },
        uCeiling: ceilingUniform,
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(beamGeo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this._t = new THREE.Vector3();
  }
  set(origin, dir, length, color, intensity, gobo = 0, goboRot = 0) {
    const m = this.mesh;
    m.visible = intensity > 0.002;
    if (!m.visible) return;
    m.position.copy(origin);
    m.lookAt(this._t.copy(origin).add(dir));
    const r = Math.tan(this.half) * length;
    m.scale.set(r, r, length);
    m.updateMatrixWorld();
    const u = this.mat.uniforms;
    u.uInvModel.value.copy(m.matrixWorld).invert();
    u.uLength.value = length;
    u.uColor.value.copy(color);
    u.uIntensity.value = intensity * shared.haze;
    u.uGobo.value = goboTexture(gobo);
    u.uGoboRot.value = goboRot;
  }
}

// ---- 細いビーム（ツインクルボール用、インスタンス描画）

const THIN_VERT = /* glsl */ `
varying float vZ;
varying float vFacing;
varying float vY;
varying float vCam;
attribute vec3 aMask;
varying vec3 vMask;
void main() {
  vMask = aMask;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  vFacing = abs(dot(n, normalize(cameraPosition - w.xyz)));
  vZ = position.z;
  vY = w.y;
  vCam = length(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const THIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uCeiling;
varying float vZ;
varying float vFacing;
varying float vY;
varying float vCam;
varying vec3 vMask;
void main() {
  if (vY > uCeiling) discard;
  // カメラ直近を通るビームが太い帯に見えないようにフェード
  float a = pow(1.0 - clamp(vZ, 0.0, 1.0), 2.2) * pow(vFacing, 3.0) * smoothstep(1.5, 6.0, vCam);
  // ビームごとに R/G/B どれか1色（aMask）だけを出す
  gl_FragColor = vec4(uColor * vMask * uIntensity * a, 1.0);
}`;

// ---- 着弾スポット（ミラーボールの光が床・壁に当たった点。インスタンス描画）
const SPOT_VERT = /* glsl */ `
attribute vec3 aMask;
attribute float aGain;
varying vec2 vUv;
varying vec3 vMask;
varying float vGain;
void main() {
  vUv = uv;
  vMask = aMask;
  vGain = aGain;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const SPOT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vMask;
varying float vGain;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.45, r);
  gl_FragColor = vec4(uColor * vMask * uIntensity * vGain * a, 1.0);
}`;

// ------------------------------------------------------------ 灯体ベース

class Fixture {
  constructor(cfg, profile, ctx) {
    this.cfg = cfg;
    this.profile = profile;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.position.copy(P(cfg.x, cfg.y, cfg.h));
    ctx.scene.add(this.root);
    this.values = new Uint8Array(profile.channels.length);
    this.color = new THREE.Color();
    this.level = 0; // UI表示用 0..1
    this.status = '';
    this.pickables = [];
  }
  ch(key) {
    const i = this.profile.channels.findIndex((c) => c.key === key);
    return i >= 0 ? this.values[i] : 0;
  }
  setDmx(universeData) {
    const a = this.cfg.address - 1;
    for (let i = 0; i < this.values.length; i++) this.values[i] = universeData[a + i] ?? 0;
  }
  bodyMat() {
    return new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.4 });
  }
}

const strobeGate = (t, hz, duty = 0.12) => ((t * hz) % 1) < duty;

// ------------------------------------------------------------ ムービングスポット

export class MovingSpot extends Fixture {
  constructor(cfg, profile, ctx) {
    super(cfg, profile, ctx);
    const hang = (cfg.mount ?? 'hang') === 'hang';
    const mat = this.bodyMat();
    this.root.rotation.y = -(cfg.yaw ?? 0) * DEG;
    const mount = new THREE.Group();
    if (hang) mount.rotation.x = Math.PI; // 天吊り: ベース法線が下向き
    this.root.add(mount);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.17), mat);
    base.position.y = 0.05;
    mount.add(base);
    this.yoke = new THREE.Group();
    this.yoke.position.y = 0.1;
    mount.add(this.yoke);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.08), mat);
      arm.position.set(sx * 0.11, 0.1, 0);
      this.yoke.add(arm);
    }
    this.head = new THREE.Group();
    this.head.position.y = 0.16;
    this.yoke.add(this.head);
    const headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.2, 20), mat);
    this.head.add(headMesh);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false }));
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = 0.101;
    this.head.add(lens);
    this.lensMat = lens.material;
    this.pickables.push(base, headMesh);

    this.beam = new Beam(ctx.scene, (profile.beamAngle / 2) * DEG);
    this.glow = makeGlow();
    ctx.scene.add(this.glow);

    this.light = new THREE.SpotLight(0xffffff, 0, 40, (profile.beamAngle / 2) * DEG * 1.08, 0.25, 1.6);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.2;
    this.light.shadow.camera.far = 40;
    this.light.shadow.bias = -0.002;
    this.light.map = goboTexture(0);
    ctx.scene.add(this.light, this.light.target);

    // 状態（実機のモーター追従を模擬）
    this.pan = 0;
    this.tilt = 0;
    this.goboRot = 0;
    this.wheelPos = 0;
    this.auto = { pan: 0, tilt: 0, next: 0 };
    this.resetUntil = 0;
    this._o = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  update(dt, t) {
    const p = this.profile;
    let pan = this.ch('pan'), tilt = this.ch('tilt');
    const speed = this.ch('ptSpeed');
    const program = this.ch('program');
    const mv = this.ch('reset');
    let colorV = this.ch('color'), goboV = this.ch('gobo');

    // ch9: ムーブメント / リセット
    if (inRange(mv, 250, 255) && this.resetUntil < t - 4) this.resetUntil = t + 3;
    const resetting = t < this.resetUntil;
    if (inRange(mv, 21, 249)) {
      const w = t * 0.35;
      if (mv <= 100 || mv >= 201) pan = 128 + Math.sin(w) * 100;
      if (mv >= 101) tilt = 128 + Math.sin(w * 1.3) * 80;
    }
    // ch8: 内蔵プログラム / サウンド（ランダムな動きで近似）
    if (program >= 60) {
      const interval = program >= 160 ? 0.47 : 1.6;
      if (t > this.auto.next) {
        this.auto.next = t + interval;
        this.auto.pan = Math.random() * 255;
        this.auto.tilt = 60 + Math.random() * 135;
        this.auto.color = Math.floor(Math.random() * 8) * 10;
        this.auto.gobo = Math.floor(Math.random() * 8) * 8;
      }
      pan = this.auto.pan; tilt = this.auto.tilt; colorV = this.auto.color; goboV = this.auto.gobo;
    }
    if (resetting) { pan = 128; tilt = 128; }

    // パン・チルトの追従（速度制限＋一次遅れ）
    const targetPan = (pan / 255 - 0.5) * p.panRange * DEG;
    const targetTilt = (tilt / 255 - 0.5) * p.tiltRange * DEG;
    const vmax = (p.maxPanSpeed ?? 300) * DEG * (1 - (speed / 255) * 0.93);
    const follow = (cur, tgt) => {
      const d = tgt - cur;
      const step = clamp(d * Math.min(1, dt * 10), -vmax * dt, vmax * dt);
      return cur + step;
    };
    this.pan = follow(this.pan, targetPan);
    this.tilt = follow(this.tilt, targetTilt);
    this.yoke.rotation.y = this.pan;
    this.head.rotation.x = this.tilt;

    // カラー
    const col = this._c;
    const entry = p.colorWheel.find(([a, b]) => inRange(colorV, a, b));
    let colorName = entry?.[3] ?? '';
    if (entry?.[2] === 'rainbow') {
      const rate = 0.2 + ((colorV - 140) / 115) * 3.0;
      this.wheelPos += dt * rate;
      const slots = p.colorWheel.slice(0, 8);
      const k = Math.floor(this.wheelPos) % slots.length;
      col.set(slots[k][2]);
    } else if (Array.isArray(entry?.[2])) {
      col.set(entry[2][0]).lerp(new THREE.Color(entry[2][1]), 0.5);
    } else col.set(entry?.[2] ?? '#ffffff');

    // ゴボ
    let gobo = 0;
    const ge = p.goboWheel.find(([a, b]) => inRange(goboV, a, b));
    if (ge?.[2] === 'rotate') {
      const rate = 0.15 + ((goboV - 128) / 127) * 2.5;
      this.goboWheel = (this.goboWheel ?? 0) + dt * rate;
      gobo = Math.floor(this.goboWheel) % 8;
    } else gobo = ge?.[2] ?? 0;
    let goboRot = 0;
    if (goboV >= 72 && goboV <= 127) {
      const pos = (goboV - 72) % 8;
      goboRot = Math.sin(t * (4 + pos * 2.5)) * 0.35; // シェイク
    }

    // 明るさ
    let level = this.ch('dimmer') / 255;
    const st = this.ch('strobe');
    if (inRange(st, 10, 249)) level *= strobeGate(t, 1 + ((st - 10) / 239) * 19) ? 1 : 0;
    if (resetting) level = 0;
    this.level = level;
    this.color.copy(col);
    this.status = `${colorName}${gobo ? ` / Gobo ${gobo}` : ''}`;

    // ビーム
    this.head.updateWorldMatrix(true, false);
    const o = this.head.localToWorld(this._o.set(0, 0.11, 0));
    const tip = this.head.localToWorld(new THREE.Vector3(0, 1.11, 0));
    const d = this._d.copy(tip).sub(o).normalize();
    const L = this.ctx.cast(o, d);
    this.beam.set(o, d, L, col, level * 1.0, gobo, goboRot);
    this.glow.position.copy(o).addScaledVector(d, 0.02);
    this.glow.material.color.copy(col).multiplyScalar(level);
    this.glow.scale.setScalar(0.25 + level * 0.25);
    this.glow.visible = level > 0.01;
    this.lensMat.color.copy(col).multiplyScalar(0.15 + level);

    this.light.position.copy(o);
    this.light.target.position.copy(o).addScaledVector(d, 5);
    this.light.color.copy(col);
    this.light.intensity = level * 180;
    this.light.map = goboTexture(gobo);
    // 投影の回転（ゴボのシェイク）。up ベクトルをビーム軸まわりに回す
    const ref = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
    const upv = new THREE.Vector3().crossVectors(d, ref).normalize().applyAxisAngle(d, goboRot + this.pan);
    this.light.shadow.camera.up.copy(upv);
  }
}

// ------------------------------------------------------------ パーライト

export class Par extends Fixture {
  constructor(cfg, profile, ctx) {
    super(cfg, profile, ctx);
    const mat = this.bodyMat();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.2, 20), mat);
    can.rotation.x = Math.PI / 2; // 筒を+Z向きに
    this.body = new THREE.Group();
    this.body.add(can);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20), new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false }));
    lens.position.z = 0.101;
    this.body.add(lens);
    this.lensMat = lens.material;
    this.root.add(this.body);
    this.pickables.push(can);
    const aim = cfg.aim ? P(cfg.aim[0], cfg.aim[1], cfg.aim[2]) : P(cfg.x, cfg.y, 0);
    this.dir = aim.clone().sub(this.root.position).normalize();
    this.body.lookAt(aim);

    this.beam = new Beam(ctx.scene, (profile.beamAngle / 2) * DEG);
    this.glow = makeGlow();
    ctx.scene.add(this.glow);
    this.light = new THREE.SpotLight(0xffffff, 0, 30, (profile.beamAngle / 2) * DEG * 1.15, 0.6, 1.6);
    ctx.scene.add(this.light, this.light.target);
    this._c = new THREE.Color();
  }
  update(dt, t) {
    // RGBWA（ディマーch無し）。W は白、A はアンバーとして加算混色
    const R = this.ch('red') / 255, G = this.ch('green') / 255, B = this.ch('blue') / 255;
    const W = this.ch('white') / 255, A = this.ch('amber') / 255;
    const c = this._c.setRGB(
      Math.min(1, R + W * 0.95 + A),
      Math.min(1, G + W * 0.95 + A * 0.55),
      Math.min(1, B + W * 0.9),
      THREE.SRGBColorSpace,
    );
    let level = this.profile.channels.some((ch) => ch.key === 'dimmer') ? this.ch('dimmer') / 255 : 1;
    const st = this.ch('strobe');
    if (st > 5) level *= strobeGate(t, 1 + (st / 255) * 19) ? 1 : 0;
    const peak = Math.max(c.r, c.g, c.b);
    const norm = peak > 0 ? c.clone().multiplyScalar(1 / peak) : c.clone();
    const out = level * peak;
    this.level = out;
    this.color.copy(norm);
    this.status = `RGBWA ${this.values.join(',')}`;
    const o = this.root.position.clone().addScaledVector(this.dir, 0.11);
    const L = this.ctx.cast(o, this.dir);
    this.beam.set(o, this.dir, L, norm, out * 0.7, 0, 0);
    this.glow.position.copy(o);
    this.glow.material.color.copy(norm).multiplyScalar(out);
    this.glow.scale.setScalar(0.3 + out * 0.3);
    this.glow.visible = out > 0.01;
    this.lensMat.color.copy(norm).multiplyScalar(0.15 + out);
    this.light.position.copy(o);
    this.light.target.position.copy(o).add(this.dir);
    this.light.color.copy(norm);
    this.light.intensity = out * 120;
  }
}

// ------------------------------------------------------------ ツインクルボール（LEDミラーボール系）

export class TwinkleBall extends Fixture {
  constructor(cfg, profile, ctx) {
    super(cfg, profile, ctx);
    const n = profile.beams ?? 64;
    // 半球ドーム（下向きに吊った状態）＋本体
    this.ballMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.15, metalness: 0.3, emissive: 0x000000, transparent: true, opacity: 0.9 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0925, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.ballMat);
    this.root.add(ball);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.0925, 0.0925, 0.06, 24), this.bodyMat());
    housing.position.y = 0.03;
    this.root.add(housing);
    this.pickables.push(ball, housing);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, Math.max(0.01, ctx.ceiling - cfg.h), 4), this.bodyMat());
    wire.position.y = (ctx.ceiling - cfg.h) / 2;
    this.root.add(wire);

    // ビーム方向（下半球中心にばらまく）
    this.dirs = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = -0.95 + (1.25 * i) / (n - 1); // -0.95 .. 0.3
      const r = Math.sqrt(1 - y * y);
      this.dirs.push(new THREE.Vector3(Math.cos(i * ga) * r, y, Math.sin(i * ga) * r));
    }
    this.mat = new THREE.ShaderMaterial({
      vertexShader: THIN_VERT,
      fragmentShader: THIN_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uIntensity: { value: 0 }, uCeiling: ceilingUniform },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const g = new THREE.ConeGeometry(1, 1, 8, 1, true);
    g.translate(0, -0.5, 0);
    g.rotateX(-Math.PI / 2);
    // 各ビームを赤・緑・青のLEDに割り当てる（RGBは混ざらず別々のビームとして出る）
    const mask = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) mask[i * 3 + (i % 3)] = 1;
    g.setAttribute('aMask', new THREE.InstancedBufferAttribute(mask, 3));
    this.inst = new THREE.InstancedMesh(g, this.mat, n);
    this.inst.frustumCulled = false;
    ctx.scene.add(this.inst);

    // 光が床・壁・天井に当たる点（ビームと同じ方向・同じ色の割り当て）
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.setAttribute('aMask', new THREE.InstancedBufferAttribute(mask.slice(), 3));
    this.spotGain = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    sg.setAttribute('aGain', this.spotGain);
    this.spotMat = new THREE.ShaderMaterial({
      vertexShader: SPOT_VERT,
      fragmentShader: SPOT_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uIntensity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide, // 光が当たった側からだけ見える（俯瞰で天井のスポットが浮かない）
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.spots = new THREE.InstancedMesh(sg, this.spotMat, n);
    this.spots.frustumCulled = false;
    ctx.scene.add(this.spots);
    this._n = new THREE.Vector3();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.rot = 0;
    this.autoHue = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }
  update(dt, t) {
    // TWINKLE BALL DMX 8chモード（取扱説明書 p.9）
    const prog = this.ch('program');
    const motor = this.ch('motor');
    let level = this.ch('dimmer') / 255;
    const c = this._c.setRGB(this.ch('red') / 255, this.ch('green') / 255, this.ch('blue') / 255, THREE.SRGBColorSpace);
    const status = [];

    // ch7 オート/サウンドプログラム（ch8 速度）：色を段階的に切り替えて近似
    if (prog >= 10) {
      const sound = prog >= 160;
      const no = sound ? (prog >= 190 ? 2 : 1) : Math.min(5, Math.floor((prog - 10) / 30) + 1);
      const rate = (sound ? 2 : 0.5) * (0.3 + (this.ch('programSpeed') / 255) * 3);
      this.autoHue += dt * rate;
      const step = Math.floor(this.autoHue);
      const palette = [0, 0.33, 0.66, 0.16, 0.5, 0.83, 0.08];
      c.setHSL(palette[(step + no) % palette.length], 1, 0.5);
      status.push(sound ? `Sound ${no}` : `Auto ${no}`);
    }

    // ch6 モーター：0-129 角度 / 130-139 リセット / 140-255 回転
    if (motor >= 140) {
      this.rot += dt * (0.3 + ((motor - 140) / 115) * 4.0);
      status.push('Rotating');
    } else {
      const target = motor >= 130 ? 0 : (motor / 129) * Math.PI * 2;
      const d = target - this.rot;
      this.rot += clamp(d, -3 * dt, 3 * dt);
      if (motor < 130) status.push(`Angle ${Math.round((motor / 129) * 360)}°`);
      else status.push('Motor reset');
    }

    const st = this.ch('strobe');
    if (st > 5) level *= strobeGate(t, 1 + (st / 255) * 19) ? 1 : 0;
    const peak = Math.max(c.r, c.g, c.b);
    const norm = peak > 0 ? c.clone().multiplyScalar(1 / peak) : c.clone();
    const out = level * peak;
    this.level = out;
    this.color.copy(norm);
    this.status = status.join(' / ');

    // R/G/B は混色せず、それぞれのビーム・ドットの明るさとして使う
    this.mat.uniforms.uColor.value.copy(c);
    // 本数が増えても空中のビーム全体が明るくなりすぎないよう、1本あたりを弱める
    this.mat.uniforms.uIntensity.value = level * shared.haze * 0.9 * Math.sqrt(64 / this.dirs.length);
    this.inst.visible = out > 0.002;
    this.ballMat.emissive.copy(norm).multiplyScalar(out * 0.6);
    this.spotMat.uniforms.uColor.value.copy(c);
    this.spotMat.uniforms.uIntensity.value = level * 1.6;
    this.spots.visible = level > 0.002;
    const o = this.root.position;
    const half = 0.25 * DEG;
    const spotHalf = 1.4 * DEG; // 着弾点の広がり（ドームのレンズで拡散）
    const n = this._n, ax = this._x, ay = this._y;
    for (let i = 0; i < this.dirs.length; i++) {
      const d = this._v.copy(this.dirs[i]).applyAxisAngle(UP, this.rot);
      const hitL = this.ctx.cast.hit(o, d, n);
      const L = Math.min(12, hitL); // 細いビームは遠くまで見えない
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      const r = Math.tan(half) * L;
      this._m.compose(o, this._q, this._s.set(r, r, L));
      this.inst.setMatrixAt(i, this._m);

      // 着弾スポット：面に沿った楕円（斜めに当たるほど入射方向に伸びる）
      const hp = this._p.copy(o).addScaledVector(d, hitL);
      const b = this.ctx.bounds;
      const outside = hitL >= this.ctx.cast.maxDist - 1e-3 || (b && (hp.x < b.x0 - 2 || hp.x > b.x1 + 2 || hp.z < b.y0 - 2 || hp.z > b.y1 + 2));
      if (outside) { this.spotGain.array[i] = 0; this.spots.setMatrixAt(i, this._m.makeScale(0, 0, 0)); continue; }
      const cos = Math.max(0.25, Math.abs(d.dot(n)));
      const rad = Math.max(0.04, Math.tan(spotHalf) * hitL);
      ax.copy(d).addScaledVector(n, -d.dot(n));
      if (ax.lengthSq() < 1e-8) ax.set(1, 0, 0).addScaledVector(n, -n.x);
      ax.normalize();
      ay.crossVectors(n, ax);
      this._m.makeBasis(ax.multiplyScalar(2 * rad / cos), ay.multiplyScalar(2 * rad), n);
      this._m.setPosition(hp.addScaledVector(n, 0.005));
      this.spots.setMatrixAt(i, this._m);
      this.spotGain.array[i] = 1 / (1 + hitL * hitL * 0.04);
    }
    this.inst.instanceMatrix.needsUpdate = true;
    this.spots.instanceMatrix.needsUpdate = true;
    this.spotGain.needsUpdate = true;
  }
}

// ------------------------------------------------------------ レーザー

const LASER_COLORS = ['#ff2020', '#20ff3c', '#ffee22', '#3050ff', '#b040ff', '#20e0ff', '#ffffff'].map((c) => new THREE.Color(c));
const MAXPTS = 260;

export class Laser extends Fixture {
  constructor(cfg, profile, ctx) {
    super(cfg, profile, ctx);
    const mat = this.bodyMat();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.08, 0.17), mat);
    this.root.add(body);
    this.pickables.push(body);
    const aim = cfg.aim ? P(cfg.aim[0], cfg.aim[1], cfg.aim[2]) : P(cfg.x, cfg.y - 5, cfg.h);
    this.fwd = aim.clone().sub(this.root.position).normalize();
    body.lookAt(aim);
    this.right = new THREE.Vector3().crossVectors(this.fwd, UP).normalize();
    this.upv = new THREE.Vector3().crossVectors(this.right, this.fwd).normalize();
    this.aperture = this.root.position.clone().addScaledVector(this.fwd, 0.1);

    const mkLines = (opacity) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXPTS * 6), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXPTS * 6), 3));
      const m = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      m.frustumCulled = false;
      ctx.scene.add(m);
      return m;
    };
    this.rays = mkLines(0.55);
    this.outline = mkLines(1.0);
    this.state = { zoom: 0, xr: 0, yr: 0, zr: 0, pan: 0, tilt: 0, draw: 0, color: 0, flash: 0, autoNext: 0, auto: null };
    this._d = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  update(dt, t) {
    const S = this.state;
    const v = (k) => this.ch(k);
    let mode = v('mode');
    const on = mode > 20;
    this.status = '';
    if (!on) { this.rays.visible = this.outline.visible = false; this.level = 0; this.status = 'OFF'; return; }
    this.rays.visible = this.outline.visible = true;

    let group = Math.floor(v('group') / 64);
    let index = Math.floor(v('pattern') / 16);
    let colorV = v('color');
    let zRotV = v('zRot'), zRotSpd = v('zRotSpeed');
    let sizeV = v('size');
    let drawV = v('draw');
    let panV = v('pan'), tiltV = v('tilt');
    if (mode <= 220) {
      // オート/サウンド：一定間隔でパターン・色をランダムに
      const fast = (mode >= 21 && mode <= 40) || (mode >= 101 && mode <= 120);
      if (t > S.autoNext || !S.auto) {
        S.autoNext = t + (fast ? 0.7 : 2.4);
        S.auto = { group: Math.floor(Math.random() * 2), index: Math.floor(Math.random() * 16), color: Math.floor(Math.random() * 7) * 8 + 8, z: Math.random() < 0.5 ? 0 : 200 };
      }
      group = S.auto.group; index = S.auto.index; colorV = S.auto.color;
      zRotV = S.auto.z; zRotSpd = S.auto.z ? 90 : 0; sizeV = 30; drawV = 0; panV = 64; tiltV = 64;
      this.status = 'AUTO ';
    }
    const pts = getPattern(group, index);

    // サイズ / ズーム
    let scale;
    const zs = 0.15 + (v('zoomSpeed') / 255) * 1.5;
    if (sizeV <= 127) scale = 1 - (sizeV / 127) * 0.95;
    else {
      S.zoom += dt * zs;
      const ph = S.zoom % 1;
      if (sizeV <= 169) scale = 0.05 + 0.95 * ph;
      else if (sizeV <= 209) scale = 1 - 0.95 * ph;
      else scale = 0.05 + 0.95 * (0.5 - 0.5 * Math.cos(S.zoom * Math.PI));
    }
    // ロール（X/Y/Z）
    const roll = (val, spd, key) => {
      if (val <= 127) return (val / 127) * Math.PI * 2;
      const dir = val <= 191 ? 1 : -1;
      S[key] += dt * dir * (0.1 + (spd / 255) * 2.0) * Math.PI * 2;
      return S[key];
    };
    const ax = roll(v('xRoll'), v('xRollSpeed'), 'xr');
    const ay = roll(v('yRoll'), v('yRollSpeed'), 'yr');
    let az;
    if (zRotSpd === 0) az = zRotV <= 191 ? (zRotV / 191) * Math.PI * 2 : 0;
    else { S.zr += dt * (zRotV <= 191 ? -1 : 1) * (0.05 + (zRotSpd / 255) * 1.5) * Math.PI * 2; az = S.zr; }
    // パン/チルト（0-127 位置、128- 自動の動き）
    const move = (val, spd, key) => {
      if (val <= 127) return (val / 127) * 2 - 1;
      S[key] += dt * (0.05 + (1 - spd / 255) * 1.2) * Math.PI * 2;
      return Math.sin(S[key]);
    };
    const panOff = move(panV, v('panSpeed'), 'pan');
    const tiltOff = move(tiltV, v('tiltSpeed'), 'tilt');

    // 描画（ペイントブラシ / 描画アニメ）
    let reveal = 1;
    if (drawV >= 1 && drawV <= 127) reveal = drawV / 127;
    else if (drawV >= 128) { S.draw += dt * (0.2 + ((drawV - 128) / 127) * 2.5); reveal = S.draw % 1.2; }

    // 色
    S.color += dt;
    let flashOn = true;
    const colorAt = (i, n, out) => {
      if (colorV <= 7) return out.copy(LASER_COLORS[Math.floor((i / n) * 3) % 3]);
      if (colorV <= 63) return out.copy(LASER_COLORS[Math.min(6, Math.floor((colorV - 8) / 8))]);
      if (colorV <= 111) return out.copy(LASER_COLORS[Math.floor(S.color * (0.5 + ((colorV - 64) / 47) * 6)) % 7]);
      if (colorV <= 159) return out.copy(LASER_COLORS[Math.floor((i / n) * 7) % 7]);
      if (colorV <= 207) return out.copy(LASER_COLORS[Math.floor((i / n) * 7 + S.color * 2) % 7]);
      return out.copy(LASER_COLORS[Math.floor(S.color * 0.5) % 7]);
    };
    if (colorV >= 208) flashOn = ((S.color * (1 + ((colorV - 208) / 47) * 12)) % 1) < 0.5;

    const half = ((this.profile.scanAngle ?? 50) / 2) * DEG;
    const cz = Math.cos(az), sz = Math.sin(az);
    const cxr = Math.cos(ax), cyr = Math.cos(ay);
    const rp = this.rays.geometry.attributes.position.array;
    const rc = this.rays.geometry.attributes.color.array;
    const op = this.outline.geometry.attributes.position.array;
    const oc = this.outline.geometry.attributes.color.array;
    const n = pts.length;
    const limit = Math.min(n, Math.floor(n * Math.min(1, reveal)));
    const stride = Math.max(1, Math.ceil(n / MAXPTS));
    let ri = 0, oi = 0;
    let prev = null;
    const col = new THREE.Color();
    const o = this.aperture;
    let lit = 0;
    for (let i = 0; i < limit && ri < MAXPTS; i += stride) {
      const p = pts[i];
      if (!p || !flashOn) { prev = null; continue; }
      // パターン座標 → 回転・ロール・サイズ
      let u = p[0] * scale, w = p[1] * scale;
      const ru = u * cz - w * sz, rw = u * sz + w * cz;
      u = ru * cyr; // Y軸ロール：横方向が潰れる
      w = rw * cxr; // X軸ロール：縦方向が潰れる
      const tu = Math.tan(clamp(u * half + panOff * half, -1.4, 1.4));
      const tw = Math.tan(clamp(w * half + tiltOff * half, -1.4, 1.4));
      const d = this._d.copy(this.fwd).addScaledVector(this.right, tu).addScaledVector(this.upv, tw).normalize();
      const L = this.ctx.cast(o, d);
      const hit = this._p.copy(o).addScaledVector(d, L);
      colorAt(i, n, col);
      rp.set([o.x, o.y, o.z, hit.x, hit.y, hit.z], ri * 6);
      rc.set([col.r, col.g, col.b, col.r * 0.25, col.g * 0.25, col.b * 0.25], ri * 6);
      ri++;
      if (prev && prev.distanceTo(hit) < 1.2) {
        op.set([prev.x, prev.y, prev.z, hit.x, hit.y, hit.z], oi * 6);
        oc.set([col.r, col.g, col.b, col.r, col.g, col.b], oi * 6);
        oi++;
      }
      prev = (prev ?? new THREE.Vector3()).copy(hit);
      lit++;
    }
    this.rays.geometry.setDrawRange(0, ri * 2);
    this.outline.geometry.setDrawRange(0, oi * 2);
    this.rays.material.opacity = 0.25 + shared.haze * 0.6;
    this.rays.geometry.attributes.position.needsUpdate = true;
    this.rays.geometry.attributes.color.needsUpdate = true;
    this.outline.geometry.attributes.position.needsUpdate = true;
    this.outline.geometry.attributes.color.needsUpdate = true;
    this.level = lit ? 1 : 0;
    colorAt(0, 1, this.color);
    this.status += `G${group + 1}-${index + 1}`;
  }
}

export function createFixture(cfg, profile, ctx) {
  switch (profile.kind) {
    case 'moving-spot': return new MovingSpot(cfg, profile, ctx);
    case 'par': return new Par(cfg, profile, ctx);
    case 'laser': return new Laser(cfg, profile, ctx);
    case 'twinkle-ball': return new TwinkleBall(cfg, profile, ctx);
    default: throw new Error(`Unsupported fixture kind: ${profile.kind}`);
  }
}
