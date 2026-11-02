import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Noise + texture helpers (everything is generated procedurally at startup)
// ---------------------------------------------------------------------------

export function makeNoise(seed = 1) {
  const hash = (x, y, z) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  };
  const sm = t => t * t * (3 - 2 * t);
  const noise = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
    const a = hash(xi, yi, zi), b = hash(xi + 1, yi, zi), c = hash(xi, yi + 1, zi), d = hash(xi + 1, yi + 1, zi);
    const e = hash(xi, yi, zi + 1), f = hash(xi + 1, yi, zi + 1), g = hash(xi, yi + 1, zi + 1), h = hash(xi + 1, yi + 1, zi + 1);
    const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u;
    const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
    return y1 + (y2 - y1) * w;
  };
  return (x, y, z, oct = 5) => {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise(x * freq, y * freq, z * freq);
      norm += amp; amp *= 0.5; freq *= 2.03;
    }
    return sum / norm;
  };
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

export function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Equirectangular texture for a sphere; fn(x, y, z) gets a unit direction.
function sphereTexture(W, H, fn) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let j = 0; j < H; j++) {
    const th = (j + 0.5) / H * Math.PI, st = Math.sin(th), y = Math.cos(th);
    for (let i = 0; i < W; i++) {
      const ph = (i + 0.5) / W * Math.PI * 2;
      const col = fn(Math.cos(ph) * st, y, Math.sin(ph) * st);
      const k = (j * W + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = col.length > 3 ? col[3] : 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function terraTexture(seed, sea = 0.52) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 50);
  return sphereTexture(768, 384, (x, y, z) => {
    let h = n(x * 1.8 + 11, y * 1.8, z * 1.8, 6);
    h = (h - 0.5) * 3.2 + 0.5 + (n2(x * 6, y * 6, z * 6, 3) - 0.5) * 0.45;
    const lat = Math.abs(y);
    if (lat + (h - 0.5) * 0.25 > 0.86) return [232, 238, 246];
    if (h < sea) return mix([40, 112, 172], [10, 30, 82], clamp01((sea - h) * 4));
    const e = clamp01((h - sea) * 3);
    if (e < 0.05) return [190, 178, 134];
    const dry = clamp01((n2(x * 2.5 + 4, y * 2.5, z * 2.5, 4) - 0.5) * 6 + (0.5 - lat) - 0.3);
    let col = mix([62, 118, 54], [38, 82, 40], e);
    col = mix(col, [178, 146, 96], dry);
    if (e > 0.55) col = mix(col, [120, 110, 100], clamp01((e - 0.55) * 4));
    if (e > 0.8) col = mix(col, [240, 240, 245], clamp01((e - 0.8) * 5));
    return col;
  });
}

function cloudTexture(seed) {
  const n = makeNoise(seed);
  return sphereTexture(512, 256, (x, y, z) => {
    const a = clamp01((n(x * 2.5, y * 3.2, z * 2.5, 5) - 0.47) * 4.5);
    return [255, 255, 255, a * 235];
  });
}

function gasTexture(seed, pal = [[214, 176, 128], [146, 96, 64], [236, 222, 196], [196, 90, 60]]) {
  const n = makeNoise(seed);
  return sphereTexture(768, 384, (x, y, z) => {
    const turb = n(x * 2.0, y * 2.0, z * 2.0, 5) - 0.5;
    const t = y * 5.5 + turb * 1.6;
    const b1 = 0.5 + 0.5 * Math.sin(t * 3.1);
    const b2 = 0.5 + 0.5 * Math.sin(t * 7.7 + 1.3);
    let col = mix(pal[0], pal[1], b1);
    col = mix(col, pal[2], b2 * 0.45);
    const sx = x - 0.62, sy = (y + 0.28) * 1.8, sz = z - 0.55;
    const sd = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (sd < 0.25) col = mix(col, pal[3], clamp01((0.25 - sd) * 8) * (0.75 + turb));
    return col;
  });
}

function iceTexture(seed) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 9);
  return sphereTexture(512, 256, (x, y, z) => {
    const h = n(x * 3, y * 3, z * 3, 6);
    let col = mix([110, 122, 136], [214, 226, 236], clamp01((h - 0.38) * 3));
    const c = Math.abs(n2(x * 9, y * 9, z * 9, 2) - 0.5);
    if (c < 0.03) col = mix(col, [70, 78, 90], 0.6);
    return col;
  });
}

function lavaTexture(seed) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 3);
  return sphereTexture(512, 256, (x, y, z) => {
    const h = n(x * 2.5, y * 2.5, z * 2.5, 6);
    const c = Math.abs(n2(x * 6, y * 6, z * 6, 3) - 0.5);
    let col = mix([38, 30, 28], [92, 70, 60], clamp01((h - 0.4) * 3));
    if (c < 0.035) col = mix([255, 120, 30], [255, 220, 120], 1 - c / 0.035);
    return col;
  });
}

function nebulaTexture(seed = 77, tint = [1, 1, 1]) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 14);
  return sphereTexture(1024, 512, (x, y, z) => {
    const a = n(x * 1.6, y * 1.6, z * 1.6, 6);
    const b = n2(x * 3 + 7, y * 3, z * 3, 4);
    const band = Math.exp(-Math.pow((y * 0.9 + 0.3 * x) / 0.32, 2));
    const neb = Math.max(0, a - 0.47) * 3.2 * (0.35 + band);
    return [
      (4 + 105 * neb * b + 16 * band) * tint[0],
      (4 + 40 * neb * (1 - b) * 0.8 + 10 * band) * tint[1],
      (10 + 120 * neb * (1 - b * 0.6) + 22 * band) * tint[2],
    ];
  });
}

// RingGeometry with radial UVs: u = radius (inner->outer), v = angle.
function radialRing(inner, outer, thetaSeg = 128, phiSeg = 6) {
  const geo = new THREE.RingGeometry(inner, outer, thetaSeg, phiSeg);
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) {
    const i = k % (thetaSeg + 1), j = Math.floor(k / (thetaSeg + 1));
    uv.setXY(k, j / phiSeg, i / thetaSeg);
  }
  return geo;
}

function planetRingTexture(seed) {
  const n = makeNoise(seed);
  const c = document.createElement('canvas'); c.width = 512; c.height = 4;
  const g = c.getContext('2d');
  for (let x = 0; x < 512; x++) {
    const t = x / 512;
    let a = 0.25 + 0.75 * n(t * 40, 0.5, 0.5, 4);
    if (t > 0.56 && t < 0.62) a *= 0.12;
    a *= clamp01(t * 12) * clamp01((1 - t) * 8);
    const col = mix([206, 182, 150], [150, 126, 104], n(t * 13, 3, 3, 2));
    g.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a.toFixed(3)})`;
    g.fillRect(x, 0, 1, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function diskTexture() {
  const n = makeNoise(5);
  const W = 256, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let j = 0; j < H; j++) {
    const a = j / H * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < W; i++) {
      const t = i / W;
      const s = n(t * 22, ca * 2.5 + 3, sa * 2.5 + 3, 5);
      let inten = Math.pow(1 - t, 1.5) * clamp01(t / 0.05) * (0.25 + 1.6 * Math.max(0, s - 0.32));
      inten = clamp01(inten);
      const col = t < 0.25 ? mix([255, 248, 230], [255, 180, 90], t / 0.25) : mix([255, 180, 90], [190, 50, 25], clamp01((t - 0.25) / 0.75));
      const k = (j * W + i) * 4;
      d[k] = col[0] * inten; d[k + 1] = col[1] * inten; d[k + 2] = col[2] * inten; d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function windowsTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 64);
  for (const r of [4, 11, 50, 57]) {
    for (let x = 0; x < 1024; x += 6) {
      if (Math.random() < 0.55) {
        g.fillStyle = Math.random() < 0.8 ? '#ffd9a0' : '#a8e4ff';
        g.fillRect(x, r, 3, 3);
      }
    }
  }
  g.fillStyle = '#33ccff'; g.fillRect(0, 31, 1024, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']], 128);

function glowSprite(color, scale, opacity = 1, tex = glowTex) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(scale);
  return s;
}

// ---------------------------------------------------------------------------
// Trade data
// ---------------------------------------------------------------------------

export const COMMODITIES = [
  { id: 'food', name: 'Food Rations', base: 40 },
  { id: 'water', name: 'Water Ice', base: 28 },
  { id: 'ore', name: 'Raw Ore', base: 65 },
  { id: 'fuel', name: 'Fuel Cells', base: 95 },
  { id: 'med', name: 'Medical Supplies', base: 180 },
  { id: 'tech', name: 'Electronics', base: 260 },
  { id: 'lux', name: 'Luxury Goods', base: 420 },
  { id: 'stims', name: 'Stim Packs (contraband)', base: 300, illegal: true },
];

// ---------------------------------------------------------------------------
// Station model
// ---------------------------------------------------------------------------

export function makeStation(accent) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x8c939c, metalness: 0.6, roughness: 0.45, envMapIntensity: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.5, roughness: 0.6 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a2a55, metalness: 0.8, roughness: 0.3, emissive: 0x050a20 });
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x9aa1aa, metalness: 0.5, roughness: 0.5,
    emissive: 0xffffff, emissiveMap: windowsTexture(), emissiveIntensity: 1.6,
  });

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(110, 110, 700, 24), metal);
  hub.rotation.x = Math.PI / 2; g.add(hub);
  for (const z of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(70, 110, 110, 24), dark);
    cap.rotation.x = z * Math.PI / 2; cap.position.z = z * 400; g.add(cap);
  }
  const bay = new THREE.Mesh(new THREE.BoxGeometry(150, 100, 40), dark);
  bay.position.z = 470; g.add(bay);
  const bayLight = new THREE.Mesh(new THREE.PlaneGeometry(120, 70),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2.2) }));
  bayLight.position.z = 491; g.add(bayLight);

  const ring = new THREE.Group();
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(520, 55, 20, 96), ringMat));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 420, 8), metal);
    spoke.position.set(Math.cos(a) * 315, Math.sin(a) * 315, 0);
    spoke.rotation.z = a - Math.PI / 2;
    ring.add(spoke);
  }
  g.add(ring);

  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(260, 20, 20), metal);
    arm.position.set(sx * 230, 0, -300); g.add(arm);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(520, 6, 210), panelMat);
    panel.position.set(sx * 620, 0, -300); g.add(panel);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 420, 6), metal);
  antenna.rotation.x = Math.PI / 2; antenna.position.z = -660; g.add(antenna);

  const lights = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const s = glowSprite(new THREE.Color(3, 0.4, 0.3), 60);
    s.position.set(Math.cos(a) * 580, Math.sin(a) * 580, 0);
    ring.add(s); lights.push({ s, phase: i * 0.4 });
  }
  for (const [x, y] of [[-80, -55], [80, -55], [-80, 55], [80, 55]]) {
    const s = glowSprite(new THREE.Color(accent).multiplyScalar(3), 45);
    s.position.set(x, y, 495); g.add(s); lights.push({ s, phase: 0, fast: true });
  }
  return { group: g, ring, lights };
}

// ---------------------------------------------------------------------------
// The star system
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Star systems
// ---------------------------------------------------------------------------

const LEGAL = m => ({ ...m, stims: 2.1, legal: true });
export const SYSTEMS = {
  sable: {
    name: 'Sable Rift', blurb: 'Frontier system at the edge of a black hole.',
    galaxy: [0, 0.7], police: 0.35, danger: 1,
    star: { radius: 8000, color: [5, 4.2, 3], glow: [2.2, 1.7, 1.1], light: 0xfff0dc },
    nebula: { seed: 77, tint: [1, 1, 1] },
    planets: [
      { name: 'Meridian', tex: () => terraTexture(7), radius: 5200, pos: [62000, -2000, -38000], atmo: 'rgba(110,180,255,', tilt: 0.3, clouds: () => cloudTexture(8), mapColor: '#4f9be8' },
      { name: 'Tolvar', tex: () => gasTexture(3), radius: 15000, pos: [-95000, 6000, 35000], atmo: 'rgba(255,205,150,', tilt: 0.45, rings: true, mapColor: '#d6a56e' },
      { name: 'Vesk', tex: () => iceTexture(11), radius: 2600, pos: [-50000, 3000, 75000], atmo: 'rgba(190,230,255,', tilt: 0.1, mapColor: '#bcd4e6' },
    ],
    stations: [
      { name: 'Meridian Highport', planet: 0, offset: [9500, 1500, 7000], accent: 0x33ff88, market: LEGAL({ food: 0.62, water: 1.35, ore: 1.45, fuel: 1.3, med: 0.7, tech: 0.72, lux: 1.38 }) },
      { name: 'Tolvar Refinery', planet: 1, offset: [26000, -2500, -28000], accent: 0xffaa33, market: LEGAL({ food: 1.45, water: 0.62, ore: 0.58, fuel: 0.66, med: 1.4, tech: 1.3, lux: 0.78 }) },
    ],
    blackHole: { pos: [-30000, -4000, -122000] },
    belt: { center: [28000, -6000, 88000] },
    navs: [
      { station: 0 }, { station: 1 },
      { name: 'Cinder Belt', kind: 'belt', beltOffset: [0, 0, -11500], encounter: 0.85 },
      { name: 'Outer Relay', kind: 'relay', pos: [118000, 9000, 62000], encounter: 0.6 },
      { name: 'Rift Survey Beacon', kind: 'beacon', bhOffset: [22500, 3000, 10500], encounter: 0.7 },
      { name: 'Jump Gate: Corvane', kind: 'jump', to: 'corvane', pos: [135000, -6000, -70000], encounter: 0.25 },
      { name: 'Jump Gate: Hollow Reach', kind: 'jump', to: 'hollow', pos: [-150000, 9000, -30000], encounter: 0.35 },
    ],
  },
  corvane: {
    name: 'Corvane', blurb: 'Authority core system: shipyards, patrols, order.',
    galaxy: [0.85, -0.5], police: 0.85, danger: 0.5,
    star: { radius: 9500, color: [3.4, 4, 5.5], glow: [1.4, 1.8, 2.6], light: 0xe6f0ff },
    nebula: { seed: 31, tint: [0.5, 0.9, 1.3] },
    planets: [
      { name: 'Corvane Prime', tex: () => terraTexture(21), radius: 6200, pos: [70000, 3000, 30000], atmo: 'rgba(120,190,255,', tilt: 0.2, clouds: () => cloudTexture(22), mapColor: '#5aa8f0' },
      { name: 'Brightwater', tex: () => terraTexture(33, 0.62), radius: 4800, pos: [-60000, -4000, 70000], atmo: 'rgba(90,170,255,', tilt: 0.4, clouds: () => cloudTexture(34), mapColor: '#2f7fd8' },
      { name: 'Ashlund', tex: () => lavaTexture(5), radius: 3800, pos: [-30000, 2000, -55000], atmo: 'rgba(255,120,60,', tilt: 0.05, mapColor: '#c4552a' },
    ],
    stations: [
      { name: 'Corvane Shipyards', planet: 0, offset: [-11000, 2000, 8000], accent: 0x55aaff, hq: true, market: LEGAL({ food: 1.25, water: 1.1, ore: 1.5, fuel: 0.9, med: 1.0, tech: 0.68, lux: 1.5 }) },
      { name: 'Port Lys', planet: 1, offset: [9000, 1500, -8500], accent: 0x33ffcc, market: LEGAL({ food: 0.55, water: 0.6, ore: 1.3, fuel: 1.35, med: 0.75, tech: 1.4, lux: 1.15 }) },
    ],
    belt: { center: [20000, -3000, -90000] },
    navs: [
      { station: 0 }, { station: 1 },
      { name: 'Glass Belt', kind: 'belt', beltOffset: [0, 0, 11500], encounter: 0.45 },
      { name: 'Picket Line', kind: 'relay', pos: [-110000, 12000, -10000], encounter: 0.4 },
      { name: 'Jump Gate: Sable Rift', kind: 'jump', to: 'sable', pos: [-120000, -5000, 90000], encounter: 0.15 },
      { name: 'Jump Gate: Hollow Reach', kind: 'jump', to: 'hollow', pos: [125000, 8000, -80000], encounter: 0.3 },
    ],
  },
  hollow: {
    name: 'Hollow Reach', blurb: 'Lawless red-dwarf system. Ashfang territory.',
    galaxy: [-0.85, -0.5], police: 0.08, danger: 1.6,
    star: { radius: 6000, color: [5, 2, 1.2], glow: [2.6, 1, 0.5], light: 0xffb08a },
    nebula: { seed: 53, tint: [1.4, 0.6, 0.6] },
    planets: [
      { name: 'Hollow', tex: () => gasTexture(9, [[120, 90, 150], [70, 50, 100], [190, 160, 210], [230, 120, 90]]), radius: 13000, pos: [-60000, 4000, -50000], atmo: 'rgba(200,150,255,', tilt: 0.6, rings: true, mapColor: '#8a6aaa' },
      { name: 'Cinder', tex: () => lavaTexture(14), radius: 2800, pos: [50000, -2000, 40000], atmo: 'rgba(255,110,50,', tilt: 0.1, mapColor: '#b3482a' },
    ],
    stations: [
      { name: 'Gallows Rock', planet: 1, offset: [8000, 2000, 6000], accent: 0xff3322, outpost: true, market: { food: 1.6, water: 1.5, ore: 0.8, fuel: 1.2, med: 1.8, tech: 1.2, lux: 0.7, stims: 0.6 } },
    ],
    belt: { center: [70000, 6000, -70000] },
    navs: [
      { station: 0 },
      { name: 'Bone Fields', kind: 'belt', beltOffset: [0, 0, 11500], encounter: 0.9 },
      { name: "Krell's Anchorage", kind: 'lair', pos: [-20000, 15000, 95000], encounter: 0.9 },
      { name: 'Jump Gate: Sable Rift', kind: 'jump', to: 'sable', pos: [120000, -8000, 60000], encounter: 0.4 },
      { name: 'Jump Gate: Corvane', kind: 'jump', to: 'corvane', pos: [-125000, 5000, 20000], encounter: 0.35 },
    ],
  },
};

function makeJumpGate(color) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x6c737c, metalness: 0.7, roughness: 0.35, envMapIntensity: 0.5 });
  g.add(new THREE.Mesh(new THREE.TorusGeometry(320, 26, 12, 64), metal));
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(60, 60, 90), metal);
    pod.position.set(Math.cos(a) * 320, Math.sin(a) * 320, 0);
    pod.rotation.z = a;
    g.add(pod);
  }
  const swirl = glowSprite(color, 900, 0.55);
  g.add(swirl);
  const core = glowSprite(new THREE.Color(2, 2.5, 3.5), 260, 0.9);
  g.add(core);
  return { group: g, swirl };
}

const worldCache = {};
// Returns the world for a system id, building it on first use. Only one world's root is in the scene at a time.
export function getWorld(scene, id) {
  if (!worldCache[id]) worldCache[id] = buildWorld(id);
  for (const w of Object.values(worldCache)) if (w.root.parent) scene.remove(w.root);
  scene.add(worldCache[id].root);
  return worldCache[id];
}

function buildWorld(id) {
  const def = SYSTEMS[id];
  const root = new THREE.Group();
  const world = { id, def, name: def.name, root, planets: [], stations: [], navs: [], time: 0, blackHole: null, belt: null };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const VA = a => new THREE.Vector3(...a);

  root.add(new THREE.AmbientLight(0x6a7890, 0.28));
  const sunLight = new THREE.PointLight(def.star.light, 3.2, 0, 0);
  root.add(sunLight);
  world.sunPos = V(0, 0, 0);

  // Sky
  const sky = new THREE.Group();
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(450000, 48, 24),
    new THREE.MeshBasicMaterial({ map: nebulaTexture(def.nebula.seed, def.nebula.tint), side: THREE.BackSide, depthWrite: false })));
  const starGeo = new THREE.BufferGeometry();
  const N = 9000, sp = new Float32Array(N * 3), sc = new Float32Array(N * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    if (Math.random() < 0.45) { v.y = (v.y * 0.15) - v.x * 0.33; v.normalize(); }
    v.multiplyScalar(400000);
    sp.set([v.x, v.y, v.z], i * 3);
    const b = Math.pow(Math.random(), 5) * 1.5 + 0.3;
    const tint = Math.random();
    const c = tint < 0.15 ? [0.7, 0.8, 1.2] : tint < 0.3 ? [1.2, 1.0, 0.75] : [1, 1, 1];
    sc.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const starTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 32);
  sky.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.2, map: starTex, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true })));
  root.add(sky);
  world.sky = sky;

  // Star
  const sun = new THREE.Mesh(new THREE.SphereGeometry(def.star.radius, 48, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(...def.star.color) }));
  root.add(sun);
  sun.add(glowSprite(new THREE.Color(...def.star.glow), def.star.radius * 4.6));
  sun.add(glowSprite(new THREE.Color(...def.star.glow).multiplyScalar(0.45), def.star.radius * 10, 0.1));
  world.planets.push({ name: def.name + ' (star)', pos: V(0, 0, 0), radius: def.star.radius, star: true, mapColor: '#' + new THREE.Color(...def.star.glow).multiplyScalar(0.45).getHexString() });

  // Planets
  for (const d of def.planets) {
    const pos = VA(d.pos);
    const grp = new THREE.Group();
    grp.position.copy(pos);
    grp.rotation.z = d.tilt;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(d.radius, 96, 64), new THREE.MeshStandardMaterial({ map: d.tex(), roughness: 0.85, metalness: 0, envMapIntensity: 0 }));
    grp.add(mesh);
    let clouds = null;
    if (d.clouds) {
      clouds = new THREE.Mesh(new THREE.SphereGeometry(d.radius * 1.012, 96, 64),
        new THREE.MeshStandardMaterial({ map: d.clouds(), transparent: true, depthWrite: false, roughness: 1, envMapIntensity: 0 }));
      grp.add(clouds);
    }
    const atmoTex = radialTexture([[0, d.atmo + '0)'], [0.74, d.atmo + '0)'], [0.795, d.atmo + '0.7)'], [0.83, d.atmo + '0.3)'], [1, d.atmo + '0)']], 512);
    const atmo = new THREE.Sprite(new THREE.SpriteMaterial({ map: atmoTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    atmo.scale.setScalar(d.radius * 2.5);
    grp.add(atmo);
    if (d.rings) {
      const ring = new THREE.Mesh(radialRing(d.radius * 1.45, d.radius * 2.3, 160, 4),
        new THREE.MeshStandardMaterial({ map: planetRingTexture(4), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1, envMapIntensity: 0 }));
      ring.rotation.x = -Math.PI / 2;
      grp.add(ring);
    }
    root.add(grp);
    world.planets.push({ name: d.name, pos, radius: d.radius, mesh, clouds, mapColor: d.mapColor, rings: !!d.rings });
  }

  // Stations
  const _l = new THREE.Vector3();
  def.stations.forEach((d, si) => {
    const pl = world.planets[d.planet + 1];
    const pos = pl.pos.clone().add(VA(d.offset));
    const m = makeStation(d.accent);
    m.group.position.copy(pos);
    const away = pos.clone().sub(pl.pos).normalize();
    const axis = away.clone().add(away.clone().cross(V(0, 1, 0)).multiplyScalar(1.3)).normalize();
    m.group.lookAt(pos.clone().add(axis));
    root.add(m.group);
    m.group.updateMatrixWorld(true);
    world.stations.push({
      name: d.name, pos, group: m.group, ring: m.ring, lights: m.lights, axis, radius: 650, index: si, sys: id,
      isStation: true, market: d.market, outpost: !!d.outpost, hq: !!d.hq,
      collide(p, r) {
        _l.copy(p); this.group.worldToLocal(_l);
        const rho = Math.hypot(_l.x, _l.y);
        if (rho < 115 + r && Math.abs(_l.z) < 500) return true;
        const dr = rho - 520;
        return dr * dr + _l.z * _l.z < (58 + r) * (58 + r);
      },
    });
  });

  // Black hole
  const disks = [];
  if (def.blackHole) {
    const bhPos = VA(def.blackHole.pos);
    const bh = new THREE.Group();
    bh.position.copy(bhPos);
    bh.add(new THREE.Mesh(new THREE.SphereGeometry(1200, 64, 32), new THREE.MeshBasicMaterial({ color: 0x000000 })));
    const diskGroup = new THREE.Group();
    diskGroup.rotation.set(-Math.PI / 2 + 0.22, 0, 0.3);
    const dTex = diskTexture();
    for (const [inner, outer, col, speed] of [[1500, 9500, new THREE.Color(2.4, 2.1, 1.8), 0.22], [1400, 6000, new THREE.Color(1.6, 1.2, 1.0), 0.45]]) {
      const disk = new THREE.Mesh(radialRing(inner, outer, 160, 8), new THREE.MeshBasicMaterial({
        map: dTex, color: col, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      }));
      diskGroup.add(disk);
      disks.push({ mesh: disk, speed });
    }
    bh.add(diskGroup);
    const photonTex = radialTexture([[0, 'rgba(0,0,0,0)'], [0.6, 'rgba(255,220,180,0)'], [0.7, 'rgba(255,236,210,1)'], [0.76, 'rgba(255,170,90,0.3)'], [1, 'rgba(0,0,0,0)']], 512);
    bh.add(glowSprite(new THREE.Color(2.2, 1.8, 1.4), 4600, 1, photonTex));
    bh.add(glowSprite(new THREE.Color(0.5, 0.35, 1.0), 30000, 0.18));
    root.add(bh);
    world.blackHole = { pos: bhPos, horizon: 1200, GM: 1.125e10, disks, name: 'Sable Rift' };
  }

  // Asteroid belt
  if (def.belt) {
    const beltCenter = VA(def.belt.center);
    const rn = makeNoise(21 + id.length);
    const rockGeo = new THREE.IcosahedronGeometry(1, 2);
    const pa = rockGeo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i);
      v.multiplyScalar(0.72 + 0.56 * rn(v.x * 1.6 + 3, v.y * 1.6, v.z * 1.6, 4));
      pa.setXYZ(i, v.x, v.y, v.z);
    }
    rockGeo.computeVertexNormals();
    const ROCKS = 340;
    const rockColor = id === 'hollow' ? 0x6b5a54 : id === 'corvane' ? 0x7d8590 : 0x75685b;
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: rockColor, roughness: 0.95, metalness: 0.05, flatShading: true, envMapIntensity: 0.15 }), ROCKS);
    rocks.frustumCulled = false;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3();
    const rockData = [];
    for (let i = 0; i < ROCKS; i++) {
      const a = Math.random() * Math.PI * 2, r = 2500 + Math.random() * 7500;
      const p = V(Math.cos(a) * r, (Math.random() + Math.random() - 1) * 800, Math.sin(a) * r).add(beltCenter);
      const sz = Math.random() < 0.06 ? 220 + Math.random() * 200 : 15 + Math.pow(Math.random(), 2) * 140;
      q.setFromEuler(e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      m4.compose(p, q, sv.set(sz, sz * (0.7 + Math.random() * 0.5), sz));
      rocks.setMatrixAt(i, m4);
      rockData.push({ p, r: sz * 1.05 });
    }
    root.add(rocks);
    world.belt = { center: beltCenter, radius: 10000, extent: 11000, rocks: rockData };
  }

  // Nav points
  for (const n of def.navs) {
    if (n.station !== undefined) {
      const st = world.stations[n.station];
      world.navs.push({ name: st.name, pos: st.pos, kind: 'station', station: st, arrive: 2500, encounter: st.outpost ? 0.15 : 0.12, cooldown: 0 });
      continue;
    }
    let pos;
    if (n.beltOffset) pos = world.belt.center.clone().add(VA(n.beltOffset));
    else if (n.bhOffset) pos = world.blackHole.pos.clone().add(VA(n.bhOffset));
    else pos = VA(n.pos);
    const nav = { name: n.name, pos, kind: n.kind, to: n.to, arrive: n.kind === 'jump' ? 1800 : n.kind === 'belt' ? 1200 : 1500, encounter: n.encounter ?? 0.5, cooldown: 0 };
    if (n.kind === 'relay' || n.kind === 'beacon' || n.kind === 'lair') {
      const b = new THREE.Group();
      b.position.copy(pos);
      b.add(new THREE.Mesh(new THREE.OctahedronGeometry(40, 0), new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.7, roughness: 0.3 })));
      nav.blink = glowSprite(n.kind === 'lair' ? new THREE.Color(3, 0.4, 0.3) : new THREE.Color(0.6, 1.8, 3), 160);
      b.add(nav.blink);
      root.add(b);
    }
    if (n.kind === 'jump') {
      const gate = makeJumpGate(new THREE.Color(0.5, 1.1, 2.6));
      gate.group.position.copy(pos);
      gate.group.lookAt(0, 0, 0);
      root.add(gate.group);
      nav.gate = gate;
    }
    world.navs.push(nav);
  }

  world.update = (dt, camera) => {
    world.time += dt;
    const t = world.time;
    sky.position.copy(camera.position);
    for (const p of world.planets) {
      if (p.mesh) p.mesh.rotation.y += dt * 0.008;
      if (p.clouds) p.clouds.rotation.y += dt * 0.011;
    }
    for (const st of world.stations) {
      st.ring.rotation.z += dt * 0.06;
      for (const l of st.lights) l.s.visible = l.fast ? (t * 2 % 1) < 0.5 : ((t + l.phase) % 1.6) < 0.25;
    }
    for (const d of disks) d.mesh.rotation.z -= dt * d.speed;
    for (const nav of world.navs) {
      if (nav.blink) nav.blink.visible = (t % 1.2) < 0.6;
      if (nav.gate) { nav.gate.swirl.material.rotation = t * 0.6; nav.gate.swirl.material.opacity = 0.45 + 0.15 * Math.sin(t * 2); }
    }
  };

  return world;
}
