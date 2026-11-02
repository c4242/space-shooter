import * as THREE from 'three';
import { radialTexture } from './world.js';
import { audio } from './audio.js';

export const LASER_SPEED = 2600;
export const LOCK_TIME = 1.2;

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

function mat(color, o = {}) { return new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.38, envMapIntensity: 0.7, ...o }); }
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

export function buildPlayerModel() {
  const g = new THREE.Group();
  const hull = mat(0x9ea9b8), dark = mat(0x2b3038, { roughness: 0.65 });
  const accent = mat(0x2a6fd6, { metalness: 0.35, roughness: 0.35 });
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
  p.maxSpeed = 420 + 40 * up.engine;
  p.abSpeed = 950 + 80 * up.engine;
  p.accel = 220 + 25 * up.engine;
  const k = 1 + 0.08 * up.engine;
  p.turnRates = [1.35 * k, 1.1 * k, 2.3 * k];
  p.shieldF = Math.min(p.shieldF ?? p.shieldMax, p.shieldMax);
  p.shieldR = Math.min(p.shieldR ?? p.shieldMax, p.shieldMax);
}
export const holdFor = up => 25 + 15 * up.hold;

// ---------------------------------------------------------------------------
// Ship
// ---------------------------------------------------------------------------

const CALLSIGNS = ['Vex', 'Grisk', 'Mordu', 'Slade', 'Hask', 'Rook', 'Jagg', 'Ossa', 'Brine', 'Kord', 'Sill', 'Tarn'];
const HAULERS = ['Kesra', 'Orrin', 'Bellwether', 'Long Haul', 'Patience', 'Marigold', 'Ostrava', 'Nine Lives'];
const pick = a => a[(Math.random() * a.length) | 0];
const BUILDERS = { player: buildPlayerModel, pirate: buildPirateModel, marauder: buildMarauderModel, freighter: buildFreighterModel };

export class Ship {
  constructor(game, kind) {
    this.kind = kind;
    this.isPlayer = kind === 'player';
    this.team = this.isPlayer ? 'player' : kind === 'freighter' ? 'civ' : 'pirate';
    const m = BUILDERS[kind]();
    this.obj = m.group; this.glows = m.glows; this.gunPorts = m.gunPorts;
    this.exhaust = m.exhaust; this.engineColor = m.engineColor;
    this.vel = V(); this.gravVel = V(); this.angVel = V();
    this.speed = 0; this.setSpeed = 0; this.afterburner = false; this.gAccel = 0;
    this.alive = true; this.lastHit = -10; this.gunCd = 0; this.energy = 100;
    this.lockTime = 0; this.recentHits = 0; this.trailT = 0; this.smokeT = 0; this.retarget = 0;
    if (this.isPlayer) {
      Object.assign(this, { name: 'You', radius: 11, shotCost: 4.5, missiles: 4, maxMissiles: 6, decoys: 8, maxDecoys: 10, abFuel: 100 });
      applyUpgrades(this, game.upgrades);
      this.armor = this.armorMax;
    } else if (kind === 'pirate') {
      Object.assign(this, {
        name: 'Ashfang ' + pick(CALLSIGNS), cls: 'ASHFANG RAIDER',
        maxSpeed: 360, abSpeed: 700, accel: 200, radius: 10,
        shieldMax: 45, armorMax: 60, gunDmg: 6, fireRate: 0.28, shotCost: 5,
        missiles: Math.random() < 0.5 ? 1 : 0, turn: 1.05 + Math.random() * 0.25,
        bounty: 250 + ((Math.random() * 6) | 0) * 25,
      });
    } else if (kind === 'marauder') {
      Object.assign(this, {
        name: 'Marauder ' + pick(CALLSIGNS), cls: 'ASHFANG MARAUDER',
        maxSpeed: 300, abSpeed: 600, accel: 160, radius: 16,
        shieldMax: 95, armorMax: 150, gunDmg: 7, fireRate: 0.2, shotCost: 4,
        missiles: 2, turn: 0.8 + Math.random() * 0.15,
        bounty: 650 + ((Math.random() * 6) | 0) * 25,
      });
    } else {
      Object.assign(this, {
        name: 'Hauler ' + pick(HAULERS), cls: 'MERCHANT FREIGHTER',
        maxSpeed: 190, abSpeed: 280, accel: 60, radius: 34,
        shieldMax: 80, armorMax: 240, gunDmg: 0, fireRate: 1, shotCost: 0, missiles: 0, turn: 0.35,
      });
    }
    if (!this.isPlayer) {
      Object.assign(this, { aiState: 'attack', aiTimer: 0, evadeDir: V(), aiTarget: null });
      this.shieldF = this.shieldR = this.shieldMax;
      this.armor = this.armorMax;
    }
    game.scene.add(this.obj);
  }
  get pos() { return this.obj.position; }
  totalVel(out = V()) { return out.copy(this.vel).add(this.gravVel); }
}

// Arcade "space-sim" flight model: velocity swings toward the nose, plus
// a separate inertial gravity term from the black hole that engines must fight.
export function updateShipMotion(s, dt, world) {
  const target = s.afterburner ? s.abSpeed : s.setSpeed;
  const acc = s.afterburner ? s.accel * 2.4 : s.accel;
  s.speed += THREE.MathUtils.clamp(target - s.speed, -acc * 1.4 * dt, acc * dt);
  const f = forwardOf(s.obj, _a);
  s.vel.lerp(f.multiplyScalar(s.speed), 1 - Math.exp(-3.5 * dt));

  const bh = world.blackHole;
  const d = _b.subVectors(bh.pos, s.obj.position);
  const r = d.length();
  s.gAccel = 0;
  if (r < 90000) {
    const a = bh.GM / (r * r);
    s.gAccel = a;
    s.gravVel.addScaledVector(d.divideScalar(r), a * dt);
  }
  s.gravVel.multiplyScalar(Math.exp(-0.5 * dt));
  s.obj.position.addScaledVector(s.vel, dt).addScaledVector(s.gravVel, dt);
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

const LASER_GEO = new THREE.CylinderGeometry(0.32, 0.32, 24, 6, 1, true);
const LASER_MATS = {
  player: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.5, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  pirate: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.8, 0.7, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
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
    game.fx.emit(p, tv, { life: 0.08, size: 4, sizeEnd: 1, color: s.isPlayer ? [1, 4, 2] : [4, 1, 0.4] });
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
        if (!s.alive || s.team === L.team) continue;
        if (segSphere(p0, p1, s.pos, s.radius)) { hitShipWith(game, s, L.dmg, p0, L.owner); dead = true; break; }
      }
    }
    if (!dead && p1.distanceToSquared(belt.center) < belt.extent * belt.extent) {
      for (const r of belt.rocks) {
        if (segSphere(p0, p1, r.p, r.r)) { game.fx.sparks(p1, [2.5, 1.6, 0.8], 6); dead = true; break; }
      }
    }
    if (dead) { game.scene.remove(L.mesh); game.lasers.splice(i, 1); }
  }
}

const MSL_GEO = new THREE.CylinderGeometry(0.35, 0.35, 4.5, 8).rotateX(-Math.PI / 2);
const MSL_MAT = mat(0xd8dde4, { metalness: 0.3 });

export function fireMissile(game, s, target) {
  if (s.missiles <= 0) return false;
  const mesh = new THREE.Group();
  mesh.add(new THREE.Mesh(MSL_GEO, MSL_MAT));
  glow(mesh, s.isPlayer ? new THREE.Color(3, 2.4, 1.2) : new THREE.Color(3.5, 1.2, 0.4), [0, 0, 2.8], 3.5);
  const f = forwardOf(s.obj, V());
  mesh.position.copy(s.pos).addScaledVector(upOf(s.obj, V()), -2.5).addScaledVector(f, s.radius * 0.6);
  mesh.quaternion.copy(s.obj.quaternion);
  game.scene.add(mesh);
  game.missiles.push({
    mesh, owner: s, team: s.team, target,
    speed: Math.max(200, s.speed + 60), maxSpeed: s.isPlayer ? 1150 : 830, turn: s.isPlayer ? 2.4 : 1.6,
    life: 14, armed: 0.35, dmg: s.isPlayer ? 85 : 55, trail: 0,
  });
  s.missiles--;
  audio.missile(s.isPlayer ? 1 : Math.max(0.2, volAt(game, s.pos)));
  return true;
}

export function updateMissiles(game, dt) {
  for (let i = game.missiles.length - 1; i >= 0; i--) {
    const m = game.missiles[i];
    m.life -= dt; m.armed -= dt;
    m.speed = Math.min(m.maxSpeed, m.speed + 700 * dt);
    const p0 = _a.copy(m.mesh.position);
    const t = m.target;
    let tp = null, tr = 0;
    if (t) {
      if (t.isDecoy) { if (t.life > 0) { tp = t.pos; tr = 40; } }
      else if (t.alive) {
        tp = _b.copy(t.pos);
        const d = tp.distanceTo(p0);
        tp.addScaledVector(t.totalVel(_c), Math.min(2, d / m.speed) * 0.6);
        tr = t.radius + 16;
      }
    }
    if (tp) turnToward(m.mesh, _d.subVectors(tp, p0).normalize(), m.turn * dt);
    const f = forwardOf(m.mesh, _c);
    m.mesh.position.addScaledVector(f, m.speed * dt);

    m.trail -= dt;
    if (m.trail <= 0) {
      m.trail = 0.016;
      const back = _e.copy(m.mesh.position).addScaledVector(f, -3);
      game.fx.emit(back, _f.copy(f).multiplyScalar(-40), { life: 0.9, size: 2.5, sizeEnd: 9, color: [0.5, 0.48, 0.45], colorEnd: [0.08, 0.08, 0.08], alpha: 0.5 });
      game.fx.emit(back, null, { life: 0.12, size: 3, sizeEnd: 1, color: [4, 2.4, 0.8] });
    }

    let boom = m.life <= 0, victim = null;
    if (!boom && m.armed <= 0) {
      if (t && !t.isDecoy && t.alive && segSphere(p0, m.mesh.position, t.pos, tr)) { boom = true; victim = t; }
      else if (t && t.isDecoy && tp && segSphere(p0, m.mesh.position, t.pos, tr)) boom = true;
      else {
        for (const s of game.ships) {
          if (s.alive && s.team !== m.team && segSphere(p0, m.mesh.position, s.pos, s.radius + 6)) { boom = true; victim = s; break; }
        }
      }
    }
    if (boom) {
      game.fx.explosion(m.mesh.position, 0.55);
      audio.explosion(volAt(game, m.mesh.position) * 0.7, false);
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
  const d = { isDecoy: true, pos: p.pos.clone().addScaledVector(f, -20), vel: f.clone().multiplyScalar(-150).add(p.totalVel(V()).multiplyScalar(0.5)), life: 4 };
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
    d.vel.multiplyScalar(Math.exp(-0.6 * dt));
    _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(60);
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
    if (s.team === 'civ' && game.onCivHit) game.onCivHit(s, src);
  }
  if (r.dead && s.alive) destroyShip(game, s, src);
}

export function destroyShip(game, s, killer) {
  s.alive = false;
  s.armor = 0;
  game.fx.explosion(s.pos, s.isPlayer ? 1.6 : 1.1, s.totalVel(V()).multiplyScalar(0.3));
  audio.explosion(s.isPlayer ? 1 : Math.max(0.15, volAt(game, s.pos)), true);
  if (s.isPlayer) {
    s.obj.visible = false;
    game.onPlayerDestroyed('Your fighter was torn apart by Ashfang guns.');
  } else {
    game.scene.remove(s.obj);
    game.onShipDestroyed(s, killer);
  }
}

// ---------------------------------------------------------------------------
// Pirate AI
// ---------------------------------------------------------------------------

function updateFreighterAI(s, game, dt) {
  s.recentHits = Math.max(0, s.recentHits - dt * 0.25);
  const dest = s.dest;
  const to = _c.subVectors(dest.pos, s.pos);
  const d = to.length();
  s.setSpeed = s.maxSpeed;
  s.afterburner = s.recentHits > 0.5;
  turnToward(s.obj, to.divideScalar(d || 1), s.turn * dt);
  if (d < 1400) { s.alive = false; s.docked = true; game.scene.remove(s.obj); }
}

export function updateAI(s, game, dt) {
  if (s.kind === 'freighter') return updateFreighterAI(s, game, dt);
  // Pick a victim every few seconds: the player is preferred, nearby freighters are fair game.
  s.retarget -= dt;
  if (s.retarget <= 0 || !s.aiTarget || !s.aiTarget.alive) {
    s.retarget = 3 + Math.random() * 2;
    let best = game.player && game.player.alive ? game.player : null;
    let bd = best ? best.pos.distanceTo(s.pos) * 0.7 : Infinity;
    for (const o of game.ships) {
      if (!o.alive || o.team !== 'civ') continue;
      const d = o.pos.distanceTo(s.pos);
      if (d < bd && d < 9000) { bd = d; best = o; }
    }
    s.aiTarget = best;
  }
  const p = s.aiTarget || game.player;
  const pos = s.pos;
  const bh = game.world.blackHole;
  const fromBH = _a.subVectors(pos, bh.pos);
  const bhd = fromBH.length();
  const desired = _b;
  s.afterburner = false;
  s.gunCd -= dt;
  s.energy = Math.min(100, s.energy + 18 * dt);
  s.recentHits = Math.max(0, s.recentHits - dt * 0.5);

  if (bhd < 15000) {
    desired.copy(fromBH).normalize();
    s.setSpeed = s.maxSpeed;
    s.afterburner = bhd < 9000;
  } else if (!p.alive || game.state !== 'flight') {
    forwardOf(s.obj, desired);
    s.setSpeed = s.maxSpeed * 0.6;
  } else {
    const toP = _c.subVectors(p.pos, pos);
    const dist = toP.length();
    if (s.aiState === 'evade') {
      s.aiTimer -= dt;
      desired.copy(s.evadeDir);
      s.setSpeed = s.maxSpeed;
      s.afterburner = s.aiTimer > 0.8;
      if (s.aiTimer <= 0) s.aiState = 'attack';
    } else {
      desired.copy(p.pos).addScaledVector(p.totalVel(_d), dist / LASER_SPEED).sub(pos).normalize();
      s.setSpeed = dist > 2500 ? s.maxSpeed : dist > 700 ? s.maxSpeed * 0.8 : s.maxSpeed * 0.55;
      s.afterburner = dist > 6000;
      const f = forwardOf(s.obj, _d);
      if (dist < 2600 && f.angleTo(desired) < 0.06 && s.gunCd <= 0 && s.energy > 10) fireLasers(game, s);
      toP.divideScalar(dist || 1);
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
  }
  turnToward(s.obj, desired, s.turn * dt);
}
