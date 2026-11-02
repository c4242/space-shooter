import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getWorld, SYSTEMS } from './world.js';
import { Particles, Bubbles, Dust, WarpTunnel } from './effects.js';
import { LensingShader } from './lensing.js';
import { LensFinishShader, FlareShader } from './shaders.js';
import {
  Ship, forwardOf, upOf, rightOf, faceToward, updateShipMotion, updateAI,
  fireLasers, fireMissile, updateLasers, updateMissiles, launchDecoy, updateDecoys,
  hitShipWith, panAt, buildFreighterModel, glowTex, lockTimeFor, heatTarget, applyUpgrades, applySystems, holdFor, MISSILES, SYSTEMS_INFO,
} from './ships.js';
import { hasSave, loadSave, saveGame, changeRep, REP_WANTED, gateToward, stationNav, RANKS, rankOf, rankBonus } from './career.js';
import { STORY, newStory, currentStep } from './story.js';
import { Hud, fmtDist } from './hud.js';
import { UI } from './ui.js';
import { Cockpit } from './cockpit.js';
import { initTouch } from './touch.js';
import { Salvage } from './salvage.js';
import { audio } from './audio.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const COL = { comm: '#9fe8ff', hostile: '#ff7a6a', warn: '#ffc04d', good: '#8dff9e', nav: '#7fd8ff', story: '#ffd36b', police: '#8ec4ff' };
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

// Quality: ?quality=low (or a touch device) turns off MSAA and lowers resolution for slower GPUs.
let SETTINGS = { master: 1, music: 0.8, sfx: 1, sens: 1, invert: false, mouseFlight: true, quality: null };
try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem('sableRift.settings') || '{}')); } catch { /* defaults */ }
const qParam = new URLSearchParams(location.search).get('quality');
const LOW_GFX = qParam ? qParam === 'low' : SETTINGS.quality ? SETTINGS.quality === 'low' : matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, LOW_GFX ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.domElement.id = 'gl';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// Soft studio reflections so metal hulls read well; planets opt out via envMapIntensity: 0.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.5, 1.2e6);

// HDR render target with MSAA (when supported) so edges stay smooth through post-processing.
const msaa = !LOW_GFX && renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float') ? 4 : 0;
const pr0 = renderer.getPixelRatio();
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * pr0, innerHeight * pr0, { type: THREE.HalfFloatType, samples: msaa }));
composer.addPass(new RenderPass(scene, camera));
const lensPass = new ShaderPass(LensingShader);
composer.addPass(lensPass);
// High threshold: only genuinely bright things (stars, engines, lasers, explosions) bloom; space stays black.
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.08, 0.92);
composer.addPass(bloom);
const flarePass = new ShaderPass(FlareShader);
composer.addPass(flarePass);
composer.addPass(new ShaderPass(LensFinishShader));
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const game = {
  scene, camera, renderer,
  ships: [], lasers: [], missiles: [], decoys: [],
  player: null, target: null, navIndex: 1, sys: 'sable',
  state: 'menu', view: 'cockpit', time: 0,
  credits: 0, cargo: {}, cargoCap: 25, kills: 0, rep: { authority: 0, ashfang: 0 },
  upgrades: { guns: 0, shields: 0, armor: 0, engine: 0, hold: 0 }, missions: [], missionSeq: 0, trafficT: 8, policeT: 20,
  hull: 'kestrel', wing: null,
  story: newStory(),
  invertPitch: false, mouseFlight: true, touchMode: false, flightAssist: false, matching: false,
  mouse: { x: innerWidth / 2, y: innerHeight / 2, inside: false, left: false },
  ap: null, jump: null, fade: 0, shake: 0, dashVisible: false, dashH: 0,
  timers: [], beepT: 0, warnT: 0, alarmT: 0, bumpCd: 0, deadT: 0, deathShown: false,
};
window.sableRift = game; // handy for debugging from the console

game.world = getWorld(scene, 'sable');
game.navs = game.world.navs;
game.fx = new Particles(scene, 6000, LOW_GFX ? 1 : 3);
game.bubbles = new Bubbles(scene);
const salvage = game.salvage = new Salvage(game);
const dust = new Dust(scene);
const warp = new WarpTunnel(scene);
const hud = game.hud = new Hud(game);
const ui = game.ui = new UI(game);
const cockpit = game.cockpit = new Cockpit(game);

game.applyUpgrades = () => {
  applyUpgrades(game.player, game.upgrades, game.hull);
  game.cargoCap = holdFor(game.upgrades, game.hull);
};

// Swap the player's hull (shipyard). The new ship keeps cargo, ammo and position.
game.changeHull = id => {
  const old = game.player;
  game.hull = id;
  const p = new Ship(game, 'player');
  p.ammo = old.ammo; p.missileType = old.missileType; p.decoys = old.decoys; p.abFuel = old.abFuel;
  p.pos.copy(old.pos); p.obj.quaternion.copy(old.obj.quaternion);
  p.obj.visible = old.obj.visible;
  scene.remove(old.obj);
  game.ships = game.ships.map(s => (s === old ? p : s));
  game.player = p;
  game.cargoCap = holdFor(game.upgrades, game.hull);
};

const WING_NAMES = ['Nova', 'Kite', 'Harrow', 'Juno', 'Rook', 'Sabre', 'Tamsin', 'Vale'];
game.hireWing = () => {
  game.wing = { name: WING_NAMES[(Math.random() * WING_NAMES.length) | 0], armorFrac: 1, kills: 0 };
};
function spawnWing() {
  if (!game.wing || game.ships.some(s => s.wing && s.alive)) return;
  const p = game.player;
  const w = new Ship(game, 'wingman');
  w.name = `Wing: ${game.wing.name}`;
  w.armor = w.armorMax * game.wing.armorFrac;
  w.pos.copy(p.pos).add(V(-45, 10, 35).applyQuaternion(p.obj.quaternion));
  w.obj.quaternion.copy(p.obj.quaternion);
  w.vel.copy(p.vel);
  game.ships.push(w);
}
function regroupWing() {
  const w = game.ships.find(s => s.wing && s.alive);
  const p = game.player;
  if (!w) return;
  w.pos.copy(p.pos).add(V(-45, 10, 35).applyQuaternion(p.obj.quaternion));
  w.obj.quaternion.copy(p.obj.quaternion);
  w.vel.copy(p.vel);
  w.aiTarget = null;
}
game.cargoUsed = () => Object.values(game.cargo).reduce((a, c) => a + c.qty, 0);
game.isWanted = () => game.rep.authority <= REP_WANTED;
game.storyStep = () => currentStep(game.story);
const later = (t, fn) => game.timers.push({ t, fn });

// Pilot score and rank.
game.score = 0;
function addScore(n) {
  const before = rankOf(game.score);
  game.score += n;
  const after = rankOf(game.score);
  if (after > before) {
    hud.banner(`PROMOTED: ${RANKS[after].name.toUpperCase()}`, `All bounties and contract pay +${after * 5}%`);
    audio.chime();
    later(0.7, () => audio.chime());
  }
}
game.rankName = () => RANKS[rankOf(game.score)].name;

function rep(faction, delta, why) {
  const { before, after } = changeRep(game, faction, delta);
  if (faction === 'authority') {
    if (before > REP_WANTED && after <= REP_WANTED) { hud.msg('AUTHORITY: You are now WANTED. Patrols will engage you on sight.', COL.hostile); audio.warning(); }
    if (before <= REP_WANTED && after > REP_WANTED) hud.msg('Authority: Your record is clear. You are no longer wanted.', COL.good);
  }
  if (why) hud.msg(`${why} (${faction === 'authority' ? 'Authority' : 'Ashfang'} ${delta > 0 ? '+' : ''}${Math.round(delta)})`, delta > 0 ? COL.good : COL.warn);
}

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
// Systems & game flow
// ---------------------------------------------------------------------------

function forgetShip(s) {
  scene.remove(s.obj);
  if (s.missionId) { const m = game.missions.find(x => x.id === s.missionId); if (m) m.spawned = false; }
  if (s.storyTag) storyLost();
}

function clearCombat(keepWing = false) {
  if (game.event) clearEvent();
  const wing = game.ships.find(s => s.wing && s.alive);
  if (wing && game.wing) game.wing.armorFrac = wing.armor / wing.armorMax;
  for (const s of game.ships) if (!s.isPlayer && !(keepWing && s.wing)) forgetShip(s);
  for (const L of game.lasers) scene.remove(L.mesh);
  for (const m of game.missiles) scene.remove(m.mesh);
  game.ships = game.ships.filter(s => s.isPlayer || (keepWing && s.wing));
  game.lasers = []; game.missiles = []; game.decoys = [];
  salvage.clear();
}

function setSystem(id) {
  clearCombat(true);
  game.sys = id;
  game.world = getWorld(scene, id);
  game.navs = game.world.navs;
  game.target = null;
  for (const n of game.navs) n.cooldown = n.kind === 'station' ? 60 : n.kind === 'jump' ? 40 : 0;
  game.trafficT = 6; game.policeT = 10 + Math.random() * 20;
  if (game.player) spawnBehemoths();
}

function startCareer(save) {
  audio.init();
  clearCombat();
  if (game.player) scene.remove(game.player.obj);
  Object.assign(game, {
    credits: 1500, cargo: {}, kills: 0, target: null, time: 0, view: 'cockpit', navIndex: 1, timers: [],
    deathShown: false, shake: 0, missions: [], missionSeq: 0, rep: { authority: 0, ashfang: 0 }, story: newStory(), hull: 'kestrel', wing: null, score: 0, eventT: 90, event: null,
    upgrades: { guns: 0, shields: 0, armor: 0, engine: 0, hold: 0 },
  });
  if (save) {
    Object.assign(game, {
      credits: save.credits, cargo: save.cargo || {}, kills: save.kills || 0,
      missions: save.missions || [], missionSeq: save.missionSeq || 0, upgrades: { ...game.upgrades, ...save.upgrades },
      rep: { ...game.rep, ...save.rep }, story: { ...newStory(), ...save.story }, hull: save.hull || 'kestrel', wing: save.wing || null, score: save.score || 0,
    });
    for (const m of game.missions) if (m.type === 'bounty') m.spawned = false;
    game.story.spawned = false;
  }
  setSystem(save ? save.sys : 'sable');
  game.navIndex = save ? save.navIndex ?? 0 : 1;
  const p = new Ship(game, 'player');
  game.player = p;
  game.ships = [p];
  spawnBehemoths();
  game.cargoCap = holdFor(game.upgrades, game.hull);
  if (save) {
    p.ammo = { ...p.ammo, ...save.ammo }; p.missileType = save.missileType || 'seeker';
    p.decoys = save.decoys; p.abFuel = save.abFuel;
    p.armor = p.armorMax * (save.armorFrac ?? 1);
    if (save.sysHealth) { p.sys = { ...p.sys, ...save.sysHealth }; applySystems(p); }
  }
  const st = game.world.stations[save ? save.station : 0] || game.world.stations[0];
  placeAtStation(st);
  p.obj.visible = false;
  spawnWing();
  game.state = 'flight';
  game.fade = 1;
  ui.hideMenu();
  setDash(true);
  hud.messages = [];
  hud.cracks = [];
  autoRoute();
  if (save) {
    later(0.6, () => hud.msg(`${st.name} Control: Welcome back, pilot. Launch clear.`, COL.comm));
  } else {
    later(0.6, () => hud.msg('Meridian Highport Control: Launch clear. Fly safe, pilot.', COL.comm));
    later(4, () => hud.msg('Newtonian flight: you keep drifting. Hold C to brake, or burn at the retrograde marker.', COL.nav));
    later(6.5, () => hud.msg('Tip: hold ALT to free the mouse cursor, then click a ship on screen to target it.', COL.nav));
    later(9, () => hud.msg('Press A for autopilot, M for the nav map. Dock with D for trade, contracts, upgrades and the STORY.', COL.comm));
    later(14, () => hud.msg('Dr. Varro at Meridian Highport has a job for you: dock and open the STORY tab.', COL.story));
  }
}
const newGame = () => startCareer(null);
const continueGame = () => startCareer(loadSave());

function saveAt(st) { saveGame(game, game.world.stations.indexOf(st)); }

function placeAtStation(st) {
  const p = game.player;
  p.pos.copy(st.pos).addScaledVector(st.axis, 1150);
  faceToward(p.obj, p.pos.clone().add(st.axis), V(0, 1, 0));
  p.throttle = 0;
  p.vel.copy(st.axis).multiplyScalar(60);
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

function menuPrimary() {
  audio.init();
  if (game.state === 'paused') resume();
  else if (hasSave() && (game.state === 'menu' || game.state === 'dead')) continueGame();
  else newGame();
}
document.getElementById('menuBtn').addEventListener('click', menuPrimary);
document.getElementById('menuBtn2').addEventListener('click', () => { audio.init(); newGame(); });
ui.showMenu('start');

// ---- Settings panel (shown on the pause screen); saved in the browser.
function saveSettings() { try { localStorage.setItem('sableRift.settings', JSON.stringify(SETTINGS)); } catch { /* fine */ } }
function applySettings() {
  audio.setVolumes({ master: SETTINGS.master, music: SETTINGS.music, sfx: SETTINGS.sfx });
  game.invertPitch = SETTINGS.invert;
  game.mouseFlight = SETTINGS.mouseFlight;
}
{
  const $ = id => document.getElementById(id);
  const bind = (id, key, prop = 'value', conv = Number) => {
    const el = $(id);
    el[prop] = SETTINGS[key];
    el.addEventListener('input', () => { SETTINGS[key] = conv(el[prop]); saveSettings(); applySettings(); });
  };
  bind('setMaster', 'master'); bind('setMusic', 'music'); bind('setSfx', 'sfx'); bind('setSens', 'sens');
  bind('setInvert', 'invert', 'checked', Boolean); bind('setMouseFlight', 'mouseFlight', 'checked', Boolean);
  const q = $('setQuality');
  q.value = LOW_GFX ? 'low' : 'high';
  q.addEventListener('change', () => {
    SETTINGS.quality = q.value; saveSettings();
    $('setNote').textContent = 'Graphics quality takes effect after reloading the page (your career is saved when you dock).';
  });
  applySettings();
}

game.launchFromStation = st => {
  ui.closeTrade();
  ui.notice = null;
  placeAtStation(st);
  saveAt(st);
  spawnWing();
  spawnBehemoths();
  resetChase();
  game.state = 'flight';
  game.fade = 1;
  autoRoute();
  hud.msg(`${st.name} Control: Launch clear.`, COL.comm);
  audio.blip();
};

// Point the nav computer at the current objective (story first, then the first contract),
// routing through jump gates when the objective is in another system.
function autoRoute() {
  const step = game.storyStep();
  let sys = null, nav = -1;
  if (step && step.sys) { sys = step.sys; nav = step.do === 'dock' ? stationNav(step.sys, step.station) : step.nav; }
  else if (game.missions[0]) {
    const m = game.missions[0];
    sys = m.sys; nav = m.type === 'bounty' ? m.navIndex : stationNav(m.sys, m.dest);
  }
  if (!sys) return;
  const idx = sys === game.sys ? nav : gateToward(game.sys, sys);
  if (idx >= 0) game.navIndex = idx;
}
game.autoRoute = autoRoute;

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------

game.storyAvailableHere = st => {
  const S = game.story;
  if (S.active || S.ch >= STORY.length) return false;
  const g = STORY[S.ch].giver;
  return g.sys === game.sys && g.station === st.index;
};

game.acceptStory = () => {
  const S = game.story, ch = STORY[S.ch];
  Object.assign(S, { active: true, step: 0, spawned: false });
  if (ch.grant) for (const [k, n] of Object.entries(ch.grant)) game.player.ammo[k] += n;
  audio.chime();
  ui.notice = { title: `CHAPTER ${S.ch + 1} ACCEPTED`, text: `Objective: ${ch.steps[0].text}. Your nav computer has been set.` };
  autoRoute();
};

function storyAdvance() {
  const S = game.story, ch = STORY[S.ch];
  S.step++;
  S.spawned = false;
  const step = ch.steps[S.step];
  if (step) { hud.msg(`Story: ${step.text}`, COL.story); autoRoute(); }
}

function storyLost() {
  // Story enemies were left behind: go back to the "reach" step so they come again.
  const S = game.story;
  if (!S.active) return;
  const step = currentStep(S);
  if (step && step.do === 'kill') { S.step--; S.spawned = false; }
}

function storyUpdate() {
  const S = game.story;
  const step = currentStep(S);
  if (!step || game.state !== 'flight') return;
  if (step.do === 'reach' && step.sys === game.sys && game.navs[step.nav].pos.distanceTo(game.player.pos) < step.r) {
    hud.msg(step.done, COL.story);
    audio.chime();
    if (step.spawn) {
      const list = step.spawn.flatMap(([k, n]) => Array(n).fill(k));
      S.pending = true;
      later(1.2, () => {
        S.pending = false;
        spawnGroup(list, { storyTag: true });
        hud.msg(step.spawnMsg, COL.hostile);
        audio.warning();
      });
    }
    storyAdvance();
  } else if (step.do === 'kill') {
    if (!S.pending && !game.ships.some(s => s.alive && s.storyTag)) {
      hud.msg('All hostiles destroyed.', COL.good);
      storyAdvance();
    }
  }
}

function storyOnDock(st) {
  const S = game.story;
  const step = currentStep(S);
  if (!step || step.do !== 'dock' || step.sys !== game.sys || step.station !== st.index) return;
  const ch = STORY[S.ch];
  game.credits += ch.reward;
  addScore(10);
  changeRep(game, 'authority', 10);
  ui.notice = { title: `CHAPTER ${S.ch + 1} COMPLETE: ${ch.title.toUpperCase()} (+${ch.reward.toLocaleString()} cr)`, text: ch.debrief };
  ui.tab = 'story';
  Object.assign(S, { ch: S.ch + 1, active: false, step: 0, spawned: false });
  audio.chime();
}

// ---------------------------------------------------------------------------
// Targeting, nav, docking, jumping, autopilot
// ---------------------------------------------------------------------------

function cycleTarget() {
  const p = game.player;
  const ships = game.ships.filter(s => s.alive && !s.isPlayer && s.pos.distanceTo(p.pos) < 30000)
    .sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
  const stations = [...game.world.stations].sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
  const pods = salvage.pods.filter(x => x.pos.distanceTo(p.pos) < 8000).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
  const list = [...ships, ...pods, ...stations];
  const i = list.indexOf(game.target);
  game.target = list[(i + 1) % list.length];
  p.lockTime = 0;
  audio.blip();
}

const isThreat = s => s.alive && (s.team === 'pirate' || (s.team === 'police' && (game.isWanted() || s.angryUntil > game.time)));

function nearestHostile() {
  const p = game.player;
  let best = null, bd = 30000;
  for (const s of game.ships) {
    if (!isThreat(s)) continue;
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
const nearGate = () => {
  const p = game.player;
  return game.navs.find(n => n.kind === 'jump' && n.pos.distanceTo(p.pos) < 2500) || null;
};
game.nearGate = nearGate;

function hostilesNear(r) {
  const p = game.player;
  return game.ships.some(s => isThreat(s) && s.pos.distanceTo(p.pos) < r);
}

function requestDock() {
  const p = game.player;
  const st = game.dockableStation();
  if (!st) {
    const near = [...game.world.stations].sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
    if (!near) { hud.msg('No stations in this system.', COL.comm); audio.denied(); return; }
    hud.msg(`${near.name}: You are ${fmtDist(near.pos.distanceTo(p.pos))} out. Approach within 2.2 km to dock.`, COL.comm);
    audio.denied();
    return;
  }
  if (p.speed > 150) {
    hud.msg(`${st.name}: You're moving at ${Math.round(p.speed)} m/s. Slow below 150 m/s to dock (hold C to brake).`, COL.warn);
    audio.denied();
    return;
  }
  if (hostilesNear(6000)) {
    hud.msg(`${st.name}: Docking denied, hostiles in the area!`, COL.warn);
    audio.denied();
    return;
  }
  if (st.outpost && game.rep.ashfang <= -40) {
    hud.msg(`${st.name}: We know what you've done to our crews. Docking denied. Leave while you can.`, COL.hostile);
    audio.denied();
    return;
  }
  if (!st.outpost && game.isWanted()) {
    const fine = 1500 + Math.round(-game.rep.authority * 60);
    if (game.credits < fine) {
      hud.msg(`${st.name}: You are wanted. Outstanding fine ${fine} cr. Docking denied.`, COL.hostile);
      audio.denied();
      return;
    }
    game.credits -= fine;
    rep('authority', REP_WANTED + 15 - game.rep.authority, `Fine of ${fine} cr paid`);
  }
  hud.msg(`${st.name}: Docking clearance granted.`, COL.good);
  audio.chime();
  game.dockStation = st;
  // Cinematic approach: the ship flies a curve into the docking bay, watched from outside.
  const up = V(0, 1, 0).applyQuaternion(st.group.quaternion);
  const side = V().crossVectors(st.axis, up).normalize();
  game.dock = {
    t: 0, T: 5.5, st, prevView: game.view,
    p0: p.pos.clone(), p1: p.pos.clone().addScaledVector(p.vel, 1.5),
    p2: st.pos.clone().addScaledVector(st.axis, 1700), p3: st.pos.clone().addScaledVector(st.axis, 420),
    up, cam: st.pos.clone().addScaledVector(st.axis, 2300).addScaledVector(side, 1100).addScaledVector(up, 380),
    look: p.pos.clone(),
  };
  game.target = null;
  hud.messages = hud.messages.filter(m => /Docking clearance/.test(m.text));
  setDash(false);
  p.obj.visible = true;
  p.vel.set(0, 0, 0);
  game.state = 'docking';
}

function startJump() {
  const gate = nearGate();
  const p = game.player;
  if (!gate) {
    const any = game.navs.find(n => n.kind === 'jump');
    hud.msg(any ? 'Jump drive: get within 2.5 km of a jump gate first (select it with N, then A).' : 'No jump gates in this system.', COL.comm);
    audio.denied();
    return;
  }
  if (game.missiles.some(m => m.target === p)) { hud.msg('Jump aborted: incoming missile!', COL.warn); audio.denied(); return; }
  faceToward(p.obj, gate.pos, upOf(p.obj));
  game.jump = { t: 0, to: gate.to, from: game.sys };
  game.state = 'jump';
  game.target = null;
  audio.autopilot();
  hud.msg(`Jump drive engaged: ${SYSTEMS[gate.to].name}`, COL.nav);
}

const _bz = V(), _bt = V();
function bezier(o, a, b, c, d, u) {
  const v = 1 - u;
  return o.copy(a).multiplyScalar(v * v * v).addScaledVector(b, 3 * v * v * u).addScaledVector(c, 3 * v * u * u).addScaledVector(d, u * u * u);
}
function updateDocking(dt) {
  const D = game.dock, p = game.player;
  D.t += dt;
  const k = Math.min(1, D.t / D.T);
  const u = k * k * (3 - 2 * k);
  bezier(p.pos, D.p0, D.p1, D.p2, D.p3, u);
  bezier(_bt, D.p0, D.p1, D.p2, D.p3, Math.min(1, u + 0.01)).sub(p.pos);
  if (_bt.lengthSq() < 1e-6) _bt.copy(D.p3).sub(p.pos);
  _bt.normalize();
  faceToward(p.obj, p.pos.clone().add(_bt), D.up);
  p.vel.set(0, 0, 0);
  p.mainThrust = 0.25 + 0.3 * Math.sin(Math.PI * Math.min(1, k * 1.2));
  p.throttle = 0; p.afterburner = false;
  // Tracking shot: trail behind and to one side of the ship, framing it against the station.
  const side = V().crossVectors(_bt, D.up).normalize();
  const close = 1 - Math.min(1, p.pos.distanceTo(D.p3) / 1500);  // swing wider as the ship nears the bay
  const want = p.pos.clone().addScaledVector(_bt, -70 - 40 * close).addScaledVector(side, 38 + 60 * close).addScaledVector(D.up, 16 + 20 * close);
  if (!D.camInit) { camera.position.copy(want); D.camInit = true; }
  camera.position.lerp(want, 1 - Math.exp(-3 * dt));
  camera.up.copy(D.up);
  D.look.lerp(p.pos.clone().lerp(D.p3, 0.15 + 0.35 * close), 1 - Math.exp(-5 * dt));
  camera.lookAt(D.look);
  audio.engine(0.25, false, true);
  if (D.t > D.T - 0.9) game.fade = Math.min(1, (D.t - (D.T - 0.9)) / 0.8);
  return D.t >= D.T;
}

function updateJump(dt) {
  const J = game.jump, p = game.player;
  J.t += dt;
  p.afterburner = true; p.throttle = 1;
  if (!J.done) p.vel.addScaledVector(forwardOf(p.obj), 900 * dt);
  p.pos.addScaledVector(p.vel, dt);
  // The view stretches and whites out while the drive spools up.
  camera.fov = 72 + Math.min(1, J.t / 1.6) * 40 * (J.done ? Math.max(0, 1 - (J.t - 1.8) / 0.8) : 1);
  updateProjection();
  J.warp = J.done ? Math.max(0, 1 - (J.t - 1.8) / 0.8) : Math.min(1, J.t / 1.6);
  // Brief white pulse only at the moment of transition.
  hud.flash = Math.max(0, 1 - Math.abs(J.t - 1.8) / 0.25) * 0.9;
  hud.flashRGB = '220,235,255';
  game.shake = 0.6;
  if (J.t >= 1.8 && !J.done) {
    J.done = true;
    setSystem(J.to);
    const arrive = game.navs.find(n => n.kind === 'jump' && n.to === J.from) || game.navs[0];
    const dir = V().sub(arrive.pos).normalize();  // toward the system's star
    p.pos.copy(arrive.pos).addScaledVector(dir, 900);
    faceToward(p.obj, V(0, 0, 0), V(0, 1, 0));
    p.vel.copy(dir).multiplyScalar(120);
    game.navIndex = game.navs.indexOf(arrive);
    autoRoute();
    regroupWing();
    resetChase();
  }
  if (J.t >= 2.6) {
    J.warp = 0;
    camera.fov = 72; updateProjection();
    p.afterburner = false; p.throttle = 0;
    game.state = 'flight';
    game.jump = null;
    const d = SYSTEMS[game.sys];
    hud.msg(`Arrived in ${d.name}: ${d.blurb}`, COL.nav);
  }
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
  p.throttle = 1;
  p.mainThrust = 1;
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
  // The autopilot brakes you into a gentle drift toward the nav point and idles the engine.
  p.vel.copy(dir).multiplyScalar(nav.kind === 'station' ? 80 : 120);
  p.throttle = 0;
  p.afterburner = false;
  for (const s of game.ships) {
    if (s.isPlayer || s.wing || s.behemoth || !s.alive || s.pos.distanceTo(p.pos) <= 25000) continue;
    s.alive = false;
    forgetShip(s);
  }
  regroupWing();
  for (const L of game.lasers) scene.remove(L.mesh);
  for (const m of game.missiles) scene.remove(m.mesh);
  game.lasers = []; game.missiles = []; game.decoys = [];
  game.view = a.prevView;
  game.ap = null;
  game.state = 'flight';
  p.obj.visible = game.view !== 'cockpit';
  setDash(game.view === 'cockpit');
  game.fade = 1;
  camera.up.set(0, 1, 0);
  resetChase();
  hud.msg(`Arrived: ${nav.name}`, COL.nav);
  if (nav.kind === 'station') later(1, () => hud.msg(`${nav.station.name} Control: Welcome. Slow below 150 m/s and press D to dock.`, COL.comm));
  if (nav.kind === 'jump') later(1, () => hud.msg(`${nav.name}: press J to jump to ${SYSTEMS[nav.to].name}.`, COL.comm));
  if (nav.kind === 'beacon') later(1, () => hud.msg('Survey beacon: severe gravitational shear ahead. Do NOT approach the Rift.', COL.warn));
  if (nav.kind === 'belt') later(1, () => hud.msg(`${nav.name}: watch for rocks, and for raiders hiding among them.`, COL.comm));
}

// ---------------------------------------------------------------------------
// Encounters, police, traffic, combat callbacks, death
// ---------------------------------------------------------------------------

function cargoValue() {
  let v = 0;
  for (const k in game.cargo) v += game.cargo[k].cost;
  return v;
}

function spawnGroup(kinds, tag = {}) {
  const p = game.player;
  const f = forwardOf(p.obj);
  const base = p.pos.clone().addScaledVector(f, 4200);
  const ships = [];
  for (const kind of kinds) {
    const s = new Ship(game, kind);
    Object.assign(s, tag);
    s.pos.copy(base).add(V((Math.random() - 0.5) * 2400, (Math.random() - 0.5) * 1600, (Math.random() - 0.5) * 2400));
    faceToward(s.obj, p.pos, V(0, 1, 0));
    s.vel.copy(p.vel);
    if (s.hauler) {
      // Convoy haulers try to run for a point far beyond you.
      s.dest = { pos: s.pos.clone().addScaledVector(V().subVectors(s.pos, p.pos).normalize(), 60000) };
      s.vel.add(V().subVectors(s.dest.pos, s.pos).normalize().multiplyScalar(80));
    }
    game.ships.push(s);
    ships.push(s);
  }
  return ships;
}

// Behemoths are permanent fixtures of their systems (until destroyed this session).
const behemothDown = {};
function spawnBehemoths() {
  const defs = SYSTEMS[game.sys].behemoths || [];
  for (const d of defs) {
    if (behemothDown[d.id] || game.ships.some(s => s.alive && s.behemothId === d.id)) continue;
    const s = new Ship(game, d.kind);
    s.behemothId = d.id;
    let base, axis;
    if (d.station !== undefined) {
      const st = game.world.stations[d.station];
      const up = V(0, 1, 0).applyQuaternion(st.group.quaternion);
      const side = V().crossVectors(st.axis, up).normalize();
      base = st.pos.clone().addScaledVector(side, d.offset[0]).addScaledVector(up, d.offset[1]);
      axis = st.axis.clone();
    } else {
      const nav = game.navs.find(n => n.name === d.nav);
      base = nav.pos.clone().add(V(...d.offset));
      axis = V(1, 0, 0.35).normalize();
    }
    s.pos.copy(base);
    s.anchor = base.clone();
    faceToward(s.obj, base.clone().add(axis), V(0, 1, 0));
    game.ships.push(s);
  }
}
game.spawnBehemoths = spawnBehemoths;

function spawnCarrier() {
  const p = game.player;
  const s = new Ship(game, 'carrier');
  const f = forwardOf(p.obj);
  s.pos.copy(p.pos).addScaledVector(f, 6500).add(V((Math.random() - 0.5) * 3000, 600, (Math.random() - 0.5) * 3000));
  faceToward(s.obj, p.pos, V(0, 1, 0));
  s.obj.rotateY(0.9);   // broadside-ish arrival
  s.vel.copy(p.vel);
  game.ships.push(s);
  hud.msg('Ashfang Carrier Gorehaven: All wings, launch! Burn that ship out of the sky.', COL.hostile);
  hud.msg('WARNING: Ashfang capital ship on sensors. Torpedoes recommended.', COL.warn);
  audio.alarm();
}
// The carrier's hangar launches raiders.
game.spawnFromCarrier = c => {
  const r = new Ship(game, 'pirate');
  const out = (c.behemoth ? V(0, -c.capsule.r * 1.1, -c.capsule.half * 0.3) : V(0, -12, -56)).applyQuaternion(c.obj.quaternion).add(c.pos);
  r.pos.copy(out);
  r.obj.quaternion.copy(c.obj.quaternion);
  r.vel.copy(c.vel).add(forwardOf(c.obj).multiplyScalar(160));
  r.fromCarrier = c;
  game.ships.push(r);
  game.fx.emit(out, c.vel, { life: 0.4, size: 30, sizeEnd: 8, color: [3, 1.5, 0.6] });
};

function spawnPirates(n, mission = null, heavy = 0) {
  const kinds = Array.from({ length: n }, (_, i) => (i < heavy ? 'marauder' : 'pirate'));
  spawnGroup(kinds, mission ? { missionId: mission.id } : {});
  hud.msg(PIRATE_LINES[(Math.random() * PIRATE_LINES.length) | 0], COL.hostile);
  hud.msg(`Contact: ${n} Ashfang ${heavy ? 'ships, including a Marauder,' : `raider${n > 1 ? 's' : ''}`} inbound!`, COL.warn);
  audio.warning();
}

function checkEncounters(dt) {
  const p = game.player;
  const danger = SYSTEMS[game.sys].danger;
  for (const nav of game.navs) {
    nav.cooldown = Math.max(0, nav.cooldown - dt);
    if (nav.cooldown > 0 || nav.pos.distanceTo(p.pos) > 9000) continue;
    nav.cooldown = 150;
    const ni = game.navs.indexOf(nav);
    const job = game.missions.find(m => m.type === 'bounty' && m.sys === game.sys && m.navIndex === ni && !m.spawned);
    if (job) {
      job.spawned = true;
      const left = job.count - job.killed;
      later(1.5, () => {
        if (game.state !== 'flight' && game.state !== 'map') { job.spawned = false; return; }
        hud.msg(`Contract target sighted: ${left} raider${left > 1 ? 's' : ''}.`, COL.warn);
        spawnPirates(left, job, job.heavy && job.killed === 0 ? 1 : 0);
      });
      continue;
    }
    const step = game.storyStep();
    if (step && step.do === 'reach' && step.sys === game.sys && step.nav === ni) continue; // the story handles this one
    if (nav.kind === 'station' && nav.station.outpost) continue;
    let chance = Math.min(0.95, nav.encounter * danger);
    if (nav.kind === 'station' && (game.cargo.contract?.qty || game.cargo.smuggle?.qty)) chance = 0.45;
    if (game.rep.ashfang <= -40) chance = Math.min(0.95, chance + 0.15);
    // Rare capital-ship encounter in pirate space (and occasionally at the Rift's edge).
    const carrierChance = game.sys === 'hollow' ? 0.22 : game.sys === 'sable' && nav.kind !== 'station' ? 0.06 : 0;
    if (!game.ships.some(x => x.capital && x.alive) && Math.random() < carrierChance) {
      later(2, () => { if (game.state === 'flight' || game.state === 'map') spawnCarrier(); });
      continue;
    }
    if (Math.random() < chance) {
      const n = 1 + ((Math.random() * 2) | 0) + (cargoValue() > 3000 ? 1 : 0) + (game.sys === 'hollow' ? 1 : 0);
      const heavy = n >= 2 && Math.random() < (game.rep.ashfang <= -40 ? 0.6 : 0.3) ? 1 : 0;
      later(1.5 + Math.random() * 2, () => { if (game.state === 'flight' || game.state === 'map') spawnPirates(n, null, heavy); });
    }
  }
}

// ---------------------------------------------------------------------------
// Random events: distress calls and derelict wrecks, every few minutes of quiet flight.
// ---------------------------------------------------------------------------
function clearEvent() {
  const E = game.event;
  if (E && E.wreck) scene.remove(E.wreck);
  game.event = null;
  game.eventT = 150 + Math.random() * 120;
}
game.clearEvent = clearEvent;

function startEvent(type) {
  const p = game.player;
  const f = forwardOf(p.obj);
  const at = p.pos.clone().addScaledVector(f, 5500).add(V((Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 1200, (Math.random() - 0.5) * 3000));
  if (type === 'distress') {
    const civ = new Ship(game, 'freighter');
    civ.pos.copy(at);
    civ.vel.copy(p.vel).add(V(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(60));
    faceToward(civ.obj, civ.pos.clone().add(civ.vel), V(0, 1, 0));
    civ.dest = { pos: civ.pos.clone().addScaledVector(civ.vel.clone().normalize(), 80000) };
    game.ships.push(civ);
    const pirates = [];
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const s = new Ship(game, i === 0 && Math.random() < 0.35 ? 'marauder' : 'pirate');
      s.pos.copy(at).add(V((Math.random() - 0.5) * 900, (Math.random() - 0.5) * 400, (Math.random() - 0.5) * 900));
      s.vel.copy(civ.vel);
      s.aiTarget = civ; s.retarget = 10;
      game.ships.push(s);
      pirates.push(s);
    }
    game.event = { type, civ, pirates, t: 0 };
    game.target = civ;
    hud.msg(`${civ.name}: Mayday, mayday! Raiders on us. Anyone on this channel, please help!`, COL.warn);
    audio.warning();
  } else {
    // Derelict: a burned-out freighter hulk with loose cargo drifting around it.
    const m = buildFreighterModel();
    m.group.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (o.material.color) o.material.color.multiplyScalar(0.3);
      if (o.material.emissive) o.material.emissive.setRGB(0.05, 0.02, 0);
    });
    for (const gl of m.glows) gl.visible = false;
    // Burning breaches so the hulk reads against black space.
    const fires = [];
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(3.5, 1.4, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      f.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 70);
      f.userData.base = 8 + Math.random() * 10;
      m.group.add(f);
      fires.push(f);
    }
    m.group.position.copy(at);
    m.group.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    scene.add(m.group);
    // Two "marauder-sized" drops: 4-6 pods in total.
    for (let i = 0; i < 2; i++) salvage.drop({ pos: at, vel: V(), radius: 140, kind: 'marauder' });
    game.event = { type, wreck: m.group, fires, at, t: 0, spin: V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.06), trap: Math.random() < 0.35 };
    game.target = salvage.pods[salvage.pods.length - 1] || null;
    hud.msg('Automated salvage beacon: derelict freighter detected. Cargo drifting free. No life signs.', COL.nav);
    audio.blip();
  }
}

function updateEvents(dt) {
  const p = game.player;
  const E = game.event;
  if (!E) {
    game.eventT = (game.eventT ?? 120) - dt;
    if (game.eventT > 0) return;
    const quiet = !game.ships.some(s => s.alive && (s.team === 'pirate') && s.pos.distanceTo(p.pos) < 12000);
    const awayFromStations = !game.world.stations.some(st => st.pos.distanceTo(p.pos) < 6000);
    const step = game.storyStep();
    if (!quiet || !awayFromStations || (step && step.do === 'kill')) { game.eventT = 20; return; }
    startEvent(Math.random() < 0.55 ? 'distress' : 'derelict');
    return;
  }
  E.t += dt;
  if (E.type === 'distress') {
    const pirLeft = E.pirates.filter(s => s.alive).length;
    if (!E.civ.alive) {
      hud.msg(`${E.civ.name} has gone silent. Too late.`, COL.warn);
      clearEvent();
    } else if (pirLeft === 0) {
      const pay = Math.round(1400 * rankBonus(game.score));
      game.credits += pay;
      changeRep(game, 'authority', 6);
      addScore(3);
      hud.msg(`${E.civ.name}: You saved our skins, pilot! Transferring ${pay} cr. Fly safe!`, COL.good);
      hud.banner('RESCUE SUCCESSFUL', `+${pay} cr · Authority reputation +6`);
      audio.chime();
      clearEvent();
    } else if (E.civ.pos.distanceTo(p.pos) > 35000) clearEvent();
  } else {
    for (const f of E.fires) f.scale.setScalar(f.userData.base * (0.6 + Math.random() * 0.6));
    E.wreck.rotation.x += E.spin.x * dt; E.wreck.rotation.y += E.spin.y * dt; E.wreck.rotation.z += E.spin.z * dt;
    E.smoke = (E.smoke || 0) - dt;
    if (E.smoke <= 0) {
      E.smoke = 0.12;
      const at = V((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 120).applyQuaternion(E.wreck.quaternion).add(E.wreck.position);
      game.fx.emit(at, V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6), { life: 4, size: 14, sizeEnd: 60, color: [0.22, 0.2, 0.19], colorEnd: [0.03, 0.03, 0.03], alpha: 0.5 });
      if (Math.random() < 0.15) game.fx.sparks(at, [3, 1.6, 0.6], 6);
    }
    if (E.trap && !E.sprung && p.pos.distanceTo(E.wreck.position) < 1500) {
      E.sprung = true;
      later(2, () => { hud.msg('Ashfang: Thanks for coming to collect, courier. We\'ll take it from here.', COL.hostile); spawnPirates(2 + (Math.random() < 0.5 ? 1 : 0)); });
    }
    if (E.t > 200 || E.wreck.position.distanceTo(p.pos) > 40000) clearEvent();
  }
}

function updateTraffic(dt) {
  const p = game.player;
  // Freighters between the stations of this system.
  game.trafficT -= dt;
  if (game.trafficT <= 0) {
    game.trafficT = 20 + Math.random() * 15;
    const civ = game.ships.filter(s => s.alive && s.team === 'civ').length;
    const st = game.world.stations.find(s => !s.outpost && s.pos.distanceTo(p.pos) < 25000);
    const dest = st && game.world.stations.find(s => s !== st && !s.outpost);
    if (civ < 2 && st && dest) {
      const f = new Ship(game, 'freighter');
      f.dest = dest;
      f.pos.copy(st.pos).addScaledVector(st.axis, 1600).add(V((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, 0));
      faceToward(f.obj, f.dest.pos, V(0, 1, 0));
      f.vel.copy(forwardOf(f.obj)).multiplyScalar(60);
      game.ships.push(f);
    }
  }
  // Authority patrols: more of them in lawful systems.
  game.policeT -= dt;
  if (game.policeT <= 0) {
    game.policeT = 45 + Math.random() * 30;
    const cops = game.ships.filter(s => s.alive && s.team === 'police').length;
    if (cops < 2 && Math.random() < SYSTEMS[game.sys].police * (game.isWanted() ? 1.4 : 1)) {
      const ships = spawnGroup(['police', 'police']);
      for (const s of ships) s.home = p.pos.clone();
      hud.msg(game.isWanted() ? `${ships[0].name}: Wanted pilot! Power down and prepare to be boarded!` : `${ships[0].name}: Authority patrol. Hold steady for a routine cargo scan.`, COL.police);
    }
  }
  // Cargo scans by nearby, non-hostile patrols.
  for (const s of game.ships) {
    if (!s.alive || s.team !== 'police' || s.scanned || game.isWanted()) continue;
    if (s.pos.distanceTo(p.pos) > 1600) continue;
    s.scanT = (s.scanT || 0) + dt;
    if (s.scanT < 3) continue;
    s.scanned = true;
    const illegal = (game.cargo.stims?.qty || 0) + (game.cargo.smuggle?.qty || 0);
    if (illegal) {
      const fine = 250 * illegal;
      game.credits = Math.max(0, game.credits - fine);
      delete game.cargo.stims;
      if (game.cargo.smuggle) {
        delete game.cargo.smuggle;
        for (const m of [...game.missions]) if (m.illegal) game.missions.splice(game.missions.indexOf(m), 1);
      }
      hud.msg(`${s.name}: Contraband found! ${illegal} t confiscated, fined ${fine} cr.`, COL.hostile);
      rep('authority', -15);
      audio.denied();
    } else hud.msg(`${s.name}: Scan complete. You're clean, fly safe.`, COL.police);
  }
}

game.onShipDestroyed = (s, killer) => {
  if (game.target === s) game.target = null;
  if (s.capital) {
    // Chain of secondary explosions across the hull, then the reactor goes.
    const at = s.pos.clone(), q = s.obj.quaternion.clone(), v = s.vel.clone();
    const len = (s.capsule ? s.capsule.half : 130) * 2, wid = s.capsule ? s.capsule.r * 2 : 70;
    const big = s.behemoth ? 3 : 1;
    if (s.behemoth) behemothDown[s.behemothId] = true;
    for (let i = 0; i < 9 * big; i++) {
      later(0.25 + i * 0.32 / Math.sqrt(big), () => {
        const pos = V((Math.random() - 0.5) * wid, (Math.random() - 0.5) * wid * 0.6, (Math.random() - 0.5) * len).applyQuaternion(q).add(at).addScaledVector(v, 0.3 * i);
        game.fx.explosion(pos, (1.4 + Math.random()) * Math.sqrt(big), v);
        audio.explosion(Math.max(0.3, 1 - camera.position.distanceTo(pos) / 9000), true, panAt(game, pos));
      });
    }
    later(3.3 * Math.sqrt(big), () => { game.fx.explosion(at, 4.5 * Math.sqrt(big), v); audio.explosion(1, true, panAt(game, at)); game.shake = 2; hud.flash = 0.6; hud.flashRGB = '255,200,140'; });
    // The wreck hangs on screen while it burns.
    const wreck = s.obj;
    scene.add(wreck);
    later(3.4 * Math.sqrt(big), () => scene.remove(wreck));
  }
  if (s.wing) {
    hud.msg(`${s.name}: I'm hit, I'm going down! ... Wingman lost.`, COL.hostile);
    game.wing = null;
    return;
  }
  if (killer && killer.wing && s.team === 'pirate') {
    game.credits += Math.round(s.bounty * 0.5);
    if (game.wing) game.wing.kills++;
    hud.msg(`${killer.name}: Splash one! (half bounty +${Math.round(s.bounty * 0.5)} cr)`, COL.good);
  }
  if (s.team !== 'police') salvage.drop(s);
  const byPlayer = killer && killer.isPlayer;
  if (s.team === 'civ') {
    if (byPlayer) {
      const fine = Math.min(game.credits, 2500);
      game.credits -= fine;
      hud.msg(`Authority: civilian vessel destroyed. You are fined ${fine} cr.`, COL.hostile);
      rep('authority', -30);
      audio.denied();
    } else hud.msg(`${s.name} has been destroyed by raiders.`, COL.warn);
    return;
  }
  if (s.team === 'police') {
    if (byPlayer) rep('authority', -40, 'You destroyed an Authority patrol');
    return;
  }
  if (byPlayer) {
    const pay = Math.round(s.bounty * rankBonus(game.score));
    game.credits += pay;
    game.kills++;
    hud.msg(`${s.name} destroyed. Bounty +${pay} cr`, COL.good);
    addScore(s.behemoth ? 40 : s.capital ? 15 : s.kind === 'warlord' ? 12 : s.kind === 'marauder' ? 3 : 1);
    changeRep(game, 'authority', 2);
    changeRep(game, 'ashfang', s.kind === 'warlord' ? -50 : -3);
    audio.cash();
  }
  if (s.missionId) {
    const m = game.missions.find(x => x.id === s.missionId);
    if (m) {
      m.killed++;
      if (m.killed >= m.count) {
        game.missions.splice(game.missions.indexOf(m), 1);
        game.credits += Math.round(m.reward * rankBonus(game.score));
        changeRep(game, 'authority', 5);
        addScore(4);
        later(0.8, () => { hud.msg(`Contract complete: ${m.client} pays ${m.reward.toLocaleString()} cr.`, COL.good); audio.chime(); autoRoute(); });
      } else hud.msg(`Contract: ${m.killed}/${m.count} raiders destroyed.`, COL.nav);
    }
  }
};

game.onRockHit = (rock, at, dmg, owner) => {
  if (!owner || (!owner.isPlayer && !owner.wing)) return;
  const belt = game.world.belt;
  rock.hp -= dmg;
  if (rock.hp > 0) return;
  // Break the asteroid apart: hide the instance, throw out dust and ore.
  const m4 = new THREE.Matrix4().makeScale(0, 0, 0);
  belt.mesh.setMatrixAt(rock.i, m4);
  belt.mesh.instanceMatrix.needsUpdate = true;
  belt.rocks.splice(belt.rocks.indexOf(rock), 1);
  const s = Math.min(2.5, rock.r / 60);
  for (let i = 0; i < 40 * s; i++) {
    const v = V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(20 + Math.random() * 90 * s);
    game.fx.emit(rock.p, v, { life: 1.5 + Math.random() * 1.5, size: rock.r * 0.15, sizeEnd: rock.r * 0.5, color: [0.35, 0.3, 0.26], colorEnd: [0.05, 0.05, 0.05], alpha: 0.7, drag: 0.6 });
  }
  game.fx.sparks(rock.p, [3, 2, 1], 30);
  audio.explosion(Math.max(0.2, 1 - camera.position.distanceTo(rock.p) / 5000) * 0.6, false, panAt(game, rock.p));
  const n = Math.max(1, Math.min(5, Math.round(rock.r / 40)));
  salvage.dropOre(rock.p, rock.r, belt.kind, n);
  hud.msg(`Asteroid cracked: ${n} chunk${n > 1 ? 's' : ''} of ${belt.kind === 'water' ? 'water ice' : 'raw ore'} released.`, COL.good);
};

game.onSystemDamage = (k, v) => {
  hud.msg(`DAMAGE: ${SYSTEMS_INFO[k]} at ${Math.round(v * 100)}%`, COL.hostile);
  audio.alarm();
};

game.onNpcHit = (s, src) => {
  if (!src || !src.isPlayer) {
    if (s.team === 'civ' && (!s.maydayT || game.time - s.maydayT > 8)) { s.maydayT = game.time; hud.msg(`${s.name}: Mayday, mayday! Under attack by raiders!`, COL.warn); }
    return;
  }
  if (s.team === 'civ' || s.team === 'police') {
    if (!s.warnT || game.time - s.warnT > 4) {
      s.warnT = game.time;
      rep('authority', s.team === 'police' ? -8 : -3);
      hud.msg(s.team === 'police' ? `${s.name}: Weapons fire on an Authority vessel! Engaging!` : `${s.name}: Hold your fire! We're civilians!`, COL.warn);
    }
  }
};

game.abandonMission = m => {
  game.missions.splice(game.missions.indexOf(m), 1);
  const key = m.illegal ? 'smuggle' : 'contract';
  if (m.type === 'delivery' && game.cargo[key]) {
    game.cargo[key].qty -= m.qty;
    if (game.cargo[key].qty <= 0) delete game.cargo[key];
  }
};

function completeDeliveries(st) {
  for (const m of [...game.missions]) {
    if (m.type !== 'delivery' || m.sys !== game.sys || m.dest !== st.index) continue;
    game.abandonMission(m);
    game.credits += Math.round(m.reward * rankBonus(game.score));
    addScore(3);
    if (m.illegal) { changeRep(game, 'ashfang', 8); changeRep(game, 'authority', -2); }
    else changeRep(game, 'authority', 5);
    hud.msg(`Delivery complete: ${m.client} pays ${m.reward.toLocaleString()} cr.`, COL.good);
    audio.cash();
  }
}

game.onPlayerHit = (r, dmg, fromPos) => {
  if (fromPos) {
    // Direction of the hit in the ship's frame, for the HUD damage arcs.
    const d = V().subVectors(fromPos, game.player.pos).applyQuaternion(game.player.obj.quaternion.clone().invert());
    hud.hits.push({ a: Math.atan2(-d.y, d.x), behind: d.z > 0, t: 0, armor: r.armor });
    if (hud.hits.length > 8) hud.hits.shift();
  }
  hud.flash = r.armor ? 0.5 : 0.22;
  hud.flashRGB = r.armor ? '255,60,30' : '60,140,255';
  game.shake = Math.max(game.shake, r.armor ? 1 : 0.4);
  if (r.armor) { audio.armorHit(); if (game.view === 'cockpit' && Math.random() < 0.35) hud.addCrack(); } else audio.shieldHit();
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
  if (game.deathBH && game.world.blackHole) {
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
// Player flight (Newtonian)
// ---------------------------------------------------------------------------

const keys = {};
let touch = { active: false, x: 0, y: 0, hold: {} };

// Gamepad (standard mapping), polled every frame.
const pad = { active: false, axes: [0, 0, 0, 0], btn: [], prev: [] };
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of pads) if (g && g.connected) { gp = g; break; }
  if (!gp) { pad.active = false; return; }
  const dz = v => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
  pad.axes = [0, 1, 2, 3].map(i => dz(gp.axes[i] || 0));
  const b = gp.buttons.map(x => x.pressed || x.value > 0.5);
  if (!pad.active && b.some(Boolean)) { pad.active = true; hud.msg('Gamepad connected.', COL.comm); }
  for (let i = 0; i < b.length; i++) if (b[i] && !pad.prev[i]) onPadButton(i);
  pad.btn = b; pad.prev = b;
}
function onPadButton(i) {
  audio.init();
  const st = game.state;
  const map = { 0: 'Enter', 1: 'KeyX', 2: 'KeyT', 3: 'KeyR', 8: 'KeyV', 9: 'KeyP', 10: 'KeyG', 12: 'KeyA', 14: 'KeyN', 15: 'KeyM' };
  if (st === 'menu' || (st === 'dead' && game.deathShown) || st === 'paused') { if (i === 0 || i === 9) menuPrimary(); return; }
  if (st === 'trade') { if (i === 1 || i === 9) game.launchFromStation(ui.station); return; }
  if (st === 'map') { if (i === 15 || i === 1) ui.closeMap(); else if (i === 0) { ui.closeMap(); engageAutopilot(); } else if (i === 14) { cycleNav(); ui.drawMap(); } return; }
  if (i === 13) { onKey(nearGate() ? 'KeyJ' : 'KeyD'); return; }
  if (map[i]) onKey(map[i]);
}

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
  if (pad.active) {
    pitch += pad.axes[1] * inv;
    yaw -= pad.axes[0];
    roll -= pad.axes[2];
  }
  if (touch.active) {
    pitch -= touch.y;
    yaw -= touch.x;
  }
  if (game.mouseFlight && game.mouse.inside && !game.touchMode && !game.mouseFree) {
    const cx = innerWidth / 2, cy = hud.viewH / 2;
    const R = Math.min(innerWidth, hud.viewH) * 0.38 / (SETTINGS.sens || 1);
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
  roll = THREE.MathUtils.clamp(roll, -1, 1);
  // Rotation is stabilised by the flight computer (RCS), so turning stops when you let go.
  const [rp, ry, rr] = p.turnRates;
  const k6 = 1 - Math.exp(-6 * dt);
  p.angVel.x += (pitch * rp - p.angVel.x) * k6;
  p.angVel.y += (yaw * ry - p.angVel.y) * k6;
  p.angVel.z += (roll * rr - p.angVel.z) * k6;
  p.obj.rotateX(p.angVel.x * dt);
  p.obj.rotateY(p.angVel.y * dt);
  p.obj.rotateZ(p.angVel.z * dt);

  // Throttle sets main-engine thrust, not a speed.
  const up = k.KeyW || k.Equal || k.NumpadAdd || pad.btn[5] || touch.hold.thrUp;
  const down = k.KeyS || k.Minus || k.NumpadSubtract || pad.btn[4] || touch.hold.thrDn;
  if (up) p.throttle = Math.min(1, p.throttle + 0.7 * dt);
  if (down) p.throttle = Math.max(0, p.throttle - 0.7 * dt);
  p.afterburner = !!(k.Tab || pad.btn[6] || touch.hold.ab) && p.abFuel > 0;
  if (p.afterburner) p.abFuel = Math.max(0, p.abFuel - 9 * dt);
  else p.abFuel = Math.min(100, p.abFuel + 0.8 * dt);
  p.retro = !!k.KeyZ;
  // Brake: manoeuvring thrusters push against your velocity.
  p.rcsCmd.set(0, 0, 0);
  const tdt = 1 / Math.max(dt, 0.05);
  const tgt = game.target;
  game.matching = !!(k.KeyB || touch.hold.match) && !!tgt;
  if (k.KeyC || pad.btn[11] || touch.hold.brake) p.rcsCmd.copy(p.vel).multiplyScalar(-tdt);
  else if (game.matching) {
    // Match velocity with the target (stations are stationary).
    p.rcsCmd.copy(tgt.vel || V()).sub(p.vel).multiplyScalar(tdt);
  } else if (game.flightAssist) {
    // Flight assist: thrusters cancel sideways drift so the ship goes where it points.
    const f = forwardOf(p.obj);
    const lat = p.vel.clone().addScaledVector(f, -p.vel.dot(f));
    p.rcsCmd.copy(lat).multiplyScalar(-tdt);
    if (p.throttle === 0 && !p.afterburner && !p.retro) {
      // With the engine idle, also bleed forward speed down gently toward a stop.
      const fwd = p.vel.dot(f);
      if (fwd < 0) p.rcsCmd.addScaledVector(f, -fwd * tdt);
    }
  }

  p.gunCd -= dt;
  if ((k.Space || game.mouse.left || pad.btn[7] || touch.hold.fire) && p.gunCd <= 0 && p.energy >= p.shotCost) fireLasers(game, p);
  p.energy = Math.min(100, p.energy + 24 * dt);
}

function playerSystems(dt) {
  const p = game.player;
  // Pulsar radiation: inside the zone shields drain, then armour cooks.
  const pul = game.world.pulsar;
  p.radiation = 0;
  if (pul) {
    const d = p.pos.length();
    if (d < pul.radiation) {
      const k = 1 - d / pul.radiation;
      p.radiation = k;
      const dmg = 35 * k * k * dt;
      const fromF = p.shieldF > 0, fromR = p.shieldR > 0;
      if (fromF || fromR) { p.shieldF = Math.max(0, p.shieldF - dmg); p.shieldR = Math.max(0, p.shieldR - dmg); p.lastHit = game.time; }
      else p.armor -= dmg * 0.5;
      game.radT = (game.radT || 0) - dt;
      if (game.radT <= 0) { game.radT = 6; hud.msg(`RADIATION: pulsar exposure ${Math.round(k * 100)}%. Get clear of the star!`, COL.warn); audio.alarm(); }
      if (p.armor <= 0) { playerDies('Your ship was cooked by pulsar radiation.'); return; }
    }
  }
  // Damage-control crews patch systems slowly, but only up to 50% in the field.
  let changed = false;
  for (const k in p.sys) if (p.sys[k] < 0.5) { p.sys[k] = Math.min(0.5, p.sys[k] + 0.012 * dt); changed = true; }
  if (changed) applySystems(p);
  if (game.time - p.lastHit > 2.5) {
    p.shieldF = Math.min(p.shieldMax, p.shieldF + p.shieldRegen * dt);
    p.shieldR = Math.min(p.shieldMax, p.shieldR + p.shieldRegen * dt);
  }
  // Missile lock: keep a hostile target near the nose, within range. Heat-seekers need no lock.
  const need = lockTimeFor(p);
  const t = game.target;
  if (need > 0 && t && t.team && isThreat(t)) {
    const to = V().subVectors(t.pos, p.pos);
    const d = to.length();
    const range = p.missileType === 'torpedo' ? 7000 : 5000;
    if (d < range && forwardOf(p.obj).angleTo(to) < 0.22) {
      const was = p.lockTime;
      p.lockTime = Math.min(need + 0.3, p.lockTime + dt);
      if (was < need && p.lockTime >= need) audio.locked();
    } else p.lockTime = Math.max(0, p.lockTime - dt * 2);
  } else p.lockTime = 0;
  game.beepT -= dt;
  if (need > 0 && p.lockTime > 0 && p.lockTime < need && game.beepT <= 0) { audio.lockBeep(); game.beepT = 0.3 - Math.min(1, p.lockTime / need) * 0.18; }

  game.warnT -= dt;
  if (game.missiles.some(m => m.target === p) && game.warnT <= 0) { audio.warning(); game.warnT = 0.6; }

  const lvl = THREE.MathUtils.clamp((p.gAccel - 10) / 300, 0, 1);
  audio.gravity(lvl);
  game.shake = Math.max(game.shake, lvl * 0.9);
  game.alarmT -= dt;
  if (p.gAccel > 80 && game.alarmT <= 0) { audio.alarm(); game.alarmT = 0.9; }

  const eng = Math.max(p.throttle, p.retro ? 0.5 : 0, p.rcsCmd.lengthSq() > 1 ? 0.25 : 0);
  audio.engine(eng * 0.7 + (p.afterburner ? 0.4 : 0), p.afterburner, true);
  if (game.target && (game.target.team || game.target.isPod) && !game.target.alive) game.target = null;
}

function bump(center, r) {
  const p = game.player;
  const n = V().subVectors(p.pos, center).normalize();
  const impact = Math.max(0, -p.vel.dot(n));
  if (r) p.pos.copy(center).addScaledVector(n, r + p.radius + 2);
  else p.pos.addScaledVector(n, 25);
  // Bounce off with some energy lost.
  p.vel.addScaledVector(n, impact * 1.5 + 20);
  hitShipWith(game, p, 8 + impact * 0.12, p.pos.clone().sub(n), null, true);
  game.bumpCd = 0.4;
}

function checkCollisions(dt) {
  const p = game.player, w = game.world, bh = w.blackHole;
  if (bh && p.pos.distanceTo(bh.pos) < bh.horizon * 1.1) {
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
  if (w.belt && p.pos.distanceToSquared(w.belt.center) < (w.belt.extent + 500) ** 2) {
    for (const r of w.belt.rocks) {
      if (p.pos.distanceTo(r.p) < r.r + p.radius) { bump(r.p, r.r); return; }
    }
  }
  for (const st of w.stations) if (st.collide(p.pos, p.radius)) { bump(st.pos, 0); return; }
  for (const s of game.ships) {
    if (!s.alive || !s.capsule) continue;
    const f = forwardOf(s.obj);
    const tz = THREE.MathUtils.clamp(V().subVectors(p.pos, s.pos).dot(f), -s.capsule.half, s.capsule.half);
    const axisPt = s.pos.clone().addScaledVector(f, tz);
    if (p.pos.distanceTo(axisPt) < s.capsule.r + p.radius) { bump(axisPt, s.capsule.r); return; }
  }
}

function scoop(pod) {
  const free = game.cargoCap - game.cargoUsed();
  if (free <= 0) {
    if (!pod.fullMsg || game.time - pod.fullMsg > 6) { pod.fullMsg = game.time; hud.msg('Cargo hold full: cannot scoop pod.', COL.warn); }
    return false;
  }
  const q = Math.min(free, pod.qty);
  const c = game.cargo[pod.cm.id] || (game.cargo[pod.cm.id] = { qty: 0, cost: 0 });
  c.qty += q;
  if (game.target === pod) game.target = null;
  hud.msg(`Scooped ${q} t of ${pod.cm.name}.`, COL.good);
  audio.cash();
  return true;
}

function updateFlight(dt) {
  game.time += dt;
  const p = game.player;
  if (p.alive && game.state === 'flight') playerControl(dt);
  for (const s of game.ships) if (s.alive && !s.isPlayer) updateAI(s, game, dt);
  for (const s of game.ships) if (s.alive) updateShipMotion(s, dt, game.world);
  updateLasers(game, dt);
  updateMissiles(game, dt);
  updateDecoys(game, dt);
  salvage.update(dt, p, scoop);
  if (p.alive && game.state === 'flight') {
    playerSystems(dt);
    checkCollisions(dt);
    checkEncounters(dt);
    updateTraffic(dt);
    updateEvents(dt);
    storyUpdate();
  }
  // Ships that wander far away are dropped.
  for (const s of game.ships) if (!s.isPlayer && !s.wing && !s.behemoth && s.alive && s.pos.distanceTo(p.pos) > 60000) { s.alive = false; forgetShip(s); }
  game.ships = game.ships.filter(s => s.alive || s.isPlayer);
  for (let i = game.timers.length - 1; i >= 0; i--) {
    const tm = game.timers[i];
    tm.t -= dt;
    if (tm.t <= 0) { game.timers.splice(i, 1); tm.fn(); }
  }
  game.fade = Math.max(0, game.fade - dt * 1.2);
}

function updateShipVisuals(dt) {
  const t = performance.now() / 1000;
  for (const s of game.ships) {
    if (!s.alive) continue;
    const thrust = s.mainThrust || 0;
    // Nozzle glow stays compact; the plume mesh shows the thrust.
    const k = (0.4 + 0.45 * Math.min(1.3, thrust)) * (s.afterburner ? 1.25 : 1) * (0.92 + Math.random() * 0.16);
    for (const gl of s.glows) gl.scale.setScalar(gl.userData.base * k);
    const pl = Math.min(1.6, thrust * (s.afterburner ? 1.9 : 1));
    for (const m of s.plumes || []) {
      m.visible = pl > 0.03;
      const r = m.userData.base * (0.75 + 0.35 * Math.min(1, pl));
      m.scale.set(r, r, m.userData.base * 7 * pl * (0.9 + Math.random() * 0.2));
      m.material.uniforms.time.value = t;
      m.material.uniforms.power.value = s.afterburner ? 1.6 : 1;
    }
    if (s.lightbar) { const on = (t * 3 % 1) < 0.5; s.lightbar[0].visible = on; s.lightbar[1].visible = !on; }
    if (s.isPlayer && (game.view === 'cockpit' || game.state === 'autopilot')) continue;
    const hp = s.armor / s.armorMax;
    s.smokeT -= dt;
    if (hp < 0.5 && s.smokeT <= 0) {
      s.smokeT = hp < 0.25 ? 0.03 : 0.07;
      const at = V((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(s.radius * 0.8).add(s.pos);
      game.fx.emit(at, s.vel.clone().multiplyScalar(0.9), { life: 1.6, size: s.radius * 0.35, sizeEnd: s.radius * 1.1, color: [0.3, 0.28, 0.26], colorEnd: [0.04, 0.04, 0.04], alpha: 0.6 });
      if (hp < 0.25) game.fx.emit(at, s.vel, { life: 0.25, size: s.radius * 0.3, sizeEnd: 1, color: [4, 1.8, 0.5] });
    }
    s.trailT -= dt;
    if (!s.isPlayer && s.trailT <= 0 && thrust > 0.05) {
      s.trailT = 0.03;
      const f = forwardOf(s.obj);
      const pos = s.exhaust.clone().applyQuaternion(s.obj.quaternion).add(s.pos);
      const c = s.engineColor;
      game.fx.emit(pos, f.multiplyScalar(-60).add(s.vel), { life: 0.5, size: s.afterburner ? 5 : 3, sizeEnd: 0.5, color: [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6] });
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
  if (st === 'autopilot' || st === 'dead' || st === 'docking' || !p) return;
  if (game.view === 'cockpit') {
    camera.quaternion.copy(p.obj.quaternion);
    camera.position.copy(p.pos).add(V(0, 1.4, -3).applyQuaternion(p.obj.quaternion));
  } else if (game.view === 'chase') {
    // Chase cam: a spring-damped camera that trails the ship, lags into turns,
    // banks with it and widens the field of view with speed.
    const C = game.chase;
    const want = V(0, 11, 52).applyQuaternion(p.obj.quaternion).add(p.pos);
    C.pos.addScaledVector(p.vel, dt);                     // carried along with the ship
    C.pos.lerp(want, 1 - Math.exp(-5 * dt));               // then sprung toward the ideal spot
    const ahead = V(0, 2, -90).applyQuaternion(p.obj.quaternion).add(p.pos);
    C.look.addScaledVector(p.vel, dt).lerp(ahead, 1 - Math.exp(-9 * dt));
    C.up.lerp(V(0, 1, 0).applyQuaternion(p.obj.quaternion), 1 - Math.exp(-4 * dt)).normalize();
    camera.position.copy(C.pos);
    camera.up.copy(C.up);
    camera.lookAt(C.look);
    const fov = 72 + Math.min(14, p.speed / 45) + (p.afterburner ? 4 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-3 * dt)); updateProjection(); }
  } else {
    _camQ.copy(p.obj.quaternion);
    camera.quaternion.slerp(_camQ, 1 - Math.exp(-8 * dt));
    camera.position.copy(p.pos).add(V(0, 9, 42).applyQuaternion(camera.quaternion));
    camera.rotateX(-0.06);
  }
  if (game.view !== 'chase' && game.state !== 'jump' && Math.abs(camera.fov - 72) > 0.05) { camera.fov = 72; updateProjection(); }
  if (game.shake > 0 && (st === 'flight' || st === 'jump')) {
    const s = game.shake;
    camera.rotateX((Math.random() - 0.5) * 0.012 * s);
    camera.rotateY((Math.random() - 0.5) * 0.012 * s);
    game.shake = Math.max(0, game.shake - dt * 2.5);
  }
}

// Lens flare: project the star, fade it toward the screen edge, and hide it behind planets.
const _fs = V(), _fo = V();
let flareVis = 0;
function updateFlare() {
  const w = game.world, fu = flarePass.uniforms;
  fu.aspect.value = innerWidth / innerHeight;
  fu.time.value = performance.now() / 1000;
  const inView = !['map', 'trade'].includes(game.state);
  _fs.copy(w.sunPos).applyMatrix4(camera.matrixWorldInverse);
  let vis = 0;
  if (inView && _fs.z < 0) {
    const toSun = _fs.copy(w.sunPos).sub(camera.position);
    const dist = toSun.length();
    toSun.divideScalar(dist);
    vis = 1;
    for (const p of w.planets) {
      if (p.star) continue;
      const oc = _fo.copy(p.pos).sub(camera.position);
      const t = oc.dot(toSun);
      if (t < 0 || t > dist) continue;
      const miss = Math.sqrt(Math.max(0, oc.lengthSq() - t * t));
      vis = Math.min(vis, THREE.MathUtils.smoothstep(miss, p.radius * 0.995, p.radius * 1.06));
    }
    // Nearby asteroids can eclipse the star too.
    if (w.belt && camera.position.distanceTo(w.belt.center) < w.belt.extent + 8000) {
      for (const r of w.belt.rocks) {
        const oc = _fo.copy(r.p).sub(camera.position);
        const t = oc.dot(toSun);
        if (t < 0 || t > 9000) continue;
        const miss = Math.sqrt(Math.max(0, oc.lengthSq() - t * t));
        if (miss < r.r * 1.1) vis = Math.min(vis, THREE.MathUtils.smoothstep(miss, r.r * 0.8, r.r * 1.1));
      }
    }
    const sp = w.sunPos.clone().project(camera);
    fu.sun.value.set((sp.x + 1) / 2, (sp.y + 1) / 2);
    const off = Math.hypot(sp.x, sp.y / (innerWidth / innerHeight)) ;
    vis *= Math.pow(Math.max(0, 1 - off / 1.7), 1.3);
  }
  // Drop instantly when hidden, ease in when revealed.
  flareVis = vis < flareVis ? vis : flareVis + (vis - flareVis) * 0.3;
  fu.intensity.value = flareVis;
  const c = w.starColor || [2, 1.7, 1.2], m = Math.max(...c);
  fu.tint.value.setRGB(c[0] / m, c[1] / m, c[2] / m);
}

const _bhv = V(), _edge = V();
function render() {
  const bh = game.world.blackHole;
  camera.updateMatrixWorld();
  const u = lensPass.uniforms;
  u.strength.value = 0;
  if (bh) {
    _bhv.copy(bh.pos).applyMatrix4(camera.matrixWorldInverse);
    if (_bhv.z < -bh.horizon * 1.5) {
      const c = bh.pos.clone().project(camera);
      _edge.copy(_bhv); _edge.y += bh.horizon;
      _edge.applyMatrix4(camera.projectionMatrix);
      const r = Math.abs(_edge.y - c.y) * 0.5;
      u.center.value.set((c.x + 1) / 2, (c.y + 1) / 2);
      u.radius.value = r;
      // The lens is a screen-space effect, so switch it off where a closer body (the star,
      // a planet) sits in front of the black hole; otherwise it would warp that body too.
      const bhDist = camera.position.distanceTo(bh.pos);
      const toBh = V().subVectors(bh.pos, camera.position).normalize();
      let k = 1;
      for (const pl of game.world.planets) {
        const d = camera.position.distanceTo(pl.pos);
        if (d >= bhDist) continue;
        const sep = toBh.angleTo(V().subVectors(pl.pos, camera.position));
        const ang = Math.asin(Math.min(1, pl.radius / d));
        k = Math.min(k, THREE.MathUtils.smoothstep(sep, ang + Math.atan(bh.horizon * 6 / bhDist), ang + Math.atan(bh.horizon * 14 / bhDist)));
      }
      u.strength.value = r > 0.0008 ? k : 0;
    }
  }
  u.aspect.value = innerWidth / innerHeight;
  updateFlare();

  composer.render();

  if (game.dashVisible) cockpit.renderScreens(renderer);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function setView(v) {
  const p = game.player;
  game.view = v;
  p.obj.visible = v !== 'cockpit';
  setDash(v === 'cockpit');
  if (v === 'external') camera.quaternion.copy(p.obj.quaternion);
  if (v === 'chase') {
    // Start the spring where the camera would ideally be, so it doesn't swoop in from the cockpit.
    game.chase = {
      pos: V(0, 11, 52).applyQuaternion(p.obj.quaternion).add(p.pos),
      look: V(0, 2, -90).applyQuaternion(p.obj.quaternion).add(p.pos),
      up: V(0, 1, 0).applyQuaternion(p.obj.quaternion),
    };
  }
  camera.up.set(0, 1, 0);
}
function resetChase() { if (game.view === 'chase' && game.player) setView('chase'); }
game.resetChase = resetChase;
function toggleView() { setView(game.view === 'cockpit' ? 'external' : 'cockpit'); }
function toggleChase() {
  setView(game.view === 'chase' ? 'cockpit' : 'chase');
  hud.msg(game.view === 'chase' ? 'Chase camera (F2 to return to the cockpit)' : 'Cockpit view', COL.comm);
}

function playerMissile() {
  const p = game.player, type = p.missileType, M = MISSILES[type];
  if (!p.ammo[type]) { hud.msg(`Out of ${M.name} missiles. Buy more at a station, or press G to switch type.`, COL.warn); audio.denied(); return; }
  let target = null;
  if (M.lock === 0) {
    target = heatTarget(game, p);
    hud.msg(target ? `${M.name} away: tracking ${target.name}.` : `${M.name} away: no heat source, flying straight.`, COL.comm);
  } else {
    const locked = game.target && game.target.alive && p.lockTime >= M.lock;
    target = locked ? game.target : null;
    hud.msg(locked ? `${M.name} away: locked on.` : `${M.name} away: dumbfire (no lock).`, COL.comm);
  }
  fireMissile(game, p, target, type);
  p.lockTime = 0;
}

function cycleMissile() {
  const p = game.player;
  const types = Object.keys(MISSILES);
  let i = types.indexOf(p.missileType);
  for (let n = 0; n < types.length; n++) {
    i = (i + 1) % types.length;
    if (p.ammo[types[i]] > 0) break;
  }
  p.missileType = types[i];
  p.lockTime = 0;
  const M = MISSILES[p.missileType];
  hud.msg(`Missile: ${M.name} (${M.label}) x${p.ammo[p.missileType]}${M.lock ? `, ${M.lock} s lock` : ', fire and forget'}`, COL.comm);
  audio.blip();
}

function onKey(code) {
  const st = game.state;
  if (st === 'menu' || (st === 'dead' && game.deathShown)) {
    if (code === 'Enter' || code === 'Space') menuPrimary();
    return;
  }
  if (code === 'KeyU') { const on = audio.toggleMusic(); hud.msg(on ? 'Music on' : 'Music off', COL.comm); return; }
  if (st === 'paused') { if (code === 'KeyP' || code === 'Escape' || code === 'KeyH') resume(); return; }
  if (st === 'map') {
    if (code === 'KeyM' || code === 'Escape') ui.closeMap();
    else if (code === 'KeyN') { cycleNav(); ui.drawMap(); }
    else if (code === 'KeyA') { ui.closeMap(); engageAutopilot(); }
    return;
  }
  if (st === 'trade') {
    if (code === 'KeyL' || code === 'Escape') game.launchFromStation(ui.station);
    const tabs = { Digit1: 'market', Digit2: 'contracts', Digit3: 'shipyard', Digit4: 'services', Digit5: 'story' };
    if (tabs[code]) { ui.tab = tabs[code]; ui.notice = null; ui.renderTrade(); }
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
    case 'KeyJ': startJump(); break;
    case 'KeyG': cycleMissile(); break;
    case 'KeyY':
      game.flightAssist = !game.flightAssist;
      hud.msg(game.flightAssist ? 'Flight assist ON: thrusters cancel drift.' : 'Flight assist OFF: full Newtonian.', COL.comm);
      audio.blip();
      break;
    case 'KeyX':
      if (launchDecoy(game)) hud.msg(`Decoy away (${game.player.decoys} left).`, COL.comm);
      else { hud.msg('No decoys left.', COL.warn); audio.denied(); }
      break;
    case 'Enter': case 'NumpadEnter': playerMissile(); break;
    case 'Backspace': game.player.throttle = 0; break;
    case 'KeyV': toggleView(); break;
    case 'F2': toggleChase(); break;
    case 'KeyI':
      game.invertPitch = SETTINGS.invert = !game.invertPitch; saveSettings(); document.getElementById('setInvert').checked = SETTINGS.invert;
      hud.msg(`Pitch keys: ${game.invertPitch ? 'Up = nose up' : 'Up = nose down'}`, COL.comm);
      break;
    case 'KeyF':
      game.mouseFlight = SETTINGS.mouseFlight = !game.mouseFlight; saveSettings(); document.getElementById('setMouseFlight').checked = SETTINGS.mouseFlight;
      hud.msg(`Mouse flight ${game.mouseFlight ? 'ON' : 'OFF'}`, COL.comm);
      break;
    case 'KeyK':
      audio.setMuted(!audio.muted);
      hud.msg(audio.muted ? 'Sound muted' : 'Sound on', COL.comm);
      break;
    case 'KeyP': case 'Escape': case 'KeyH': pause(); break;
  }
}

touch = initTouch(game, code => {
  audio.init();
  if (game.state === 'paused' && code === 'KeyP') { resume(); return; }
  onKey(code);
});

const PREVENT = new Set(['AltLeft', 'AltRight', 'F2', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Enter']);
addEventListener('keydown', e => {
  if (PREVENT.has(e.code)) e.preventDefault();
  if (e.code.startsWith('Alt')) { game.mouseFree = true; hud.markAltSeen(); }
  audio.init();
  keys[e.code] = true;
  if (!e.repeat) onKey(e.code);
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code.startsWith('Alt')) { e.preventDefault(); game.mouseFree = false; } });
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  game.mouse.left = false;
  pause();
});
addEventListener('mousemove', e => { if (game.touchMode) return; game.mouse.x = e.clientX; game.mouse.y = e.clientY; game.mouse.inside = true; });
document.documentElement.addEventListener('mouseleave', () => { game.mouse.inside = false; game.mouse.left = false; });
// Click on a ship, pod or station on screen to target it.
function pickAt(x, y) {
  const p = game.player;
  const cands = [...game.ships.filter(s => s.alive && !s.isPlayer), ...salvage.pods, ...game.world.stations];
  let best = null, bd = 34;
  for (const c of cands) {
    if (c.pos.distanceTo(p.pos) > 30000) continue;
    const pr = hud.project(c.pos);
    if (!pr.on) continue;
    const d = Math.hypot(pr.x - x, pr.y - y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
game.pickAt = pickAt;
addEventListener('mousedown', e => {
  if (game.state !== 'flight' || game.touchMode) return;
  game.mouseFree = e.altKey;
  const free = e.altKey || !game.mouseFlight;
  if (e.button === 0 && free) {
    const t = pickAt(e.clientX, e.clientY);
    if (t) { game.target = t; game.player.lockTime = 0; audio.blip(); return; }
    if (e.altKey) return; // Alt held: clicking empty space does nothing
  }
  if (e.button === 0) game.mouse.left = true;
  if (e.button === 2 && !e.altKey) playerMissile();
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
  pollPad();
  const st = game.state;

  if (st === 'flight') updateFlight(dt);
  else if (st === 'autopilot') updateAutopilot(dt);
  else if (st === 'jump') { game.time += dt; updateJump(dt); }
  else if (st === 'docking') {
    updateFlight(dt);
    if (updateDocking(dt)) {
      const p = game.player;
      game.view = game.dock.prevView;
      p.obj.visible = game.view !== 'cockpit';
      camera.up.set(0, 1, 0);
      if (game.view === 'cockpit') setDash(true);
      resetChase();
      hud.cracks = [];
      p.shieldF = p.shieldR = p.shieldMax;
      p.vel.set(0, 0, 0); p.throttle = 0; p.radiation = 0;
      clearCombat();
      audio.engine(0, false, false);
      audio.gravity(0);
      ui.notice = null;
      completeDeliveries(game.dockStation);
      storyOnDock(game.dockStation);
      ui.openTrade(game.dockStation);
      if (game.storyAvailableHere(game.dockStation) && !ui.notice) ui.notice = { title: 'NEW STORY CHAPTER AVAILABLE', text: 'Someone here wants to talk to you. Open the STORY tab (5).' };
      ui.renderTrade();
      saveAt(game.dockStation);
    }
  } else if (st === 'dead') {
    for (const s of game.ships) if (s.alive && !s.isPlayer) { updateAI(s, game, dt); updateShipMotion(s, dt, game.world); }
    updateLasers(game, dt);
    updateMissiles(game, dt);
    updateDead(dt);
  } else if (st === 'map' || st === 'trade' || st === 'paused') {
    audio.engine(0, false, false);
  }

  if (st !== 'map' && st !== 'trade' && st !== 'paused') { game.fx.update(dt); game.bubbles.update(dt); }
  const p = game.player;
  const combat = p && p.alive && game.ships.some(s => isThreat(s) && s.pos.distanceTo(p.pos) < 7000) ? 1 : 0;
  audio.music(dt, st !== 'menu', combat);
  game.mouseFree = !!(keys.AltLeft || keys.AltRight);
  game.pickHover = st === 'flight' && game.player && game.mouse.inside && !game.touchMode && (game.mouseFree || !game.mouseFlight) ? pickAt(game.mouse.x, game.mouse.y) : null;
  document.body.classList.toggle('flying', st === 'flight' && game.mouseFlight && !game.touchMode && !game.mouseFree);
  updateShipVisuals(dt);
  updateCamera(dt);
  game.world.update(dt, camera);
  warp.update(dt, camera, st === 'jump' && game.jump ? game.jump.warp || 0 : 0);
  dust.update(camera.position, p ? p.vel : V(), !!p && p.alive && (st === 'flight' || st === 'docking' || st === 'jump'));
  render();
  hud.draw(dt);
  if (game.dashVisible) cockpit.draw();
}

updateProjection();
requestAnimationFrame(frame);
