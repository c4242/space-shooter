import * as THREE from 'three';
import { radialTexture } from './world.js';
import { audio } from './audio.js';

export const LASER_SPEED = 2600;

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _f = V(), _g = V();
const _tf = V(), _tax = V(), _tq = new THREE.Quaternion(), _m = new THREE.Matrix4();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.85)'], [0.45, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']], 128);

// ---------------------------------------------------------------------------
// Orientation helpers (ships face local -Z, like cameras)
// ---------------------------------------------------------------------------

export function forwardOf(obj, out = V()) { return out.set(0, 0, -1).applyQuaternion(obj.quaternion); }
export function upOf(obj, out = V()) { return out.set(0, 1, 0).applyQuaternion(obj.quaternion); }
export function rightOf(obj, out = V()) { return out.set(1, 0, 0).applyQuaternion(obj.quaternion); }

export function faceToward(obj, target, up) {
  _m.lookAt(obj.position, target, up || upOf(obj, _g));
  obj.quaternion.setFromRotationMatrix(_m);
}

// Rotate obj so its nose turns toward dir (unit, world space) by at most maxAngle radians.
export function turnToward(obj, dir, maxAngle) {
  const f = forwardOf(obj, _tf);
  const ang = Math.acos(THREE.MathUtils.clamp(f.dot(dir), -1, 1));
  if (ang < 1e-4) return 0;
  const axis = _tax.crossVectors(f, dir);
  if (axis.lengthSq() < 1e-10) upOf(obj, axis);
  axis.normalize();
  _tq.setFromAxisAngle(axis, Math.min(ang, maxAngle));
  obj.quaternion.premultiply(_tq).normalize();
  return ang;
}

export function segSphere(p0, p1, c, r) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const fx = p0.x - c.x, fy = p0.y - c.y, fz = p0.z - c.z;
  const dd = dx * dx + dy * dy + dz * dz;
  let t = dd > 0 ? -(fx * dx + fy * dy + fz * dz) / dd : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = fx + dx * t, py = fy + dy * t, pz = fz + dz * t;
  return px * px + py * py + pz * pz < r * r;
}

export function volAt(game, pos) {
  return Math.max(0, 1 - game.camera.position.distanceTo(pos) / 5000);
}

// ---------------------------------------------------------------------------
// Models (built from primitives)
// ---------------------------------------------------------------------------

// Procedural hull plating: panel seams, rivet lines and grime, used as colour and bump map.
export const PANEL_TEX = (() => {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const v = 200 + Math.random() * 45 | 0;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * S | 0, Math.random() * S | 0, 20 + Math.random() * 140 | 0, 20 + Math.random() * 100 | 0);
  }
  g.strokeStyle = '#6c6c6c'; g.lineWidth = 2;
  const cut = (x0, y0, x1, y1, d) => {
    if (d > 4 || (d > 1 && Math.random() < 0.25)) { g.strokeRect(x0, y0, x1 - x0, y1 - y0); return; }
    if ((x1 - x0) > (y1 - y0)) { const m = x0 + (x1 - x0) * (0.3 + Math.random() * 0.4); cut(x0, y0, m, y1, d + 1); cut(m, y0, x1, y1, d + 1); }
    else { const m = y0 + (y1 - y0) * (0.3 + Math.random() * 0.4); cut(x0, y0, x1, m, d + 1); cut(x0, m, x1, y1, d + 1); }
  };
  cut(0, 0, S, S, 0);
  g.fillStyle = '#7a7a7a';
  for (let i = 0; i < 40; i++) { const x = Math.random() * S, y = Math.random() * S; for (let k = 0; k < 8; k++) g.fillRect(x + k * 7, y, 2, 2); }
  for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(60,55,50,${Math.random() * 0.06})`; g.fillRect(Math.random() * S, Math.random() * S, 3 + Math.random() * 30, 1 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
})();

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.42, envMapIntensity: 0.35, map: PANEL_TEX, bumpMap: PANEL_TEX, bumpScale: 0.6, ...o });
}

// Engine exhaust plume: an additive cone that fades along its length; length follows thrust.
const PLUME_GEO = new THREE.ConeGeometry(1, 1, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
export function plumeMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(...color) }, time: { value: 0 }, power: { value: 1 } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying float vZ; varying vec3 vN; varying vec3 vV;
      void main() {
        vZ = position.z;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 color; uniform float time; uniform float power;
      varying float vZ; varying vec3 vN; varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        float along = 1.0 - vZ;
        float core = pow(abs(dot(vN, vV)), 1.5);
        float flick = 0.85 + 0.15 * sin(time * 60.0 + vZ * 20.0);
        vec3 c = mix(color, vec3(3.0), pow(along, 6.0) * 0.6);
        gl_FragColor = vec4(c * pow(along, 1.8) * core * flick * power, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
export function addPlume(group, pos, radius, color) {
  const m = new THREE.Mesh(PLUME_GEO, plumeMaterial(color));
  m.position.copy(pos);
  m.scale.set(radius, radius, radius * 6);
  m.userData.base = radius;
  m.renderOrder = 4;
  group.add(m);
  return m;
}
function part(g, geo, m, p = [0, 0, 0], r = [0, 0, 0], s = null) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...p); mesh.rotation.set(...r);
  if (s) mesh.scale.set(...s);
  g.add(mesh);
  return mesh;
}
function glow(g, color, p, scale) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.position.set(...p); s.scale.setScalar(scale); s.userData.base = scale;
  g.add(s);
  return s;
}
function wingGeo(pts, thick) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, thick / 2, 0);
  return geo;
}

export function buildPlayerModel(hullColor = 0x9ea9b8, accentColor = 0x2a6fd6) {
  const g = new THREE.Group();
  const hull = mat(hullColor), dark = mat(0x2b3038, { roughness: 0.65 });
  const accent = mat(accentColor, { metalness: 0.35, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b2333, emissive: 0x0f5577, emissiveIntensity: 0.7, metalness: 0.9, roughness: 0.08 });
  part(g, new THREE.CylinderGeometry(1.1, 2.1, 13, 12), hull, [0, 0, 0.5], [-Math.PI / 2, 0, 0]);
  part(g, new THREE.ConeGeometry(1.1, 5, 12), hull, [0, 0, -8.5], [-Math.PI / 2, 0, 0]);
  part(g, new THREE.SphereGeometry(1, 16, 10), glass, [0, 1.05, -3.8], [0, 0, 0], [0.95, 0.7, 2.4]);
  const wing = wingGeo([[1.2, -1.5], [9.5, 3.2], [9.8, 5.2], [1.2, 5.2]], 0.35);
  part(g, wing, hull, [0, -0.3, 0]);
  part(g, wing, hull, [0, -0.3, 0], [0, 0, 0], [-1, 1, 1]);
  for (const sx of [-1, 1]) {
    part(g, new THREE.CylinderGeometry(0.28, 0.28, 5, 8), dark, [sx * 9.6, -0.3, 2.2], [Math.PI / 2, 0, 0]);
    part(g, new THREE.BoxGeometry(0.3, 3.4, 2.6), hull, [sx * 1.7, 1.8, 5.2], [0.35, 0, sx * -0.3]);
    part(g, new THREE.CylinderGeometry(0.85, 1.05, 3.2, 12), dark, [sx * 1.35, 0, 6.6], [Math.PI / 2, 0, 0]);
    part(g, new THREE.BoxGeometry(0.25, 0.06, 7), accent, [sx * 0.9, 1.05, 1.5]);
  }
  glow(g, new THREE.Color(3, 0.3, 0.3), [-9.8, -0.3, 4.8], 1.2);
  glow(g, new THREE.Color(0.3, 3, 0.5), [9.8, -0.3, 4.8], 1.2);
  const glows = [glow(g, new THREE.Color(0.6, 1.6, 3.2), [-1.35, 0, 8.4], 4.5), glow(g, new THREE.Color(0.6, 1.6, 3.2), [1.35, 0, 8.4], 4.5)];
  return { group: g, glows, gunPorts: [new THREE.Vector3(-9.6, -0.3, -0.5), new THREE.Vector3(9.6, -0.3, -0.5)], exhaust: new THREE.Vector3(0, 0, 9), engineColor: [0.5, 1.4, 3] };
}

export function buildPirateModel() {
  const g = new THREE.Group();
  const hull = mat(0x4d4743, { roughness: 0.55 }), dark = mat(0x1e1c1b, { roughness: 0.7 });
  const red = mat(0x6e1410, { emissive: 0x5a0a04, emissiveIntensity: 1.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x220505, emissive: 0x661010, emissiveIntensity: 0.8, metalness: 0.9, roughness: 0.1 });
  part(g, new THREE.BoxGeometry(3.2, 2.2, 11), hull, [0, 0, 0.5]);
  part(g, new THREE.ConeGeometry(1.9, 5, 4), hull, [0, 0, -7.5], [-Math.PI / 2, Math.PI / 4, 0]);
  part(g, new THREE.SphereGeometry(1, 12, 8), glass, [0, 1.3, -2], [0, 0, 0], [1, 0.6, 1.8]);
  const claw = new THREE.BoxGeometry(0.9, 1.2, 11);
  for (const sx of [-1, 1]) {
    part(g, claw, hull, [sx * 4.6, 0, -2.5], [0, sx * 0.18, 0]);
    part(g, new THREE.BoxGeometry(4, 0.5, 4.5), dark, [sx * 2.6, 0, 1.5]);
    part(g, new THREE.BoxGeometry(0.45, 4.2, 3.2), hull, [sx * 3.6, -1.6, 3.5], [0, 0, sx * 0.4]);
    part(g, new THREE.BoxGeometry(0.2, 0.12, 8), red, [sx * 1.65, 1.12, 0]);
  }
  part(g, new THREE.CylinderGeometry(1.4, 1.7, 3, 10), dark, [0, 0, 6.8], [Math.PI / 2, 0, 0]);
  const glows = [glow(g, new THREE.Color(3.2, 1.1, 0.3), [0, 0, 8.6], 6)];
  return { group: g, glows, gunPorts: [new THREE.Vector3(-4.9, 0, -8), new THREE.Vector3(4.9, 0, -8)], exhaust: new THREE.Vector3(0, 0, 9), engineColor: [3, 1, 0.3] };
}


export function buildMarauderModel() {
  const outer = new THREE.Group();
  const m = buildPirateModel();
  m.group.scale.setScalar(1.45);
  outer.add(m.group);
  const hull = mat(0x3d3834, { roughness: 0.6 }), dark = mat(0x1a1817, { roughness: 0.7 });
  const red = mat(0x6e1410, { emissive: 0x7a0c04, emissiveIntensity: 1.4 });
  for (const sx of [-1, 1]) {
    part(outer, new THREE.CylinderGeometry(1.6, 1.9, 16, 10), hull, [sx * 9.5, -1, 2], [Math.PI / 2, 0, 0]);
    part(outer, new THREE.ConeGeometry(1.6, 3.5, 10), red, [sx * 9.5, -1, -7.7], [-Math.PI / 2, 0, 0]);
    part(outer, new THREE.BoxGeometry(5, 0.6, 3), dark, [sx * 6.5, -1, 2]);
  }
  part(outer, new THREE.BoxGeometry(3.4, 1.8, 4), dark, [0, 2.8, 1]);
  part(outer, new THREE.CylinderGeometry(0.35, 0.35, 5, 6), dark, [0, 3, -2.5], [Math.PI / 2, 0, 0]);
  const glows = [...m.glows, glow(outer, new THREE.Color(3.2, 1.1, 0.3), [-9.5, -1, 10.6], 5), glow(outer, new THREE.Color(3.2, 1.1, 0.3), [9.5, -1, 10.6], 5)];
  return { group: outer, glows, gunPorts: [new THREE.Vector3(-7.1, 0, -11.6), new THREE.Vector3(7.1, 0, -11.6), new THREE.Vector3(0, 3, -5)], exhaust: new THREE.Vector3(0, 0, 13), engineColor: [3, 1, 0.3] };
}

export function buildFreighterModel() {
  const g = new THREE.Group();
  const hull = mat(0xb9ab8c, { metalness: 0.35, roughness: 0.55 }), dark = mat(0x34322e, { roughness: 0.7 });
  const stripe = mat(0xd9a51a, { metalness: 0.2, emissive: 0x3a2800 });
  const win = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd9a0, emissiveIntensity: 1.6 });
  part(g, new THREE.BoxGeometry(11, 8, 13), hull, [0, 1, -30]);
  part(g, new THREE.BoxGeometry(8, 1.2, 0.4), win, [0, 3, -36.6]);
  part(g, new THREE.BoxGeometry(5, 5, 54), dark, [0, 0, 0]);
  const colors = [0xa83a2a, 0x2a5a9a, 0x7d7f84, 0x3f7a3a, 0xb07a20, 0x5a4a8a];
  let k = 0;
  for (const z of [-15, -1, 13]) for (const sx of [-1, 1]) {
    part(g, new THREE.BoxGeometry(8.5, 8.5, 12.5), mat(colors[k++ % colors.length], { metalness: 0.3, roughness: 0.6 }), [sx * 5.4, 0, z]);
  }
  part(g, new THREE.BoxGeometry(16, 10, 9), hull, [0, 0, 29]);
  part(g, new THREE.BoxGeometry(16.2, 1.2, 9.2), stripe, [0, 2.5, 29]);
  const glows = [];
  for (const sx of [-1, 1]) {
    part(g, new THREE.CylinderGeometry(2.2, 2.8, 4, 12), dark, [sx * 4.5, 0, 35], [Math.PI / 2, 0, 0]);
    glows.push(glow(g, new THREE.Color(3, 2, 1), [sx * 4.5, 0, 37.5], 9));
  }
  glow(g, new THREE.Color(3, 0.3, 0.3), [-8.2, 5, 29], 2);
  glow(g, new THREE.Color(0.3, 3, 0.5), [8.2, 5, 29], 2);
  return { group: g, glows, gunPorts: [new THREE.Vector3(0, 5, -30)], exhaust: new THREE.Vector3(0, 0, 39), engineColor: [3, 2, 1] };
}

// ---------------------------------------------------------------------------
// Player upgrades (bought in the station shipyard)
// ---------------------------------------------------------------------------

export const UPGRADES = {
  guns: { name: 'Guns', levels: ['Twin Pulse Laser', 'Pulse Laser Mk II', 'Twin Ion Repeater', 'Plasma Repeater'], costs: [2500, 6000, 12000] },
  shields: { name: 'Shields', levels: ['Class 1 Shield', 'Class 2 Shield', 'Class 3 Shield', 'Class 4 Shield'], costs: [2000, 5000, 10000] },
  armor: { name: 'Armor', levels: ['Durasteel Plating', 'Composite Plating', 'Ceramic Plating', 'Isometal Plating'], costs: [1500, 4000, 8000] },
  engine: { name: 'Engine', levels: ['Stock Drive', 'Tuned Drive', 'Racing Drive', 'Military Drive'], costs: [2500, 6000, 12000] },
  hold: { name: 'Cargo Hold', levels: ['25 units', '40 units', '55 units', '70 units'], costs: [1500, 4000, 9000] },
};

export function applyUpgrades(p, up) {
  const armorFrac = p.armorMax ? p.armor / p.armorMax : 1;
  p.gunDmg = 6 + 1.6 * up.guns;
  p.fireRate = 0.13 - 0.01 * up.guns;
  p.gunName = UPGRADES.guns.levels[up.guns];
  p.shieldMax = 120 + 40 * up.shields;
  p.shieldRegen = 9 + 3 * up.shields;
  p.armorMax = 160 + 60 * up.armor;
  p.armor = p.armorMax * armorFrac;
  // Newtonian drive: accelerations in m/s².
  p.thrust = 110 + 14 * up.engine;
  p.abThrust = 230 + 30 * up.engine;
  p.rcs = 34 + 5 * up.engine;
  const k = 1 + 0.08 * up.engine;
  p.turnRates = [1.35 * k, 1.1 * k, 2.3 * k];
  p.shieldF = Math.min(p.shieldF ?? p.shieldMax, p.shieldMax);
  p.shieldR = Math.min(p.shieldR ?? p.shieldMax, p.shieldMax);
}
export const holdFor = up => 25 + 15 * up.hold;

// ---------------------------------------------------------------------------
// Missiles
// ---------------------------------------------------------------------------

export const MISSILES = {
  dart: { name: 'Dart', label: 'Heat-seeker', lock: 0, accel: 950, turn: 3.2, burn: 4, life: 8, dmg: 45, cost: 90, slots: 1, size: 0.8, color: [3.4, 3, 1.4] },
  seeker: { name: 'Seeker', label: 'Radar seeker', lock: 1.2, accel: 650, turn: 2.4, burn: 6, life: 12, dmg: 85, cost: 200, slots: 1, size: 1, color: [3, 2.4, 1.2] },
  torpedo: { name: 'Torpedo', label: 'Heavy torpedo', lock: 3, accel: 220, turn: 0.9, burn: 16, life: 24, dmg: 320, cost: 650, slots: 2, size: 2.2, color: [1.2, 2.2, 4] },
};
export const MISSILE_SLOTS = 8;
export const missileSlotsUsed = p => Object.entries(p.ammo).reduce((a, [k, n]) => a + n * MISSILES[k].slots, 0);
export const lockTimeFor = p => (p.isPlayer ? MISSILES[p.missileType].lock : MISSILES.seeker.lock);

// ---------------------------------------------------------------------------
// Extra models
// ---------------------------------------------------------------------------

export function buildPoliceModel() {
  const m = buildPlayerModel(0x2c4370, 0xe8eef8);
  m.lightbar = [glow(m.group, new THREE.Color(4, 0.4, 0.3), [-0.7, 1.9, -1.5], 2.2), glow(m.group, new THREE.Color(0.4, 0.9, 4), [0.7, 1.9, -1.5], 2.2)];
  m.engineColor = [0.6, 1.4, 3];
  return m;
}
export function buildWarlordModel() {
  const m = buildMarauderModel();
  const outer = new THREE.Group();
  m.group.scale.setScalar(1.4);
  outer.add(m.group);
  part(outer, new THREE.BoxGeometry(6, 2, 14), mat(0x5a0e0a, { emissive: 0x400602, emissiveIntensity: 1.5 }), [0, 4.6, 2]);
  return { group: outer, glows: m.glows, gunPorts: m.gunPorts.map(v => v.clone().multiplyScalar(1.4)), exhaust: m.exhaust.clone().multiplyScalar(1.4), engineColor: m.engineColor };
}

// ---------------------------------------------------------------------------
// Ship
// ---------------------------------------------------------------------------

const CALLSIGNS = ['Vex', 'Grisk', 'Mordu', 'Slade', 'Hask', 'Rook', 'Jagg', 'Ossa', 'Brine', 'Kord', 'Sill', 'Tarn'];
const HAULERS = ['Kesra', 'Orrin', 'Bellwether', 'Long Haul', 'Patience', 'Marigold', 'Ostrava', 'Nine Lives'];
const PATROLS = ['Lance', 'Warden', 'Aegis', 'Bastion', 'Sentry', 'Vigil'];
const pick = a => a[(Math.random() * a.length) | 0];
const BUILDERS = {
  player: () => buildPlayerModel(), pirate: buildPirateModel, marauder: buildMarauderModel, warlord: buildWarlordModel,
  freighter: buildFreighterModel, smuggler: buildFreighterModel, police: buildPoliceModel,
};
const STATS = {
  pirate: () => ({ name: 'Ashfang ' + pick(CALLSIGNS), cls: 'ASHFANG RAIDER', team: 'pirate', thrust: 105, abThrust: 180, rcs: 45, cruise: 380, radius: 10, shieldMax: 45, armorMax: 60, gunDmg: 6, fireRate: 0.28, shotCost: 5, missiles: Math.random() < 0.5 ? 1 : 0, turn: 1.05 + Math.random() * 0.25, bounty: 250 + ((Math.random() * 6) | 0) * 25 }),
  marauder: () => ({ name: 'Marauder ' + pick(CALLSIGNS), cls: 'ASHFANG MARAUDER', team: 'pirate', thrust: 75, abThrust: 130, rcs: 32, cruise: 320, radius: 16, shieldMax: 95, armorMax: 150, gunDmg: 7, fireRate: 0.2, shotCost: 4, missiles: 2, turn: 0.8 + Math.random() * 0.15, bounty: 650 + ((Math.random() * 6) | 0) * 25 }),
  warlord: () => ({ name: "Krell's Talon", cls: 'ASHFANG WARLORD', team: 'pirate', thrust: 70, abThrust: 120, rcs: 30, cruise: 300, radius: 24, shieldMax: 260, armorMax: 520, gunDmg: 9, fireRate: 0.16, shotCost: 3, missiles: 6, turn: 0.7, bounty: 5000 }),
  smuggler: () => ({ name: 'Ashfang Hauler', cls: 'ASHFANG HAULER', team: 'pirate', thrust: 30, abThrust: 25, rcs: 12, cruise: 200, radius: 34, shieldMax: 60, armorMax: 220, gunDmg: 0, fireRate: 1, shotCost: 0, missiles: 0, turn: 0.35, bounty: 800, hauler: true }),
  freighter: () => ({ name: 'Hauler ' + pick(HAULERS), cls: 'MERCHANT FREIGHTER', team: 'civ', thrust: 28, abThrust: 22, rcs: 12, cruise: 190, radius: 34, shieldMax: 80, armorMax: 240, gunDmg: 0, fireRate: 1, shotCost: 0, missiles: 0, turn: 0.35, hauler: true }),
  police: () => ({ name: `Patrol ${pick(PATROLS)}-${1 + ((Math.random() * 9) | 0)}`, cls: 'AUTHORITY PATROL', team: 'police', thrust: 120, abThrust: 200, rcs: 50, cruise: 420, radius: 11, shieldMax: 110, armorMax: 120, gunDmg: 6, fireRate: 0.2, shotCost: 4, missiles: 1, turn: 1.25 }),
};

export class Ship {
  constructor(game, kind) {
    this.kind = kind;
    this.isPlayer = kind === 'player';
    const m = BUILDERS[kind]();
    this.obj = m.group; this.glows = m.glows; this.gunPorts = m.gunPorts;
    this.exhaust = m.exhaust; this.engineColor = m.engineColor; this.lightbar = m.lightbar || null;
    // One plume per engine glow, sized from the glow (positions are in the glow's parent space).
    this.plumes = this.glows.map(gl => addPlume(gl.parent, gl.position, gl.userData.base * 0.16, this.engineColor.map(c => c * 0.8)));
    this.vel = V(); this.angVel = V(); this.rcsCmd = V();
    this.speed = 0; this.throttle = 0; this.afterburner = false; this.retro = false; this.gAccel = 0;
    this.alive = true; this.lastHit = -10; this.gunCd = 0; this.energy = 100;
    this.lockTime = 0; this.recentHits = 0; this.trailT = 0; this.smokeT = 0; this.retarget = 0; this.angryUntil = -1;
    if (this.isPlayer) {
      Object.assign(this, {
        name: 'You', team: 'player', radius: 11, shotCost: 4.5, decoys: 8, maxDecoys: 10, abFuel: 100,
        ammo: { dart: 2, seeker: 4, torpedo: 0 }, missileType: 'seeker',
      });
      applyUpgrades(this, game.upgrades);
      this.armor = this.armorMax;
    } else {
      Object.assign(this, STATS[kind](), { aiState: 'attack', aiTimer: 0, evadeDir: V(), aiTarget: null });
      this.shieldF = this.shieldR = this.shieldMax;
      this.armor = this.armorMax;
    }
    game.scene.add(this.obj);
  }
  get pos() { return this.obj.position; }
  totalVel(out = V()) { return out.copy(this.vel); }
}

// Who shoots at whom.
export function hostileTo(game, a, b) {
  if (!b || !b.alive || a === b) return false;
  if (a.team === 'pirate') return b.team === 'player' || b.team === 'civ' || b.team === 'police';
  if (a.team === 'police') return b.team === 'pirate' || (b.team === 'player' && (game.isWanted() || a.angryUntil > game.time));
  return false;
}

// Newtonian flight: main engine pushes along the nose, manoeuvring thrusters (RCS)
// push in any direction with a small acceleration, gravity adds to velocity.
// Nothing ever slows a ship down except thrust.
export function updateShipMotion(s, dt, world) {
  const f = forwardOf(s.obj, _a);
  const acc = _b.set(0, 0, 0);
  const main = s.throttle * s.thrust + (s.afterburner ? s.abThrust : 0) - (s.retro ? s.thrust * 0.5 : 0);
  acc.addScaledVector(f, main);
  const rl = s.rcsCmd.length();
  if (rl > 1e-6) acc.addScaledVector(s.rcsCmd, Math.min(1, s.rcs / rl));
  s.gAccel = 0;
  const bh = world.blackHole;
  if (bh) {
    const d = _c.subVectors(bh.pos, s.obj.position);
    const r = d.length();
    if (r < 120000) {
      const a = bh.GM / (r * r);
      s.gAccel = a;
      acc.addScaledVector(d, a / r);
    }
  }
  s.vel.addScaledVector(acc, dt);
  s.obj.position.addScaledVector(s.vel, dt);
  s.speed = s.vel.length();
  s.mainThrust = Math.abs(main) / (s.thrust || 1);
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

const LASER_GEO = new THREE.CylinderGeometry(0.32, 0.32, 24, 6, 1, true);
const lmat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const LASER_MATS = {
  player: lmat(new THREE.Color(0.6, 3.5, 1.6)),
  pirate: lmat(new THREE.Color(3.8, 0.7, 0.3)),
  police: lmat(new THREE.Color(0.6, 1.4, 4)),
  civ: lmat(new THREE.Color(3, 3, 1)),
};

export function fireLasers(game, s) {
  s.obj.updateMatrixWorld();
  const f = forwardOf(s.obj, V());
  const tv = s.totalVel(V());
  const conv = V().copy(s.pos).addScaledVector(f, 1000); // guns converge 1 km ahead
  for (const port of s.gunPorts) {
    const p = port.clone().applyMatrix4(s.obj.matrixWorld);
    const dir = V().subVectors(conv, p).normalize();
    const mesh = new THREE.Mesh(LASER_GEO, LASER_MATS[s.team]);
    mesh.position.copy(p).addScaledVector(dir, 12);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, dir);
    game.scene.add(mesh);
    game.lasers.push({ mesh, vel: dir.multiplyScalar(LASER_SPEED).add(tv), life: 1.1, owner: s, team: s.team, dmg: s.gunDmg });
    game.fx.emit(p, tv, { life: 0.08, size: 4, sizeEnd: 1, color: s.isPlayer ? [1, 4, 2] : s.team === 'police' ? [1, 2, 4] : [4, 1, 0.4] });
  }
  s.energy -= s.shotCost;
  s.gunCd = s.fireRate;
  if (s.isPlayer) audio.laser(1, true);
  else audio.laser(volAt(game, s.pos), false);
}

export function updateLasers(game, dt) {
  const belt = game.world.belt;
  for (let i = game.lasers.length - 1; i >= 0; i--) {
    const L = game.lasers[i];
    const p0 = _a.copy(L.mesh.position);
    L.mesh.position.addScaledVector(L.vel, dt);
    L.life -= dt;
    const p1 = L.mesh.position;
    let dead = L.life <= 0;
    if (!dead) {
      for (const s of game.ships) {
        if (!s.alive || s === L.owner || s.team === L.team) continue;
        if (segSphere(p0, p1, s.pos, s.radius)) { hitShipWith(game, s, L.dmg, p0, L.owner); dead = true; break; }
      }
    }
    if (!dead && belt && p1.distanceToSquared(belt.center) < belt.extent * belt.extent) {
      for (const r of belt.rocks) {
        if (segSphere(p0, p1, r.p, r.r)) { game.fx.sparks(p1, [2.5, 1.6, 0.8], 6); dead = true; break; }
      }
    }
    if (dead) { game.scene.remove(L.mesh); game.lasers.splice(i, 1); }
  }
}

const MSL_GEO = new THREE.CylinderGeometry(0.35, 0.35, 4.5, 8).rotateX(-Math.PI / 2);
const MSL_MAT = mat(0xd8dde4, { metalness: 0.3 });

// Heat-seekers pick the hottest engine in front of the launcher; no lock needed.
export function heatTarget(game, s) {
  const f = forwardOf(s.obj, V());
  let best = null, bs = Infinity;
  for (const o of game.ships) {
    if (!o.alive || o === s || o.team === s.team || o.team === 'civ') continue;
    if (s.isPlayer && o.team === 'police' && !game.isWanted()) continue;
    const to = V().subVectors(o.pos, s.pos);
    const d = to.length();
    const ang = f.angleTo(to);
    if (d < 4500 && ang < 0.5) { const score = d * (1 + ang * 2); if (score < bs) { bs = score; best = o; } }
  }
  return best;
}

export function fireMissile(game, s, target, type = 'seeker') {
  const T = MISSILES[type];
  if (s.isPlayer) { if (!s.ammo[type]) return false; s.ammo[type]--; }
  else { if (s.missiles <= 0) return false; s.missiles--; }
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(MSL_GEO, MSL_MAT);
  body.scale.setScalar(T.size);
  mesh.add(body);
  glow(mesh, new THREE.Color(...(s.isPlayer ? T.color : [3.5, 1.2, 0.4])), [0, 0, 2.8 * T.size], 3.5 * T.size);
  const f = forwardOf(s.obj, V());
  mesh.position.copy(s.pos).addScaledVector(upOf(s.obj, V()), -2.5).addScaledVector(f, s.radius * 0.6);
  mesh.quaternion.copy(s.obj.quaternion);
  game.scene.add(mesh);
  game.missiles.push({
    mesh, owner: s, team: s.team, target, type,
    vel: s.vel.clone().addScaledVector(f, 60),
    accel: s.isPlayer ? T.accel : 520, turn: s.isPlayer ? T.turn : 1.7, burn: T.burn,
    life: T.life, armed: 0.35, dmg: s.isPlayer ? T.dmg : 55, trail: 0, size: T.size,
  });
  audio.missile(s.isPlayer ? (type === 'torpedo' ? 1.4 : 1) : Math.max(0.2, volAt(game, s.pos)));
  return true;
}

export function updateMissiles(game, dt) {
  for (let i = game.missiles.length - 1; i >= 0; i--) {
    const m = game.missiles[i];
    m.life -= dt; m.armed -= dt;
    const p0 = _a.copy(m.mesh.position);
    const t = m.target;
    let tp = null, tv = null, tr = 0;
    if (t) {
      if (t.isDecoy) { if (t.life > 0) { tp = t.pos; tv = t.vel; tr = 40; } }
      else if (t.alive) { tp = t.pos; tv = t.vel; tr = t.radius + 18; }
    }
    if (tp) {
      // Guidance: thrust toward the target while cancelling drift across the line of sight.
      const los = _b.subVectors(tp, p0);
      const dist = los.length();
      los.divideScalar(dist || 1);
      const vRel = _c.subVectors(m.vel, tv);
      const vPerp = vRel.addScaledVector(los, -vRel.dot(los));
      const dir = _d.copy(los).multiplyScalar(m.accel).addScaledVector(vPerp, -2.5).normalize();
      turnToward(m.mesh, dir, m.turn * dt);
    }
    const f = forwardOf(m.mesh, _e);
    if (m.burn > 0) { m.vel.addScaledVector(f, m.accel * dt); m.burn -= dt; }
    m.mesh.position.addScaledVector(m.vel, dt);

    m.trail -= dt;
    if (m.trail <= 0 && m.burn > 0) {
      m.trail = 0.016;
      const back = _f.copy(m.mesh.position).addScaledVector(f, -3 * m.size);
      game.fx.emit(back, m.vel.clone().addScaledVector(f, -60), { life: 0.9, size: 2.5 * m.size, sizeEnd: 9 * m.size, color: [0.5, 0.48, 0.45], colorEnd: [0.08, 0.08, 0.08], alpha: 0.5 });
      game.fx.emit(back, m.vel, { life: 0.12, size: 3 * m.size, sizeEnd: 1, color: [4, 2.4, 0.8] });
    }

    let boom = m.life <= 0, victim = null;
    const p1 = m.mesh.position;
    if (!boom && m.armed <= 0) {
      if (t && !t.isDecoy && t.alive && (segSphere(p0, p1, t.pos, tr) || p1.distanceTo(t.pos) < tr)) { boom = true; victim = t; }
      else if (t && t.isDecoy && tp && segSphere(p0, p1, t.pos, tr)) boom = true;
      else {
        for (const s of game.ships) {
          if (s.alive && s !== m.owner && s.team !== m.team && segSphere(p0, p1, s.pos, s.radius + 6)) { boom = true; victim = s; break; }
        }
      }
    }
    if (boom) {
      game.fx.explosion(p1, m.type === 'torpedo' ? 1.2 : 0.55);
      audio.explosion(volAt(game, p1) * (m.type === 'torpedo' ? 1 : 0.7), m.type === 'torpedo');
      if (victim) hitShipWith(game, victim, m.dmg, p0, m.owner, true);
      game.scene.remove(m.mesh);
      game.missiles.splice(i, 1);
    }
  }
}

export function launchDecoy(game) {
  const p = game.player;
  if (p.decoys <= 0) return false;
  p.decoys--;
  const f = forwardOf(p.obj, V());
  const d = { isDecoy: true, pos: p.pos.clone().addScaledVector(f, -20), vel: p.vel.clone().addScaledVector(f, -150), life: 4 };
  game.decoys.push(d);
  for (const m of game.missiles) if (m.target === p && Math.random() < 0.65) m.target = d;
  audio.decoy();
  return true;
}

export function updateDecoys(game, dt) {
  for (let i = game.decoys.length - 1; i >= 0; i--) {
    const d = game.decoys[i];
    d.life -= dt;
    d.pos.addScaledVector(d.vel, dt);
    _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(60).add(d.vel);
    game.fx.emit(d.pos, _a, { life: 0.5, size: 6, sizeEnd: 2, color: [4, 3.5, 2.5] });
    if (d.life <= 0) game.decoys.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

export function applyDamage(s, dmg, fromPos, now) {
  const fore = forwardOf(s.obj, _f).dot(_g.subVectors(fromPos, s.pos)) >= 0;
  const key = fore ? 'shieldF' : 'shieldR';
  const absorbed = Math.min(s[key], dmg);
  s[key] -= absorbed;
  const rest = dmg - absorbed;
  s.armor -= rest;
  s.lastHit = now;
  return { shield: absorbed > 0, armor: rest > 0, fore, dead: s.armor <= 0 };
}

export function hitShipWith(game, s, dmg, fromPos, src, big = false) {
  const r = applyDamage(s, dmg, fromPos, game.time);
  const at = _e.copy(fromPos).sub(s.pos).setLength(s.radius * 0.8).add(s.pos);
  game.fx.sparks(at, r.armor ? [4, 2, 0.6] : [0.8, 1.8, 4], big ? 40 : 12);
  if (r.shield && game.bubbles && !(s.isPlayer && game.view === 'cockpit')) game.bubbles.add(s, at);
  if (s.isPlayer) game.onPlayerHit(r, dmg);
  else {
    s.recentHits += 1;
    if (src && src.isPlayer) audio.hitConfirm();
    if (src && (s.team === 'police' || s.team === 'pirate')) { s.aiTarget = src; s.retarget = 4; }
    if (s.team === 'police' && src) s.angryUntil = game.time + 25;
    if (game.onNpcHit) game.onNpcHit(s, src);
  }
  if (r.dead && s.alive) destroyShip(game, s, src);
}

export function destroyShip(game, s, killer) {
  s.alive = false;
  s.armor = 0;
  game.fx.explosion(s.pos, s.isPlayer ? 1.6 : s.radius > 20 ? 2 : 1.1, s.totalVel(V()));
  audio.explosion(s.isPlayer ? 1 : Math.max(0.15, volAt(game, s.pos)), true);
  if (s.isPlayer) {
    s.obj.visible = false;
    game.onPlayerDestroyed(killer && killer.team === 'police' ? 'Authority patrol craft destroyed your fighter.' : 'Your fighter was torn apart in combat.');
  } else {
    game.scene.remove(s.obj);
    game.onShipDestroyed(s, killer);
  }
}

// ---------------------------------------------------------------------------
// AI (all Newtonian: ships steer by choosing a desired velocity, then firing
// the main engine when the nose points the right way and RCS for the rest)
// ---------------------------------------------------------------------------

function steer(s, vd, dt, aim) {
  const dv = _c.subVectors(vd, s.vel);
  const dvl = dv.length();
  const f = forwardOf(s.obj, _d);
  const point = aim || (dvl > 20 ? _e.copy(dv).divideScalar(dvl) : f);
  turnToward(s.obj, point, s.turn * dt);
  const along = dvl > 1 ? f.dot(dv) / dvl : 0;
  s.throttle = along > 0.5 && dvl > 10 ? Math.min(1, dvl / s.thrust) * along : 0;
  s.afterburner = along > 0.9 && dvl > 350;
  s.retro = false;
  s.rcsCmd.copy(dv).multiplyScalar(3);
}

function haulerAI(s, game, dt) {
  if (!s.dest) s.dest = { pos: s.pos.clone().addScaledVector(forwardOf(s.obj, V()), 60000) };
  s.recentHits = Math.max(0, s.recentHits - dt * 0.25);
  const to = _b.subVectors(s.dest.pos, s.pos);
  const d = to.length();
  const v = Math.min(s.cruise * (s.recentHits > 0.5 ? 1.5 : 1), Math.sqrt(2 * s.thrust * 0.5 * d) + 20);
  steer(s, to.multiplyScalar(v / (d || 1)), dt, null);
  if (s.recentHits > 0.5) s.afterburner = true;
  if (d < 1400) { s.alive = false; s.docked = true; game.scene.remove(s.obj); }
}

export function updateAI(s, game, dt) {
  s.rcsCmd.set(0, 0, 0);
  if (s.hauler) return haulerAI(s, game, dt);
  s.gunCd -= dt;
  s.energy = Math.min(100, s.energy + 18 * dt);
  s.recentHits = Math.max(0, s.recentHits - dt * 0.5);

  // Choose a target every few seconds.
  s.retarget -= dt;
  if (s.retarget <= 0 || !hostileTo(game, s, s.aiTarget)) {
    s.retarget = 3 + Math.random() * 2;
    let best = null, bd = s.team === 'police' ? 14000 : 9000;
    for (const o of game.ships) {
      if (!hostileTo(game, s, o)) continue;
      const d = o.pos.distanceTo(s.pos) * (o.isPlayer && s.team === 'pirate' ? 0.7 : 1);
      if (d < bd) { bd = d; best = o; }
    }
    s.aiTarget = best;
  }

  const pos = s.pos;
  const bh = game.world.blackHole;
  if (bh) {
    const away = _a.subVectors(pos, bh.pos);
    const bhd = away.length();
    if (bhd < 15000) { steer(s, away.multiplyScalar(s.cruise / bhd).add(s.vel.clone().multiplyScalar(0)), dt, null); return; }
  }

  const p = s.aiTarget;
  if (!p || game.state === 'docking') {
    // Patrol: police wander around their home point, pirates loiter.
    s.home = s.home || pos.clone();
    if (!s.wp || pos.distanceTo(s.wp) < 1200) s.wp = s.home.clone().add(V().set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).multiplyScalar(8000));
    const to = _b.subVectors(s.wp, pos);
    steer(s, to.multiplyScalar(Math.min(220, to.length() * 0.2) / (to.length() || 1)), dt, null);
    s.lockTime = 0;
    return;
  }

  const toP = _a.subVectors(p.pos, pos);
  const dist = toP.length();
  toP.divideScalar(dist || 1);
  if (s.aiState === 'evade') {
    s.aiTimer -= dt;
    steer(s, _b.copy(p.vel).addScaledVector(s.evadeDir, s.cruise), dt, null);
    if (s.aiTimer <= 0) s.aiState = 'attack';
    return;
  }
  // Approach in the target's frame: close fast when far, hold off when near.
  const approach = dist > 2500 ? s.cruise : dist > 900 ? s.cruise * 0.45 : dist > 350 ? 50 : -160;
  const vd = _b.copy(p.vel).addScaledVector(toP, approach);
  // Lead the target: bolts inherit our velocity, so use relative velocity.
  const lead = V().copy(p.pos).addScaledVector(V().subVectors(p.vel, s.vel), dist / LASER_SPEED).sub(pos).normalize();
  steer(s, vd, dt, dist < 3200 ? lead : null);
  const f = forwardOf(s.obj, _d);
  if (s.gunDmg > 0 && dist < 2600 && f.angleTo(lead) < 0.06 && s.gunCd <= 0 && s.energy > 10) fireLasers(game, s);
  if (dist < 4500 && f.angleTo(toP) < 0.3) s.lockTime += dt;
  else s.lockTime = Math.max(0, s.lockTime - dt * 2);
  if (s.missiles > 0 && s.lockTime > 2.5 && Math.random() < dt * 0.35) fireMissile(game, s, p);
  if (dist < 220 || s.recentHits >= 4) {
    s.aiState = 'evade';
    s.aiTimer = 1.6 + Math.random() * 1.6;
    s.recentHits = 0;
    s.evadeDir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().addScaledVector(toP, -0.8).normalize();
  }
}
