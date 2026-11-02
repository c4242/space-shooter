import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createWorld } from './world.js';
import { Particles } from './effects.js';
import { LensingShader } from './lensing.js';
import {
  Ship, forwardOf, upOf, rightOf, faceToward, updateShipMotion, updateAI,
  fireLasers, fireMissile, updateLasers, updateMissiles, launchDecoy, updateDecoys,
  hitShipWith, LOCK_TIME,
} from './ships.js';
import { Hud, fmtDist } from './hud.js';
import { UI } from './ui.js';
import { Cockpit } from './cockpit.js';
import { audio } from './audio.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const COL = { comm: '#9fe8ff', hostile: '#ff7a6a', warn: '#ffc04d', good: '#8dff9e', nav: '#7fd8ff' };
const PIRATE_LINES = [
  'Ashfang: Nice ship. Shame about the pilot.',
  'Ashfang: Dump your cargo and we might let you live.',
  'Ashfang: This is our sector, courier!',
  'Ashfang: Light \'em up!',
  'Ashfang: Fresh meat on the scopes.',
];

// ---------------------------------------------------------------------------
// Renderer & post-processing
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.domElement.id = 'gl';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// Soft studio reflections so metal hulls read well; planets opt out via envMapIntensity: 0.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.5, 1.2e6);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const lensPass = new ShaderPass(LensingShader);
composer.addPass(lensPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.55, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const game = {
  scene, camera, renderer,
  ships: [], lasers: [], missiles: [], decoys: [],
  player: null, target: null, navIndex: 1,
  state: 'menu', view: 'cockpit', time: 0,
  credits: 0, cargo: {}, cargoCap: 25, kills: 0,
  invertPitch: false, mouseFlight: true,
  mouse: { x: innerWidth / 2, y: innerHeight / 2, inside: false, left: false },
  ap: null, fade: 0, shake: 0, dashVisible: false, dashH: 0,
  timers: [], beepT: 0, warnT: 0, alarmT: 0, bumpCd: 0, deadT: 0, deathShown: false,
};
window.sableRift = game; // handy for debugging from the console

game.world = createWorld(scene);
game.navs = game.world.navs;
game.fx = new Particles(scene);
const hud = game.hud = new Hud(game);
const ui = game.ui = new UI(game);
const cockpit = game.cockpit = new Cockpit(game);

game.cargoUsed = () => Object.values(game.cargo).reduce((a, c) => a + c.qty, 0);
const later = (t, fn) => game.timers.push({ t, fn });

// ---------------------------------------------------------------------------
// Camera / dashboard layout
// ---------------------------------------------------------------------------

function updateProjection() {
  const W = innerWidth, H = innerHeight, dh = game.dashVisible ? game.dashH : 0;
  if (dh > 0) {
    // Shift the optical centre up so the crosshair sits in the middle of the view above the dashboard.
    camera.aspect = W / (H + dh);
    camera.setViewOffset(W, H + dh, 0, dh, W, H);
  } else {
    camera.clearViewOffset();
    camera.aspect = W / H;
  }
  camera.updateProjectionMatrix();
  const virtH = (H + dh) * renderer.getPixelRatio();
  game.fx.setScale(virtH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
}

function setDash(visible) {
  game.dashVisible = visible;
  cockpit.canvas.classList.toggle('hidden', !visible);
  game.dashH = visible ? cockpit.L.D : 0;
  updateProjection();
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  hud.resize();
  cockpit.resize();
  setDash(game.dashVisible);
  if (game.state === 'map') { ui.layoutMap(); ui.drawMap(); }
});

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function clearCombat() {
  for (const s of game.ships) if (!s.isPlayer) scene.remove(s.obj);
  for (const L of game.lasers) scene.remove(L.mesh);
  for (const m of game.missiles) scene.remove(m.mesh);
  game.ships = game.ships.filter(s => s.isPlayer);
  game.lasers = []; game.missiles = []; game.decoys = [];
}

function newGame() {
  audio.init();
  clearCombat();
  if (game.player) scene.remove(game.player.obj);
  const p = new Ship(game, 'player');
  game.player = p;
  game.ships = [p];
  Object.assign(game, { credits: 1500, cargo: {}, kills: 0, target: null, time: 0, view: 'cockpit', navIndex: 1, timers: [], deathShown: false, shake: 0 });
  for (const n of game.navs) n.cooldown = n.kind === 'station' ? 90 : 0;
  placeAtStation(game.world.stations[0]);
  p.obj.visible = false;
  game.state = 'flight';
  game.fade = 1;
  ui.hideMenu();
  setDash(true);
  hud.messages = [];
  later(0.6, () => hud.msg('Meridian Highport Control: Launch clear. Fly safe, pilot.', COL.comm));
  later(4, () => hud.msg('Nav is set to Tolvar Refinery. Press A for autopilot, M for the nav map.', COL.nav));
  later(8, () => hud.msg('Trade tip: dock with D, buy low, sell at the other station.', COL.comm));
  later(12, () => hud.msg('Warning: stay well clear of the Sable Rift black hole.', COL.warn));
}

function placeAtStation(st) {
  const p = game.player;
  p.pos.copy(st.pos).addScaledVector(st.axis, 1150);
  faceToward(p.obj, p.pos.clone().add(st.axis), V(0, 1, 0));
  p.speed = p.setSpeed = 150;
  p.vel.copy(st.axis).multiplyScalar(150);
  p.gravVel.set(0, 0, 0);
  p.angVel.set(0, 0, 0);
}

function pause() {
  if (game.state !== 'flight') return;
  game.state = 'paused';
  ui.showMenu('paused');
  audio.engine(0, false, false);
  audio.gravity(0);
}

function resume() {
  if (game.state !== 'paused') return;
  ui.hideMenu();
  game.state = 'flight';
}

document.getElementById('menuBtn').addEventListener('click', () => {
  audio.init();
  if (game.state === 'paused') resume();
  else newGame();
});

game.launchFromStation = st => {
  ui.closeTrade();
  placeAtStation(st);
  game.state = 'flight';
  game.fade = 1;
  hud.msg(`${st.name} Control: Launch clear.`, COL.comm);
  audio.blip();
};

// ---------------------------------------------------------------------------
// Targeting, nav, docking, autopilot
// ---------------------------------------------------------------------------

function cycleTarget() {
  const p = game.player;
  const ships = game.ships.filter(s => s.alive && !s.isPlayer && s.pos.distanceTo(p.pos) < 30000)
    .sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
  const stations = [...game.world.stations].sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
  const list = [...ships, ...stations];
  const i = list.indexOf(game.target);
  game.target = list[(i + 1) % list.length];
  p.lockTime = 0;
  audio.blip();
}

function nearestHostile() {
  const p = game.player;
  let best = null, bd = 30000;
  for (const s of game.ships) {
    if (!s.alive || s.team !== 'pirate') continue;
    const d = s.pos.distanceTo(p.pos);
    if (d < bd) { bd = d; best = s; }
  }
  if (best) { game.target = best; p.lockTime = 0; audio.blip(); }
  else { hud.msg('No hostiles on sensors.', COL.comm); audio.denied(); }
}

function cycleNav() {
  game.navIndex = (game.navIndex + 1) % game.navs.length;
  hud.msg(`Nav ${game.navIndex + 1}: ${game.navs[game.navIndex].name}`, COL.nav);
  audio.blip();
}

game.dockableStation = () => {
  const p = game.player;
  if (!p || !p.alive) return null;
  return game.world.stations.find(st => st.pos.distanceTo(p.pos) < 2200) || null;
};

function hostilesNear(r) {
  const p = game.player;
  return game.ships.some(s => s.alive && s.team === 'pirate' && s.pos.distanceTo(p.pos) < r);
}

function requestDock() {
  const p = game.player;
  const st = game.dockableStation();
  if (!st) {
    const near = [...game.world.stations].sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
    hud.msg(`${near.name}: You are ${fmtDist(near.pos.distanceTo(p.pos))} out. Approach within 2.2 km to dock.`, COL.comm);
    audio.denied();
    return;
  }
  if (hostilesNear(6000)) {
    hud.msg(`${st.name}: Docking denied, hostiles in the area!`, COL.warn);
    audio.denied();
    return;
  }
  hud.msg(`${st.name}: Docking clearance granted.`, COL.good);
  audio.chime();
  game.dockStation = st;
  game.state = 'docking';
}

game.autopilotStatus = () => {
  const p = game.player;
  if (!p || !p.alive) return { ok: false, reason: '' };
  const nav = game.navs[game.navIndex];
  if (p.pos.distanceTo(nav.pos) < nav.arrive + 1500) return { ok: false, reason: `Already at ${nav.name}.` };
  if (hostilesNear(9000)) return { ok: false, reason: 'Autopilot unavailable: hostiles nearby.' };
  if (game.missiles.some(m => m.target === p)) return { ok: false, reason: 'Autopilot unavailable: incoming missile!' };
  if (p.gAccel > 20) return { ok: false, reason: 'Autopilot unavailable: gravity well interference.' };
  return { ok: true };
};

function engageAutopilot() {
  const st = game.autopilotStatus();
  if (!st.ok) { hud.msg(st.reason, COL.warn); audio.denied(); return; }
  const p = game.player, nav = game.navs[game.navIndex];
  faceToward(p.obj, nav.pos, upOf(p.obj));
  const f = forwardOf(p.obj), up = upOf(p.obj), right = rightOf(p.obj);
  const P = p.pos.clone();
  // Cinematic: a fixed camera beside the flight path; the ship streaks across the screen from left to right.
  game.ap = {
    t: 0, nav, P, f, up, from: P.clone(),
    look: P.clone().addScaledVector(f, 60),
    cam: P.clone().addScaledVector(f, 60).addScaledVector(right, 75).addScaledVector(up, 11),
    prevView: game.view,
  };
  game.state = 'autopilot';
  game.target = null;
  setDash(false);
  p.obj.visible = true;
  p.afterburner = false;
  audio.autopilot();
}

function updateAutopilot(dt) {
  const a = game.ap, p = game.player;
  a.t += dt;
  const t = a.t;
  const s = -115 + 30 * t + 11 * t * t * t;
  p.pos.copy(a.P).addScaledVector(a.f, 60 + s);
  p.speed = 60 + 70 * t * t;
  p.afterburner = t > 1.6;
  const back = p.pos.clone().addScaledVector(a.f, -9);
  game.fx.emit(back, a.f.clone().multiplyScalar(-30), { life: 0.6, size: 3, sizeEnd: 0.5, color: [0.5, 1.4, 3] });
  if (p.afterburner) game.fx.emit(back, a.f.clone().multiplyScalar(-60), { life: 0.4, size: 6, sizeEnd: 1, color: [1.5, 2.5, 4] });
  audio.engine(Math.min(1.2, t / 2), p.afterburner, true);

  camera.position.copy(a.cam);
  camera.up.copy(a.up);
  const follow = THREE.MathUtils.smoothstep(t, 1.2, 2.8);
  camera.lookAt(a.look.clone().lerp(p.pos, follow * 0.85));
  if (t > 3.0) game.fade = Math.min(1, (t - 3.0) / 0.5);
  if (t >= 3.6) finishAutopilot();
}

function finishAutopilot() {
  const a = game.ap, nav = a.nav, p = game.player;
  const dir = V().subVectors(nav.pos, a.from).normalize();
  p.pos.copy(nav.pos).addScaledVector(dir, -nav.arrive);
  faceToward(p.obj, nav.pos, a.up);
  p.speed = p.setSpeed = 250;
  p.vel.copy(dir).multiplyScalar(250);
  p.gravVel.set(0, 0, 0);
  p.afterburner = false;
  // Anything left far behind is gone.
  for (const s of game.ships) if (!s.isPlayer && s.alive && s.pos.distanceTo(p.pos) > 25000) { scene.remove(s.obj); s.alive = false; }
  for (const L of game.lasers) scene.remove(L.mesh);
  for (const m of game.missiles) scene.remove(m.mesh);
  game.lasers = []; game.missiles = []; game.decoys = [];
  game.view = a.prevView;
  game.ap = null;
  game.state = 'flight';
  p.obj.visible = game.view === 'external';
  setDash(game.view === 'cockpit');
  game.fade = 1;
  camera.up.set(0, 1, 0);
  hud.msg(`Arrived: ${nav.name}`, COL.nav);
  if (nav.kind === 'station') later(1, () => hud.msg(`${nav.station.name} Control: Welcome. Press D to request docking.`, COL.comm));
  if (nav.kind === 'beacon') later(1, () => hud.msg('Survey beacon: severe gravitational shear ahead. Do NOT approach the Rift.', COL.warn));
  if (nav.kind === 'belt') later(1, () => hud.msg('Cinder Belt: watch for rocks, and for raiders hiding among them.', COL.comm));
}

// ---------------------------------------------------------------------------
// Encounters, combat callbacks, death
// ---------------------------------------------------------------------------

function cargoValue() {
  let v = 0;
  for (const k in game.cargo) v += game.cargo[k].cost;
  return v;
}

function spawnPirates(n) {
  const p = game.player;
  const f = forwardOf(p.obj);
  const base = p.pos.clone().addScaledVector(f, 4200);
  for (let i = 0; i < n; i++) {
    const s = new Ship(game, 'pirate');
    s.pos.copy(base).add(V((Math.random() - 0.5) * 2400, (Math.random() - 0.5) * 1600, (Math.random() - 0.5) * 2400));
    faceToward(s.obj, p.pos, V(0, 1, 0));
    s.speed = s.setSpeed = s.maxSpeed * 0.8;
    s.vel.copy(forwardOf(s.obj)).multiplyScalar(s.speed);
    game.ships.push(s);
  }
  hud.msg(PIRATE_LINES[(Math.random() * PIRATE_LINES.length) | 0], COL.hostile);
  hud.msg(`Contact: ${n} Ashfang raider${n > 1 ? 's' : ''} inbound!`, COL.warn);
  audio.warning();
}

function checkEncounters(dt) {
  const p = game.player;
  for (const nav of game.navs) {
    nav.cooldown = Math.max(0, nav.cooldown - dt);
    if (nav.cooldown > 0 || nav.pos.distanceTo(p.pos) > 9000) continue;
    nav.cooldown = 150;
    if (Math.random() < nav.encounter) {
      const n = 1 + ((Math.random() * 2) | 0) + (cargoValue() > 3000 ? 1 : 0);
      later(1.5 + Math.random() * 2, () => { if (game.state === 'flight' || game.state === 'map') spawnPirates(n); });
    }
  }
}

game.onShipDestroyed = (s, killer) => {
  if (game.target === s) game.target = null;
  if (killer && killer.isPlayer) {
    game.credits += s.bounty;
    game.kills++;
    hud.msg(`${s.name} destroyed. Bounty +${s.bounty} cr`, COL.good);
    audio.cash();
  }
};

game.onPlayerHit = r => {
  hud.flash = r.armor ? 0.5 : 0.22;
  hud.flashRGB = r.armor ? '255,60,30' : '60,140,255';
  game.shake = Math.max(game.shake, r.armor ? 1 : 0.4);
  if (r.armor) audio.armorHit(); else audio.shieldHit();
};

game.onPlayerDestroyed = msg => playerDies(msg);

function playerDies(msg, blackHole = false) {
  if (game.state === 'dead') return;
  const p = game.player;
  if (p.alive) {
    p.alive = false;
    game.fx.explosion(p.pos, blackHole ? 0.6 : 1.6);
    audio.explosion(1, true);
  }
  p.obj.visible = false;
  game.state = 'dead';
  game.deadT = 0;
  game.deathMsg = msg;
  game.deathPos = p.pos.clone();
  game.deathBH = blackHole;
  game.deathShown = false;
  setDash(false);
  hud.flash = 1; hud.flashRGB = blackHole ? '200,120,255' : '255,180,120';
  audio.engine(0, false, false);
  audio.gravity(0);
}

function updateDead(dt) {
  game.deadT += dt;
  const a = game.deadT * 0.25;
  const c = game.deathPos;
  camera.up.set(0, 1, 0);
  if (game.deathBH) {
    // Camera keeps falling toward the hole.
    const bh = game.world.blackHole.pos;
    camera.position.lerp(bh, Math.min(1, dt * 0.25));
    camera.lookAt(bh);
    game.fade = Math.min(1, game.deadT / 3);
  } else {
    camera.position.set(c.x + Math.cos(a) * 110, c.y + 35, c.z + Math.sin(a) * 110);
    camera.lookAt(c);
  }
  if (game.deadT > 3.2 && !game.deathShown) {
    game.deathShown = true;
    ui.showMenu('dead', game.deathMsg);
  }
}

// ---------------------------------------------------------------------------
// Player flight
// ---------------------------------------------------------------------------

const keys = {};

function playerControl(dt) {
  const p = game.player, k = keys;
  let pitch = 0, yaw = 0, roll = 0;
  const inv = game.invertPitch ? -1 : 1;
  if (k.ArrowUp) pitch -= inv;
  if (k.ArrowDown) pitch += inv;
  if (k.ArrowLeft) yaw += 1;
  if (k.ArrowRight) yaw -= 1;
  if (k.KeyQ) roll += 1;
  if (k.KeyE) roll -= 1;
  if (game.mouseFlight && game.mouse.inside) {
    const cx = innerWidth / 2, cy = hud.viewH / 2;
    const R = Math.min(innerWidth, hud.viewH) * 0.38;
    let dx = (game.mouse.x - cx) / R, dy = (game.mouse.y - cy) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    const mm = Math.min(1, m), dz = 0.06;
    if (mm > dz) {
      const sc = (mm - dz) / (1 - dz) / mm;
      yaw -= dx * sc;
      pitch -= dy * sc;
    }
  }
  pitch = THREE.MathUtils.clamp(pitch, -1, 1);
  yaw = THREE.MathUtils.clamp(yaw, -1, 1);
  const [rp, ry, rr] = p.turnRates;
  const k6 = 1 - Math.exp(-6 * dt);
  p.angVel.x += (pitch * rp - p.angVel.x) * k6;
  p.angVel.y += (yaw * ry - p.angVel.y) * k6;
  p.angVel.z += (roll * rr - p.angVel.z) * k6;
  p.obj.rotateX(p.angVel.x * dt);
  p.obj.rotateY(p.angVel.y * dt);
  p.obj.rotateZ(p.angVel.z * dt);

  if (k.KeyW || k.Equal || k.NumpadAdd) p.setSpeed = Math.min(p.maxSpeed, p.setSpeed + 260 * dt);
  if (k.KeyS || k.Minus || k.NumpadSubtract) p.setSpeed = Math.max(0, p.setSpeed - 260 * dt);
  p.afterburner = !!k.Tab && p.abFuel > 0;
  if (p.afterburner) p.abFuel = Math.max(0, p.abFuel - 9 * dt);
  else p.abFuel = Math.min(100, p.abFuel + 0.8 * dt);

  p.gunCd -= dt;
  if ((k.Space || game.mouse.left) && p.gunCd <= 0 && p.energy >= p.shotCost) fireLasers(game, p);
  p.energy = Math.min(100, p.energy + 24 * dt);
}

function playerSystems(dt) {
  const p = game.player;
  if (game.time - p.lastHit > 2.5) {
    p.shieldF = Math.min(p.shieldMax, p.shieldF + 9 * dt);
    p.shieldR = Math.min(p.shieldMax, p.shieldR + 9 * dt);
  }
  // Missile lock: keep a hostile target near the nose, within range.
  const t = game.target;
  if (t && t.team === 'pirate' && t.alive) {
    const to = V().subVectors(t.pos, p.pos);
    const d = to.length();
    if (d < 5000 && forwardOf(p.obj).angleTo(to) < 0.22) {
      const was = p.lockTime;
      p.lockTime = Math.min(LOCK_TIME + 0.3, p.lockTime + dt);
      if (was < LOCK_TIME && p.lockTime >= LOCK_TIME) audio.locked();
    } else p.lockTime = Math.max(0, p.lockTime - dt * 2);
  } else p.lockTime = 0;
  game.beepT -= dt;
  if (p.lockTime > 0 && p.lockTime < LOCK_TIME && game.beepT <= 0) { audio.lockBeep(); game.beepT = 0.3 - p.lockTime * 0.15; }

  game.warnT -= dt;
  if (game.missiles.some(m => m.target === p) && game.warnT <= 0) { audio.warning(); game.warnT = 0.6; }

  const lvl = THREE.MathUtils.clamp((p.gAccel - 10) / 300, 0, 1);
  audio.gravity(lvl);
  game.shake = Math.max(game.shake, lvl * 0.9);
  game.alarmT -= dt;
  if (p.gAccel > 80 && game.alarmT <= 0) { audio.alarm(); game.alarmT = 0.9; }

  audio.engine(p.speed / p.abSpeed, p.afterburner, true);
  if (game.target && game.target.team && !game.target.alive) game.target = null;
}

function bump(center, r) {
  const p = game.player;
  const n = V().subVectors(p.pos, center).normalize();
  const impact = Math.max(0, -p.totalVel().dot(n));
  if (r) p.pos.copy(center).addScaledVector(n, r + p.radius + 2);
  else p.pos.addScaledVector(n, 25);
  p.vel.copy(n).multiplyScalar(impact * 0.6 + 80);
  p.speed *= 0.3;
  p.setSpeed = Math.min(p.setSpeed, 100);
  hitShipWith(game, p, 8 + impact * 0.12, p.pos.clone().sub(n), null, true);
  game.bumpCd = 0.4;
}

function checkCollisions(dt) {
  const p = game.player, w = game.world, bh = w.blackHole;
  if (p.pos.distanceTo(bh.pos) < bh.horizon * 1.1) {
    playerDies('You crossed the event horizon of the Sable Rift. Nothing escapes.', true);
    return;
  }
  for (const pl of w.planets) {
    if (p.pos.distanceTo(pl.pos) < pl.radius + p.radius) {
      playerDies(pl.star ? 'Your ship was vaporized by the star.' : `You crashed into ${pl.name}.`);
      return;
    }
  }
  game.bumpCd -= dt;
  if (game.bumpCd > 0) return;
  if (p.pos.distanceToSquared(w.belt.center) < (w.belt.extent + 500) ** 2) {
    for (const r of w.belt.rocks) {
      if (p.pos.distanceTo(r.p) < r.r + p.radius) { bump(r.p, r.r); return; }
    }
  }
  for (const st of w.stations) if (st.collide(p.pos, p.radius)) { bump(st.pos, 0); return; }
}

function updateFlight(dt) {
  game.time += dt;
  const p = game.player;
  if (p.alive) playerControl(dt);
  for (const s of game.ships) if (s.alive && !s.isPlayer) updateAI(s, game, dt);
  for (const s of game.ships) if (s.alive) updateShipMotion(s, dt, game.world);
  updateLasers(game, dt);
  updateMissiles(game, dt);
  updateDecoys(game, dt);
  if (p.alive && game.state === 'flight') {
    playerSystems(dt);
    checkCollisions(dt);
    checkEncounters(dt);
  }
  game.ships = game.ships.filter(s => s.alive || s.isPlayer);
  for (let i = game.timers.length - 1; i >= 0; i--) {
    const tm = game.timers[i];
    tm.t -= dt;
    if (tm.t <= 0) { game.timers.splice(i, 1); tm.fn(); }
  }
  game.fade = Math.max(0, game.fade - dt * 1.2);
}

function updateShipVisuals(dt) {
  for (const s of game.ships) {
    if (!s.alive) continue;
    const k = (0.45 + 0.9 * Math.min(1.5, s.speed / s.maxSpeed)) * (s.afterburner ? 1.8 : 1) * (0.92 + Math.random() * 0.16);
    for (const gl of s.glows) gl.scale.setScalar(gl.userData.base * k);
    if (s.isPlayer && (game.view === 'cockpit' || game.state === 'autopilot')) continue;
    s.trailT -= dt;
    if (s.trailT <= 0 && s.speed > 30) {
      s.trailT = 0.03;
      const f = forwardOf(s.obj);
      const pos = s.exhaust.clone().applyQuaternion(s.obj.quaternion).add(s.pos);
      const c = s.engineColor;
      game.fx.emit(pos, f.multiplyScalar(-40), { life: 0.5, size: s.afterburner ? 5 : 3, sizeEnd: 0.5, color: [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6] });
    }
  }
}

// ---------------------------------------------------------------------------
// Camera & rendering
// ---------------------------------------------------------------------------

const _camQ = new THREE.Quaternion();
function updateCamera(dt) {
  const p = game.player, st = game.state;
  if (st === 'menu') {
    const s = game.world.stations[0];
    const a = performance.now() / 1000 * 0.04;
    camera.position.set(s.pos.x + Math.cos(a) * 2600, s.pos.y + 600, s.pos.z + Math.sin(a) * 2600);
    camera.up.set(0, 1, 0);
    camera.lookAt(s.pos);
    return;
  }
  if (st === 'autopilot' || st === 'dead' || !p) return;
  if (game.view === 'cockpit') {
    camera.quaternion.copy(p.obj.quaternion);
    camera.position.copy(p.pos).add(V(0, 1.4, -3).applyQuaternion(p.obj.quaternion));
  } else {
    _camQ.copy(p.obj.quaternion);
    camera.quaternion.slerp(_camQ, 1 - Math.exp(-8 * dt));
    camera.position.copy(p.pos).add(V(0, 9, 42).applyQuaternion(camera.quaternion));
    camera.rotateX(-0.06);
  }
  if (game.shake > 0 && st === 'flight') {
    const s = game.shake;
    camera.rotateX((Math.random() - 0.5) * 0.012 * s);
    camera.rotateY((Math.random() - 0.5) * 0.012 * s);
    game.shake = Math.max(0, game.shake - dt * 2.5);
  }
}

const _bhv = V(), _edge = V();
function render() {
  const bh = game.world.blackHole;
  camera.updateMatrixWorld();
  _bhv.copy(bh.pos).applyMatrix4(camera.matrixWorldInverse);
  const u = lensPass.uniforms;
  if (_bhv.z < -bh.horizon * 1.5) {
    const c = bh.pos.clone().project(camera);
    _edge.copy(_bhv); _edge.y += bh.horizon;
    _edge.applyMatrix4(camera.projectionMatrix);
    const r = Math.abs(_edge.y - c.y) * 0.5;
    u.center.value.set((c.x + 1) / 2, (c.y + 1) / 2);
    u.radius.value = r;
    u.strength.value = r > 0.0008 ? 1 : 0;
  } else u.strength.value = 0;
  u.aspect.value = innerWidth / innerHeight;

  composer.render();

  if (game.dashVisible) cockpit.renderScreens(renderer);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function toggleView() {
  game.view = game.view === 'cockpit' ? 'external' : 'cockpit';
  game.player.obj.visible = game.view === 'external';
  setDash(game.view === 'cockpit');
  if (game.view === 'external') camera.quaternion.copy(game.player.obj.quaternion);
}

function playerMissile() {
  const p = game.player;
  if (p.missiles <= 0) { hud.msg('Out of missiles. Buy more at a station.', COL.warn); audio.denied(); return; }
  const locked = game.target && game.target.team === 'pirate' && p.lockTime >= LOCK_TIME;
  fireMissile(game, p, locked ? game.target : null);
  hud.msg(locked ? 'Missile away: locked on.' : 'Missile away: dumbfire.', COL.comm);
}

function onKey(code) {
  const st = game.state;
  if (st === 'menu' || (st === 'dead' && game.deathShown)) {
    if (code === 'Enter' || code === 'Space') newGame();
    return;
  }
  if (st === 'paused') { if (code === 'KeyP' || code === 'Escape' || code === 'KeyH') resume(); return; }
  if (st === 'map') {
    if (code === 'KeyM' || code === 'Escape') ui.closeMap();
    else if (code === 'KeyN') { cycleNav(); ui.drawMap(); }
    else if (code === 'KeyA') { ui.closeMap(); engageAutopilot(); }
    return;
  }
  if (st === 'trade') {
    if (code === 'KeyL' || code === 'Escape') game.launchFromStation(ui.station);
    return;
  }
  if (st !== 'flight') return;
  switch (code) {
    case 'KeyT': cycleTarget(); break;
    case 'KeyR': nearestHostile(); break;
    case 'KeyN': cycleNav(); break;
    case 'KeyM': ui.openMap(); audio.engine(0, false, false); break;
    case 'KeyA': engageAutopilot(); break;
    case 'KeyD': requestDock(); break;
    case 'KeyX':
      if (launchDecoy(game)) hud.msg(`Decoy away (${game.player.decoys} left).`, COL.comm);
      else { hud.msg('No decoys left.', COL.warn); audio.denied(); }
      break;
    case 'Enter': case 'NumpadEnter': playerMissile(); break;
    case 'Backspace': game.player.setSpeed = 0; break;
    case 'KeyV': toggleView(); break;
    case 'KeyI':
      game.invertPitch = !game.invertPitch;
      hud.msg(`Pitch keys: ${game.invertPitch ? 'Up = nose up' : 'Up = nose down'}`, COL.comm);
      break;
    case 'KeyF':
      game.mouseFlight = !game.mouseFlight;
      hud.msg(`Mouse flight ${game.mouseFlight ? 'ON' : 'OFF'}`, COL.comm);
      break;
    case 'KeyK':
      audio.setMuted(!audio.muted);
      hud.msg(audio.muted ? 'Sound muted' : 'Sound on', COL.comm);
      break;
    case 'KeyP': case 'Escape': case 'KeyH': pause(); break;
  }
}

const PREVENT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Enter']);
addEventListener('keydown', e => {
  if (PREVENT.has(e.code)) e.preventDefault();
  audio.init();
  keys[e.code] = true;
  if (!e.repeat) onKey(e.code);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  game.mouse.left = false;
  pause();
});
addEventListener('mousemove', e => { game.mouse.x = e.clientX; game.mouse.y = e.clientY; game.mouse.inside = true; });
document.documentElement.addEventListener('mouseleave', () => { game.mouse.inside = false; game.mouse.left = false; });
addEventListener('mousedown', e => {
  if (game.state !== 'flight') return;
  if (e.button === 0) game.mouse.left = true;
  if (e.button === 2) playerMissile();
});
addEventListener('mouseup', e => { if (e.button === 0) game.mouse.left = false; });
addEventListener('contextmenu', e => e.preventDefault());

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const st = game.state;

  if (st === 'flight') updateFlight(dt);
  else if (st === 'autopilot') updateAutopilot(dt);
  else if (st === 'docking') {
    updateFlight(dt);
    game.fade = Math.min(1, game.fade + dt * 2.6);
    if (game.fade >= 1) {
      game.player.shieldF = game.player.shieldR = game.player.shieldMax;
      clearCombat();
      audio.engine(0, false, false);
      audio.gravity(0);
      ui.openTrade(game.dockStation);
    }
  } else if (st === 'dead') {
    for (const s of game.ships) if (s.alive && !s.isPlayer) { updateAI(s, game, dt); updateShipMotion(s, dt, game.world); }
    updateLasers(game, dt);
    updateMissiles(game, dt);
    updateDead(dt);
  } else if (st === 'map' || st === 'trade' || st === 'paused') {
    audio.engine(0, false, false);
  }

  if (st !== 'map' && st !== 'trade' && st !== 'paused') game.fx.update(dt);
  document.body.classList.toggle('flying', st === 'flight' && game.mouseFlight);
  updateShipVisuals(dt);
  updateCamera(dt);
  game.world.update(dt, camera);
  render();
  hud.draw(dt);
  if (game.dashVisible) cockpit.draw();
}

updateProjection();
requestAnimationFrame(frame);
