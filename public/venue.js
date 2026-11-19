// commons.svg を読み込み、壁・柱・ドア・グリッドを抽出して3D化する。
// SVGのレイヤー名（罫線/基本図/カーブ/柱・障害物）を前提にしている。文字列レイヤーは無視する。
import * as THREE from 'three';

/**
 * SVGをDOMに一時的に挿入し、グローバル座標（SVG単位）でジオメトリを取り出す。
 * 1マス(グリッド間隔) = 1m としてメートルに変換する。
 */
export async function loadFloorplan(url) {
  const text = await (await fetch(url)).text();
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;';
  host.innerHTML = text.replace(/<\?xml[^>]*>/, '').replace(/<!DOCTYPE[^>]*>/, '');
  document.body.appendChild(host);
  const svg = host.querySelector('svg');
  const vb = svg.viewBox.baseVal;
  svg.setAttribute('width', vb.width);
  svg.setAttribute('height', vb.height);

  const ctmOf = (el) => el.getCTM();
  const tp = (m, x, y) => {
    const p = new DOMPoint(x, y).matrixTransform(m);
    return [p.x, p.y];
  };
  const ancestorIds = (el) => {
    const ids = [];
    for (let e = el.parentElement; e && e !== svg; e = e.parentElement) if (e.id) ids.push(e.id);
    return ids;
  };

  // --- グリッドから縮尺と原点を求める
  const vx = [];
  const hy = [];
  for (const el of svg.querySelectorAll('#罫線 path')) {
    const L = el.getTotalLength();
    const m = ctmOf(el);
    const a = el.getPointAtLength(0);
    const b = el.getPointAtLength(L);
    const [x0, y0] = tp(m, a.x, a.y);
    const [x1, y1] = tp(m, b.x, b.y);
    if (Math.abs(x0 - x1) < 1) vx.push(x0);
    else if (Math.abs(y0 - y1) < 1) hy.push(y0);
  }
  vx.sort((a, b) => a - b);
  hy.sort((a, b) => a - b);
  const diffs = [];
  for (let i = 1; i < vx.length; i++) diffs.push(vx[i] - vx[i - 1]);
  for (let i = 1; i < hy.length; i++) diffs.push(hy[i] - hy[i - 1]);
  diffs.sort((a, b) => a - b);
  const unit = diffs.length ? diffs[diffs.length >> 1] : 90.47; // SVG単位 / m
  const ox = vx.length ? vx[0] : 0;
  const oy = hy.length ? hy[0] : 0;
  const toM = ([x, y]) => [(x - ox) / unit, (y - oy) / unit];

  const grid = {
    x0: 0,
    y0: 0,
    x1: vx.length ? (vx[vx.length - 1] - ox) / unit : 20,
    y1: hy.length ? (hy[hy.length - 1] - oy) / unit : 20,
  };

  // --- 基本図の要素を分類
  const walls = []; // {a:[x,y], b:[x,y], t:厚さm}
  const thin = []; // 細線（外構など）: 床に線だけ描く
  const doors = []; // 破線（出入口）
  const blocks = []; // 柱・障害物 {pts:[[x,y]x4]}

  const samplePath = (el) => {
    const m = ctmOf(el);
    const d = el.getAttribute('d') || '';
    const L = el.getTotalLength();
    // 直線のみのパスは頂点そのもの、曲線を含むならサンプリング
    if (!/[CcQqSsTtAa]/.test(d)) {
      const pts = [];
      const nums = d.match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number) || [];
      if (/[HhVvml]/.test(d)) {
        const n = Math.max(2, Math.min(64, Math.ceil(L / 20)));
        for (let i = 0; i < n; i++) {
          const p = el.getPointAtLength((L * i) / (n - 1));
          pts.push(toM(tp(m, p.x, p.y)));
        }
        return pts;
      }
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(toM(tp(m, nums[i], nums[i + 1])));
      return pts;
    }
    const pts = [];
    const n = 32;
    for (let i = 0; i < n; i++) {
      const p = el.getPointAtLength((L * i) / (n - 1));
      pts.push(toM(tp(m, p.x, p.y)));
    }
    return pts;
  };

  const farthestPair = (pts) => {
    let best = [pts[0], pts[0]];
    let bd = -1;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2;
        if (d > bd) { bd = d; best = [pts[i], pts[j]]; }
      }
    return best;
  };

  const base = svg.querySelector('#基本図') || svg;
  for (const el of base.querySelectorAll('path, rect, line, polyline, polygon')) {
    const ids = ancestorIds(el);
    if (ids.includes('文字列')) continue;
    const cs = getComputedStyle(el);
    const m = ctmOf(el);
    const scale = Math.hypot(m.a, m.b);
    const stroked = cs.stroke && cs.stroke !== 'none';
    const filled = cs.fill && cs.fill !== 'none';

    if (el.tagName === 'rect') {
      const x = +el.getAttribute('x'), y = +el.getAttribute('y');
      const w = +el.getAttribute('width'), h = +el.getAttribute('height');
      const pts = [tp(m, x, y), tp(m, x + w, y), tp(m, x + w, y + h), tp(m, x, y + h)].map(toM);
      blocks.push({ pts, pillar: ids.includes('柱・障害物') });
      continue;
    }
    const pts = samplePath(el);
    if (pts.length < 2) continue;
    if (stroked) {
      const sw = parseFloat(cs.strokeWidth) * scale;
      const target = sw >= 12 ? walls : thin;
      for (let i = 1; i < pts.length; i++) target.push({ a: pts[i - 1], b: pts[i], t: Math.max(0.08, sw / unit) });
    } else if (filled) {
      // 塗りつぶしの破線 = 出入口（ドア）
      const [a, b] = farthestPair(pts);
      doors.push({ a, b });
    }
  }

  document.body.removeChild(host);
  return { unit, grid, walls, thin, doors, blocks };
}

// ------------------------------------------------------------------ 3D化

/**
 * 図面データから Three.js の部屋を作る。plan座標 (x, y) は world (x, z) に対応。
 * 戻り値の colliders はレイ判定用の2D線分（壁・柱）。
 */
export function buildVenue(plan, { ceiling = 3.2 } = {}) {
  const group = new THREE.Group();
  group.name = 'venue';
  const colliders = [];

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.92, metalness: 0.0 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3d46, emissive: 0x1c1f27, roughness: 0.85, metalness: 0.0 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x33353c, emissive: 0x23262f, roughness: 0.8 });

  // 床（図面範囲＋余白）
  const pad = 2;
  const fw = plan.grid.x1 - plan.grid.x0 + pad * 2;
  const fd = plan.grid.y1 - plan.grid.y0 + pad * 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(plan.grid.x0 - pad + fw / 2, 0, plan.grid.y0 - pad + fd / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // 1mグリッド
  const gpts = [];
  for (let x = Math.ceil(plan.grid.x0); x <= plan.grid.x1 + 1e-6; x++) gpts.push(x, 0.004, plan.grid.y0, x, 0.004, plan.grid.y1);
  for (let y = Math.ceil(plan.grid.y0); y <= plan.grid.y1 + 1e-6; y++) gpts.push(plan.grid.x0, 0.004, y, plan.grid.x1, 0.004, y);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gpts, 3));
  const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x2c3038, transparent: true, opacity: 0.8 }));
  grid.name = 'grid';
  group.add(grid);

  // 壁
  const wallGroup = new THREE.Group();
  wallGroup.name = 'walls';
  for (const w of plan.walls) {
    const dx = w.b[0] - w.a[0];
    const dy = w.b[1] - w.a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.02) continue;
    const t = Math.min(0.25, Math.max(0.12, w.t));
    const box = new THREE.Mesh(new THREE.BoxGeometry(len + t, ceiling, t), wallMat);
    box.position.set((w.a[0] + w.b[0]) / 2, ceiling / 2, (w.a[1] + w.b[1]) / 2);
    box.rotation.y = -Math.atan2(dy, dx);
    box.castShadow = true;
    box.receiveShadow = true;
    wallGroup.add(box);
    colliders.push({ a: w.a, b: w.b });
  }
  group.add(wallGroup);

  // 柱・障害物
  for (const b of plan.blocks) {
    const xs = b.pts.map((p) => p[0]);
    const ys = b.pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = Math.max(0.1, x1 - x0), d = Math.max(0.1, y1 - y0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, ceiling, d), pillarMat);
    mesh.position.set((x0 + x1) / 2, ceiling / 2, (y0 + y1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    wallGroup.add(mesh);
    const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) colliders.push({ a: c[i], b: c[(i + 1) % 4] });
  }

  // 壁の平面線（真上から見ても間取りが分かるように）
  const wallLinePts = [];
  for (const c of colliders) wallLinePts.push(c.a[0], 0.02, c.a[1], c.b[0], 0.02, c.b[1]);
  const wallLineGeo = new THREE.BufferGeometry();
  wallLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallLinePts, 3));
  group.add(new THREE.LineSegments(wallLineGeo, new THREE.LineBasicMaterial({ color: 0x9aa3b8 })));

  // 細線（外構）・出入口は床に線で描く
  const linePts = [];
  for (const s of plan.thin) linePts.push(s.a[0], 0.01, s.a[1], s.b[0], 0.01, s.b[1]);
  const thinGeo = new THREE.BufferGeometry();
  thinGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
  group.add(new THREE.LineSegments(thinGeo, new THREE.LineBasicMaterial({ color: 0x5a6070 })));

  // 点線＝ガラスの自動ドア：天井までの透明パネル＋枠。光は透過する（コライダーにしない）
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fc4e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const framePts = [];
  for (const d of plan.doors) {
    const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, ceiling), glassMat);
    pane.position.set((d.a[0] + d.b[0]) / 2, ceiling / 2, (d.a[1] + d.b[1]) / 2);
    pane.rotation.y = -Math.atan2(dy, dx);
    pane.renderOrder = 1;
    wallGroup.add(pane);
    // 枠：上下のレールと、扉の合わせ目（中央）・両端の縦枠
    const fx = (s) => d.a[0] + dx * s, fy = (s) => d.a[1] + dy * s;
    for (const h of [0.01, 2.2]) framePts.push(d.a[0], h, d.a[1], d.b[0], h, d.b[1]);
    for (const s of [0, 0.5, 1]) framePts.push(fx(s), 0, fy(s), fx(s), 2.2, fy(s));
  }
  const frameGeo = new THREE.BufferGeometry();
  frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(framePts, 3));
  wallGroup.add(new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: 0x8a93a6 })));

  // 天井：下からだけ見える面（上から俯瞰するときは裏面なので描画されない）。光を受けて止める
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(plan.grid.x1 - plan.grid.x0, plan.grid.y1 - plan.grid.y0),
    new THREE.MeshStandardMaterial({ color: 0x2a2c32, roughness: 0.9 }),
  );
  ceil.rotation.x = Math.PI / 2; // 法線を下向きに
  ceil.position.set((plan.grid.x0 + plan.grid.x1) / 2, ceiling, (plan.grid.y0 + plan.grid.y1) / 2);
  ceil.receiveShadow = true;
  ceil.name = 'ceiling';
  group.add(ceil);

  return { group, colliders, wallMat, wallGroup, ceiling, bounds: plan.grid };
}

/** patch.json の props（ステージ・スクリーン等）を置く */
export function buildProps(props = []) {
  const group = new THREE.Group();
  const stageMat = new THREE.MeshStandardMaterial({ color: 0x24252b, roughness: 0.7 });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0xd8dbe2, roughness: 0.95, side: THREE.DoubleSide });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x30323a, roughness: 0.8 });
  const colliders = [];
  for (const p of props) {
    if (p.type === 'stage' || p.type === 'box') {
      const w = Math.abs(p.x2 - p.x1), d = Math.abs(p.y2 - p.y1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, p.h, d), p.type === 'stage' ? stageMat : boxMat);
      m.position.set((p.x1 + p.x2) / 2, p.h / 2, (p.y1 + p.y2) / 2);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    } else if (p.type === 'screen') {
      const dx = p.x2 - p.x1, dy = p.y2 - p.y1;
      const len = Math.hypot(dx, dy);
      const hgt = p.h1 - p.h0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), screenMat);
      m.position.set((p.x1 + p.x2) / 2, p.h0 + hgt / 2, (p.y1 + p.y2) / 2);
      m.rotation.y = -Math.atan2(dy, dx);
      m.receiveShadow = true;
      group.add(m);
      colliders.push({ a: [p.x1, p.y1], b: [p.x2, p.y2], h0: p.h0, h1: p.h1 });
    }
  }
  return { group, colliders };
}

/**
 * 2Dの壁線分＋床・天井でレイの到達距離を求める（ビーム長・レーザー着弾点用）。
 * cast(o, d) は距離を返す。cast.hit(o, d, outNormal) は距離を返し、当たった面の法線を outNormal に入れる。
 */
export function makeRaycaster(colliders, ceiling, maxDist = 40) {
  // 会場の壁は固定なので、線分の向きはレイごとに計算し直さない
  const segments = colliders.map(({ a: [x, z], b, h0, h1 }) => ({
    x, z, ex: b[0] - x, ez: b[1] - z, h0, h1,
  }));
  function trace(o, d, n) {
    let best = maxDist;
    let nx = 0, ny = 0, nz = 0;
    if (d.y < -1e-6) { const t = -o.y / d.y; if (t < best) { best = t; nx = 0; ny = 1; nz = 0; } }
    if (d.y > 1e-6) { const t = (ceiling - o.y) / d.y; if (t < best) { best = t; nx = 0; ny = -1; nz = 0; } }
    const dx = d.x, dz = d.z;
    for (const { x, z, ex, ez, h0, h1 } of segments) {
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = x - o.x, wz = z - o.z;
      const t = (wx * ez - wz * ex) / den;
      if (t <= 1e-4 || t >= best) continue;
      const s = (wx * dz - wz * dx) / den;
      if (s < 0 || s > 1) continue;
      if (h0 !== undefined) {
        const yh = o.y + d.y * t;
        if (yh < h0 || yh > h1) continue;
      }
      best = t;
      if (n) {
        // 壁の法線（レイの来た側を向ける）
        const len = Math.hypot(ex, ez) || 1;
        nx = -ez / len; ny = 0; nz = ex / len;
        if (nx * dx + nz * dz > 0) { nx = -nx; nz = -nz; }
      }
    }
    if (n) n.set(nx, ny, nz);
    return best;
  }
  const cast = (o, d) => trace(o, d, null);
  cast.hit = (o, d, n) => trace(o, d, n);
  cast.maxDist = maxDist;
  return cast;
}
