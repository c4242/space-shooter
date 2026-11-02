import * as THREE from 'three';
import { buildPlayerModel, buildPirateModel, buildMarauderModel, buildFreighterModel, buildPoliceModel, buildWarlordModel, buildBastionModel, buildWingmanModel, buildCarrierModel, buildDreadnoughtModel, buildLeviathanModel, lockTimeFor, MISSILES, heatTarget } from './ships.js';
import { STORY } from './story.js';
import { missionSummary } from './career.js';
import { makeStation } from './world.js';
import { fmtDist } from './hud.js';

// The cockpit is drawn on one 2D canvas layered above the 3D view:
//  - a static frame (struts, overhead panel, walls, dashboard, bezels), pre-rendered on resize,
//    with transparent "holes" for the two side screens;
//  - dynamic instruments drawn every frame;
//  - the side screens show green wireframe models rendered by WebGL through the holes.

const M = {
  hi: '#5f8656', light: '#476b40', base: '#304b2c', dark: '#1b2c19', darker: '#0b140a',
};
const PH = '120,255,140';                 // phosphor green
const phos = (a = 1) => `rgba(${PH},${a})`;
const RED = '#ff4a35', AMBER = '#ffb340';

function vgrad(c, y0, y1, a, b) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a); g.addColorStop(1, b);
  return g;
}
function path(c, pts) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
}
function plate(c, pts, a = M.light, b = M.base) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  path(c, pts);
  c.fillStyle = vgrad(c, y0, y1, a, b); c.fill();
  c.lineWidth = 2.5; c.strokeStyle = M.darker; c.stroke();
  c.lineWidth = 1; c.strokeStyle = 'rgba(210,255,200,0.13)'; c.stroke();
}
function box(c, x, y, w, h, r, a, b) {
  c.beginPath(); c.roundRect(x, y, w, h, r);
  c.fillStyle = vgrad(c, y, y + h, a, b); c.fill();
  c.lineWidth = 2.5; c.strokeStyle = M.darker; c.stroke();
  c.beginPath(); c.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, r - 1));
  c.lineWidth = 1; c.strokeStyle = 'rgba(210,255,200,0.14)'; c.stroke();
}
function recess(c, x, y, w, h, r = 4) {
  c.beginPath(); c.roundRect(x - 2, y - 2, w + 4, h + 4, r + 2);
  c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill();
  c.beginPath(); c.roundRect(x, y, w, h, r);
  c.fillStyle = '#040a04'; c.fill();
  c.lineWidth = 1; c.strokeStyle = 'rgba(210,255,200,0.18)'; c.stroke();
}
function rivet(c, x, y, s) {
  c.fillStyle = M.darker; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill();
  c.fillStyle = 'rgba(220,255,210,0.3)'; c.beginPath(); c.arc(x - s * 0.3, y - s * 0.3, s * 0.45, 0, 7); c.fill();
}
function label(c, text, x, y, size, color = 'rgba(220,255,200,0.75)', align = 'center') {
  c.font = `${Math.round(size)}px "Share Tech Mono", monospace`;
  c.textAlign = align; c.textBaseline = 'middle';
  c.fillStyle = color; c.fillText(text, x, y);
}

// Green wireframe copy of a model, centred on its bounding sphere.
function wire(group, color) {
  group.updateMatrixWorld(true);
  const inner = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color });
  group.traverse(o => {
    if (!o.isMesh) return;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), mat);
    o.matrixWorld.decompose(e.position, e.quaternion, e.scale);
    inner.add(e);
  });
  const sphere = new THREE.Box3().setFromObject(inner).getBoundingSphere(new THREE.Sphere());
  inner.position.copy(sphere.center).negate();
  const outer = new THREE.Group();
  outer.add(inner);
  outer.userData.radius = sphere.radius;
  return outer;
}

export class Cockpit {
  constructor(game) {
    this.g = game;
    this.canvas = document.getElementById('cockpit');
    this.ctx = this.canvas.getContext('2d');
    this.frame = document.createElement('canvas');
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100000);
    const green = new THREE.Color(0.45, 1.0, 0.5);
    this.models = {
      player: wire(buildPlayerModel().group, green),
      bastion: wire(buildBastionModel().group, green),
      wingman: wire(buildWingmanModel().group, new THREE.Color(0.5, 1.0, 0.6)),
      pirate: wire(buildPirateModel().group, green),
      marauder: wire(buildMarauderModel().group, green),
      freighter: wire(buildFreighterModel().group, new THREE.Color(1.0, 0.9, 0.45)),
      smuggler: wire(buildFreighterModel().group, new THREE.Color(1.0, 0.5, 0.4)),
      carrier: wire(buildCarrierModel().group, new THREE.Color(1.0, 0.45, 0.35)),
      dreadnought: wire(buildDreadnoughtModel().group, new THREE.Color(0.5, 0.75, 1.0)),
      leviathan: wire(buildLeviathanModel().group, new THREE.Color(1.0, 0.45, 0.35)),
      police: wire(buildPoliceModel().group, new THREE.Color(0.5, 0.75, 1.0)),
      warlord: wire(buildWarlordModel().group, new THREE.Color(1.0, 0.45, 0.35)),
      station: wire(makeStation(0x33ff88).group, green),
    };
    for (const m of Object.values(this.models)) { m.visible = false; this.scene.add(m); }
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this.resize();
  }

  // ------------------------------------------------------------------ layout
  resize() {
    const W = innerWidth, H = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    for (const cv of [this.canvas, this.frame]) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    this.L = this.layout(W, H);
    this.drawFrame();
  }

  layout(W, H) {
    const D = Math.round(Math.min(H * 0.4, W * 0.32));
    const u = D / 260;
    const top = H - D;
    const topBand = Math.max(24, Math.round(H * 0.06));
    const mfdW = Math.min(W * 0.27, D * 1.2), mfdH = D * 0.92;
    const mx = W * 0.025;
    const mfdL = { x: mx, y: H - mfdH, w: mfdW, h: mfdH };
    const mfdR = { x: W - mx - mfdW, y: H - mfdH, w: mfdW, h: mfdH };
    const scr = b => ({ x: b.x + 12 * u, y: b.y + 30 * u, w: b.w - 24 * u, h: b.h - 34 * u });
    const cx = W / 2;
    const cw = Math.min(mfdR.x - (mfdL.x + mfdW) - 24 * u, D * 2.4);
    const cTop = H - D * 1.12;
    const con = { x: cx - cw / 2, y: cTop, w: cw, h: H - cTop };
    const R = Math.min(D * 0.37, cw * 0.2);
    const radar = { cx, cy: cTop + 36 * u + R, r: R };
    const lx0 = con.x + 16 * u, lx1 = cx - R - 20 * u;
    const rx0 = cx + R + 20 * u, rx1 = con.x + cw - 16 * u;
    const rowY = cTop + 32 * u, rowH = 32 * u;
    const lowY = cTop + 72 * u, lowB = H - 12 * u;
    const rw = rx1 - rx0;
    const ow = Math.min(W * 0.62, 8 * 62 * u + 30 * u);
    return {
      W, H, D, u, top, topBand, cx, cTop, con, radar, mfdL, mfdR,
      scrL: scr(mfdL), scrR: scr(mfdR),
      leds: { x: cx - cw * 0.3, y: cTop + 12 * u, w: cw * 0.6, h: 11 * u },
      set: { x: lx0, y: rowY, w: lx1 - lx0, h: rowH },
      spd: { x: rx0, y: rowY, w: rx1 - rx0, h: rowH },
      shield: { x: lx0, y: lowY, w: lx1 - lx0, h: lowB - lowY },
      lock: { x: rx0, y: lowY, w: rw - 32 * u, h: 22 * u },
      msl: { x: rx0, y: lowY + 30 * u, w: rw - 32 * u, h: lowB - lowY - 30 * u },
      fuel: { x: rx1 - 16 * u, y: lowY, w: 16 * u, h: lowB - lowY },
      over: { x: cx - ow / 2, y: -4, w: ow, h: topBand + 18 * u },
      lights: { x: cx - ow / 2 + 14 * u, y: 6 * u, w: ow - 28 * u, h: topBand - 2 * u },
      clusterL: { x: W * 0.015, y: H * 0.535, w: Math.max(40, W * 0.07), h: 24 * u },
      clusterR: { x: W - W * 0.015 - Math.max(40, W * 0.07), y: H * 0.535, w: Math.max(40, W * 0.07), h: 24 * u },
    };
  }

  // ------------------------------------------------------------ static frame
  drawFrame() {
    const L = this.L, { W, H, u, top, topBand, cx } = L;
    const c = this.frame.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    // Side walls with recessed light clusters
    for (const s of [1, -1]) {
      const X = x => (s > 0 ? x : W - x);
      plate(c, [[X(0), H * 0.42], [X(W * 0.17), top - 26 * u], [X(W * 0.17), H], [X(0), H]], M.base, M.dark);
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(X(0), H * 0.6); c.lineTo(X(W * 0.17), H * 0.66); c.stroke();
      const cl = s > 0 ? L.clusterL : L.clusterR;
      recess(c, cl.x, cl.y, cl.w, cl.h, 3);
    }

    // Dashboard body
    c.fillStyle = vgrad(c, top, H, M.light, M.darker);
    c.fillRect(0, top, W, H - top);
    box(c, -10, top - 7 * u, W + 20, 11 * u, 3, M.hi, M.base);

    // Raised centre console
    const { con } = L, ex = 34 * u;
    plate(c, [[con.x - ex, top], [con.x, con.y], [con.x + con.w, con.y], [con.x + con.w + ex, top], [con.x + con.w + ex, H + 4], [con.x - ex, H + 4]], M.light, M.dark);
    box(c, con.x - 4 * u, con.y - 5 * u, con.w + 8 * u, 9 * u, 3, M.hi, M.base);
    for (const x of [con.x + 8 * u, con.x + con.w - 8 * u]) for (const y of [con.y + 14 * u, H - 10 * u]) rivet(c, x, y, 2.6 * u);

    // Canopy struts
    for (const s of [1, -1]) {
      const X = x => (s > 0 ? x : W - x);
      const pts = [[X(0), topBand + 4 * u], [X(W * 0.075), topBand - 2 * u], [X(W * 0.265), top - 4 * u], [X(W * 0.215), top + 4 * u]];
      plate(c, pts, M.light, M.base);
      c.strokeStyle = 'rgba(220,255,210,0.22)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(X(W * 0.04), topBand + 3 * u); c.lineTo(X(W * 0.238), top - 2 * u); c.stroke();
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        rivet(c, X(W * 0.045 + (W * 0.2 - W * 0.045) * t), topBand + (top - topBand) * t, 2.2 * u);
      }
    }

    // Overhead frame and centre overhead panel
    c.beginPath();
    c.moveTo(-5, -5); c.lineTo(W + 5, -5); c.lineTo(W + 5, topBand + 8 * u);
    c.quadraticCurveTo(cx, topBand * 0.15, -5, topBand + 8 * u);
    c.closePath();
    c.fillStyle = vgrad(c, 0, topBand + 8 * u, M.light, M.base); c.fill();
    c.lineWidth = 2.5; c.strokeStyle = M.darker; c.stroke();
    box(c, L.over.x, L.over.y, L.over.w, L.over.h, 10 * u, M.light, M.dark);
    recess(c, L.lights.x, L.lights.y, L.lights.w, L.lights.h, 4);
    for (const x of [L.over.x + 7 * u, L.over.x + L.over.w - 7 * u]) rivet(c, x, L.over.h - 8 * u, 2.4 * u);

    // Side screen bezels, with transparent holes for the wireframe views
    for (const [b, scr, title] of [[L.mfdL, L.scrL, 'WEAPONS'], [L.mfdR, L.scrR, 'TARGETING']]) {
      box(c, b.x, b.y, b.w, b.h + 10, 12 * u, M.hi, M.dark);
      recess(c, b.x + b.w / 2 - 50 * u, b.y + 7 * u, 100 * u, 16 * u, 3);
      label(c, title, b.x + b.w / 2, b.y + 15.5 * u, 10 * u, AMBER);
      for (const x of [b.x + 16 * u, b.x + 34 * u, b.x + b.w - 34 * u, b.x + b.w - 16 * u]) recess(c, x - 6 * u, b.y + 9 * u, 12 * u, 11 * u, 2);
      c.beginPath(); c.roundRect(scr.x - 4, scr.y - 4, scr.w + 8, scr.h + 8, 9 * u);
      c.fillStyle = M.darker; c.fill();
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.roundRect(scr.x, scr.y, scr.w, scr.h, 7 * u); c.fill();
      c.restore();
    }

    // Console instrument housings
    recess(c, L.leds.x - 4 * u, L.leds.y - 3 * u, L.leds.w + 8 * u, L.leds.h + 6 * u, 3);
    for (const [b, t] of [[L.set, 'THR %'], [L.spd, 'SPD m/s']]) {
      recess(c, b.x, b.y, b.w, b.h, 3);
      label(c, t, b.x + 5 * u, b.y + 7 * u, Math.max(8, 8 * u), 'rgba(220,255,200,0.55)', 'left');
    }
    recess(c, L.shield.x, L.shield.y, L.shield.w, L.shield.h, 5);
    recess(c, L.lock.x, L.lock.y, L.lock.w, L.lock.h, 3);
    recess(c, L.msl.x, L.msl.y, L.msl.w, L.msl.h, 5);
    recess(c, L.fuel.x, L.fuel.y, L.fuel.w, L.fuel.h, 3);
    // Radar bezel
    const r = L.radar;
    c.beginPath(); c.arc(r.cx, r.cy, r.r + 12 * u, 0, Math.PI * 2);
    c.fillStyle = vgrad(c, r.cy - r.r, r.cy + r.r, M.hi, M.darker); c.fill();
    c.lineWidth = 2.5; c.strokeStyle = M.darker; c.stroke();
    c.beginPath(); c.arc(r.cx, r.cy, r.r + 3 * u, 0, Math.PI * 2); c.fillStyle = '#020702'; c.fill();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + Math.PI / 8;
      rivet(c, r.cx + Math.cos(a) * (r.r + 8 * u), r.cy + Math.sin(a) * (r.r + 8 * u), 1.8 * u);
    }
  }

  // ------------------------------------------------------------ per frame
  draw() {
    const g = this.g, p = g.player, L = this.L, c = this.ctx;
    if (!p) return;
    const { u } = L;
    const t = performance.now() / 1000;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.frame, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawClusters(c, t);
    this.drawWarningLights(c, t);

    // Gun energy LED bar
    const n = 20, lb = L.leds, lit = Math.round(p.energy / 100 * n), lw = lb.w / n;
    for (let i = 0; i < n; i++) {
      c.fillStyle = i < lit ? (i < n * 0.25 ? '#ff2a10' : '#ff5a1e') : '#2a0905';
      c.beginPath(); c.roundRect(lb.x + i * lw + lw * 0.15, lb.y, lw * 0.7, lb.h, 2); c.fill();
    }

    // Digital readouts
    const dig = (b, v, col) => {
      const x = b.x + b.w - 5 * u, y = b.y + b.h / 2 + 3 * u;
      const fs = Math.min(19 * u, b.w / 2.9, b.h * 0.75);
      label(c, '8888', x, y, fs, 'rgba(120,255,140,0.07)', 'right');
      label(c, String(Math.round(v)), x, y, fs, col, 'right');
    };
    dig(L.set, p.throttle * 100, p.retro ? AMBER : phos(0.95));
    dig(L.spd, p.speed, p.afterburner ? AMBER : phos(0.95));

    this.drawShields(c, L.shield, p);
    this.drawRadar(c, L.radar, t);
    this.drawRightCluster(c, t);
    this.drawWeapons(c, L.scrL, p);
    if (this.commOn()) this.drawComm(c, L.scrR, t); else this.drawTargeting(c, L.scrR, t);
    // Heavy damage makes the electronics glitch.
    const hp = p.armor / p.armorMax;
    if ((hp < 0.35 && Math.random() < 0.08 * (1.4 - hp)) || g.hud.flash > 0.35) {
      for (const s of [L.scrL, L.scrR]) {
        c.fillStyle = `rgba(0,0,0,${0.4 + Math.random() * 0.5})`;
        c.fillRect(s.x, s.y, s.w, s.h);
        c.fillStyle = 'rgba(160,255,170,0.25)';
        for (let i = 0; i < 6; i++) c.fillRect(s.x, s.y + Math.random() * s.h, s.w, 1 + Math.random() * 3);
      }
    }
  }

  drawClusters(c, t) {
    const L = this.L;
    const cols = ['#4a8cff', '#ffae2a', '#ff4030', '#6aff7a'];
    for (const [k, cl] of [[0, L.clusterL], [1, L.clusterR]]) {
      const rows = 2, colsN = 6;
      for (let i = 0; i < rows; i++) for (let j = 0; j < colsN; j++) {
        const id = k * 31 + i * 7 + j;
        const on = Math.sin(t * (0.7 + (id % 5) * 0.37) + id * 1.7) > 0.1;
        const x = cl.x + (j + 0.5) * cl.w / colsN, y = cl.y + (i + 0.5) * cl.h / rows;
        c.fillStyle = on ? cols[(id * 3) % 4] : 'rgba(255,255,255,0.06)';
        c.beginPath(); c.arc(x, y, Math.min(cl.w / colsN, cl.h / rows) * 0.26, 0, 7); c.fill();
      }
    }
  }

  drawWarningLights(c, t) {
    const g = this.g, p = g.player, L = this.L, b = L.lights;
    const blink = (t * 2.2 % 1) < 0.55;
    const sh = (p.shieldF + p.shieldR) / (2 * p.shieldMax), ar = p.armor / p.armorMax;
    const incoming = g.missiles.some(m => m.target === p);
    const tracked = g.ships.some(s => s.alive && s.team === 'pirate' && s.aiTarget === p && s.lockTime > 1);
    const items = [
      ['SHLD', sh < 0.15 ? 'red*' : sh < 0.4 ? 'amber' : ''],
      ['ARMR', ar < 0.3 ? 'red*' : ar < 0.7 ? 'amber' : ''],
      ['INCM', incoming ? 'red*' : ''],
      ['TRCK', tracked ? 'amber*' : ''],
      p.radiation > 0 ? ['RAD', p.radiation > 0.4 ? 'red*' : 'amber*'] : ['GRAV', p.gAccel > 80 ? 'red*' : p.gAccel > 15 ? 'amber' : ''],
      ['FUEL', p.abFuel < 20 ? 'amber*' : ''],
      ['AUTO', g.autopilotStatus().ok ? 'green' : ''],
      ['DOCK', g.dockableStation() ? 'green' : ''],
    ];
    const n = items.length, w = b.w / n;
    items.forEach(([txt, st], i) => {
      const x = b.x + i * w + 3, y = b.y + 3, bw = w - 6, bh = b.h - 6;
      const flashing = st.endsWith('*'), kind = st.replace('*', '');
      const on = kind && (!flashing || blink);
      const col = { red: ['#7a110a', '#ff9a8a', '#ff3020'], amber: ['#6a4206', '#ffe0a0', '#ffa020'], green: ['#0c5a24', '#b0ffc8', '#30ff70'] }[kind];
      c.beginPath(); c.roundRect(x, y, bw, bh, 3);
      if (on) { c.shadowColor = col[2]; c.shadowBlur = 12; c.fillStyle = col[0]; }
      else c.fillStyle = '#141a12';
      c.fill(); c.shadowBlur = 0;
      label(c, txt, x + bw / 2, y + bh / 2 + 1, Math.min(bh * 0.55, bw * 0.28), on ? col[1] : 'rgba(150,170,140,0.35)');
    });
  }

  drawShields(c, b, p) {
    const { u } = this.L;
    const cx = b.x + b.w / 2;
    const col = f => (f > 0.6 ? phos(0.95) : f > 0.25 ? AMBER : RED);
    label(c, 'SHIELDS', cx, b.y + 10 * u, Math.min(9 * u, b.w / 7), phos(0.55));
    const fsN = Math.min(10 * u, b.w / 7);
    const numW = fsN * 2.2;
    const bx = b.x + 6 * u + numW, bw = b.x + b.w - 6 * u - bx;
    const bar = (y, f) => {
      f = Math.max(0, f);
      const segs = 8, sw = bw / segs;
      for (let i = 0; i < segs; i++) {
        c.fillStyle = i < Math.ceil(f * segs - 0.01) ? col(f) : 'rgba(120,255,140,0.08)';
        c.fillRect(bx + i * sw + 1, y, sw - 2, 7 * u);
      }
    };
    const sF = p.shieldF / p.shieldMax, sR = p.shieldR / p.shieldMax, af = Math.max(0, p.armor / p.armorMax);
    const top = b.y + 20 * u, bot = b.y + b.h - 34 * u;
    bar(top, sF);
    bar(bot, sR);
    // Ship glyph, coloured by armour
    const gy = (top + bot) / 2 + 3 * u, s = Math.min(b.w * 0.2, (bot - top) * 0.32);
    const glyph = [[0, -1], [0.3, -0.2], [0.95, 0.45], [0.95, 0.7], [0.3, 0.55], [0.2, 0.9], [-0.2, 0.9], [-0.3, 0.55], [-0.95, 0.7], [-0.95, 0.45], [-0.3, -0.2]];
    path(c, glyph.map(([x, y]) => [cx + x * s, gy + y * s]));
    c.fillStyle = af > 0.6 ? 'rgba(120,255,140,0.35)' : af > 0.3 ? 'rgba(255,180,64,0.45)' : 'rgba(255,74,53,0.55)';
    c.fill();
    c.strokeStyle = col(af); c.lineWidth = 1.5; c.stroke();
    label(c, String(Math.round(Math.max(0, p.shieldF))), b.x + 5 * u, top + 3.5 * u, fsN, phos(0.7), 'left');
    label(c, String(Math.round(Math.max(0, p.shieldR))), b.x + 5 * u, bot + 3.5 * u, fsN, phos(0.7), 'left');
    label(c, `ARMOR ${Math.round(af * 100)}%`, cx, b.y + b.h - 12 * u, Math.min(10 * u, b.w / 8), col(af));
  }

  drawRadar(c, r, t) {
    const g = this.g, p = g.player, { u } = this.L;
    const R = r.r;
    c.save();
    c.beginPath(); c.arc(r.cx, r.cy, R, 0, Math.PI * 2); c.clip();
    const bg = c.createRadialGradient(r.cx, r.cy, 0, r.cx, r.cy, R);
    bg.addColorStop(0, '#0a2810'); bg.addColorStop(1, '#030c04');
    c.fillStyle = bg; c.fillRect(r.cx - R, r.cy - R, R * 2, R * 2);
    c.strokeStyle = phos(0.35); c.lineWidth = 1;
    for (const k of [0.33, 0.66]) { c.beginPath(); c.arc(r.cx, r.cy, R * k, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(r.cx - R, r.cy); c.lineTo(r.cx + R, r.cy); c.moveTo(r.cx, r.cy - R); c.lineTo(r.cx, r.cy + R); c.stroke();
    // sweep
    const a0 = t * 2.2;
    const sw = c.createConicGradient ? c.createConicGradient(a0, r.cx, r.cy) : null;
    if (sw) {
      sw.addColorStop(0, 'rgba(120,255,140,0.22)'); sw.addColorStop(0.12, 'rgba(120,255,140,0)'); sw.addColorStop(1, 'rgba(120,255,140,0)');
      c.fillStyle = sw; c.fillRect(r.cx - R, r.cy - R, R * 2, R * 2);
    }
    this._q.copy(p.obj.quaternion).invert();
    const v = new THREE.Vector3();
    const plot = (pos, color, size, shape, ring) => {
      v.subVectors(pos, p.pos).applyQuaternion(this._q);
      const len = v.length();
      if (len < 1) return;
      if (p.sys && p.sys.sensors < 0.5 && Math.random() < (0.5 - p.sys.sensors) * 1.6) return; // damaged sensors drop contacts
      const ang = Math.acos(THREE.MathUtils.clamp(-v.z / len, -1, 1));
      const rr = ang / Math.PI * (R - 4), a = Math.atan2(v.y, v.x);
      const x = r.cx + Math.cos(a) * rr, y = r.cy - Math.sin(a) * rr;
      c.fillStyle = color;
      if (shape === 'sq') c.fillRect(x - size, y - size, size * 2, size * 2);
      else if (shape === 'dia') { c.beginPath(); c.moveTo(x, y - size); c.lineTo(x + size, y); c.lineTo(x, y + size); c.lineTo(x - size, y); c.closePath(); c.fill(); }
      else { c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.fill(); }
      if (ring) { c.strokeStyle = color; c.lineWidth = 1; c.beginPath(); c.arc(x, y, size + 4, 0, Math.PI * 2); c.stroke(); }
    };
    const s = Math.max(2, 2.6 * u);
    const bh = g.world.blackHole;
    if (bh && bh.pos.distanceTo(p.pos) < 80000) plot(bh.pos, '#c46bff', s * 1.4, 'circle');
    for (const st of g.world.stations) if (st.pos.distanceTo(p.pos) < 120000) plot(st.pos, '#9dffb0', s, 'sq', st === g.target);
    const nav = g.navs[g.navIndex];
    if (nav) plot(nav.pos, '#7fd8ff', s * 1.3, 'dia');
    for (const sh of g.ships) if (sh.alive && !sh.isPlayer && sh.pos.distanceTo(p.pos) < 25000) plot(sh.pos, sh.team === 'civ' ? '#ffd36b' : sh.team === 'police' ? '#6ab0ff' : sh.team === 'player' ? '#7dffb0' : '#ff5a3a', sh.team === 'civ' ? s * 1.2 : s, 'circle', sh === g.target);
    for (const pod of g.salvage.pods) if (pod.pos.distanceTo(p.pos) < 8000) plot(pod.pos, '#ffc85a', s * 0.9, 'dia', pod === g.target);
    for (const m of g.missiles) if (m.mesh.position.distanceTo(p.pos) < 8000) plot(m.mesh.position, '#ffe066', s * 0.8, 'circle');
    c.restore();
    // Nav / gravity readout under the radar
    const y = r.cy + R + 18 * u;
    if (nav) label(c, `NAV ${nav.name.toUpperCase()}  ${fmtDist(nav.pos.distanceTo(p.pos))}`, r.cx, y, 9.5 * u, 'rgba(127,216,255,0.85)');
    if (p.gAccel > 5) label(c, `GRAVITY ${(p.gAccel / 9.81).toFixed(1)} g`, r.cx, r.cy - R - 6 * u + 0, 9 * u, p.gAccel > 80 ? RED : '#d08bff');
  }

  drawRightCluster(c, t) {
    const g = this.g, p = g.player, L = this.L, { u } = L;
    // Missile lock lamp
    const lk = L.lock;
    const need = lockTimeFor(p);
    const heat = need === 0 ? heatTarget(g, p) : null;
    const locked = need === 0 ? !!heat : p.lockTime >= need, acquiring = need > 0 && p.lockTime > 0 && !locked;
    const on = locked || (acquiring && (t * 6 % 1) < 0.5);
    c.beginPath(); c.roundRect(lk.x + 2, lk.y + 2, lk.w - 4, lk.h - 4, 2);
    if (on) { c.shadowColor = RED; c.shadowBlur = 12; c.fillStyle = locked ? '#8a120a' : '#6a3a06'; } else c.fillStyle = '#160c0a';
    c.fill(); c.shadowBlur = 0;
    label(c, need === 0 ? 'HEAT' : 'LOCK', lk.x + lk.w / 2, lk.y + lk.h / 2 + 1, 12 * u, on ? '#ffd0c0' : 'rgba(255,120,100,0.25)');

    // Ordnance screen
    const b = L.msl;
    const lines = [
      [MISSILES[p.missileType].name.slice(0, 4).toUpperCase(), String(p.ammo[p.missileType]), p.ammo[p.missileType] ? phos(0.9) : RED],
      ['DCY', String(p.decoys), p.decoys ? phos(0.9) : RED],
      ['GUN', `${Math.round(p.energy)}%`, p.energy > 25 ? phos(0.9) : AMBER],
    ];
    const lh = Math.min(20 * u, (b.h - 8 * u) / lines.length);
    const fs = Math.min(12 * u, b.w / 5.2);
    lines.forEach(([k, v, col], i) => {
      const y = b.y + 6 * u + lh * (i + 0.5);
      label(c, k, b.x + 5 * u, y, fs * 0.85, phos(0.5), 'left');
      label(c, v, b.x + b.w - 5 * u, y, fs, col, 'right');
    });

    // Afterburner fuel gauge
    const f = L.fuel, segs = 14, sh = (f.h - 6) / segs;
    const lit = Math.ceil(p.abFuel / 100 * segs - 0.01);
    for (let i = 0; i < segs; i++) {
      const k = i / (segs - 1);
      const col = k < 0.2 ? '#ff3a20' : k < 0.45 ? '#ffc02a' : '#4cff6a';
      c.fillStyle = i < lit ? col : 'rgba(255,255,255,0.05)';
      c.fillRect(f.x + 3, f.y + f.h - 3 - (i + 1) * sh + 1, f.w - 6, sh - 2);
    }
    c.save();
    c.translate(f.x - 6 * u, f.y + f.h / 2);
    c.rotate(-Math.PI / 2);
    label(c, 'BURN', 0, 0, 9 * u, p.afterburner ? AMBER : 'rgba(220,255,200,0.6)');
    c.restore();
  }

  screenBase(c, s) {
    c.save();
    c.beginPath(); c.roundRect(s.x, s.y, s.w, s.h, 7 * this.L.u); c.clip();
  }
  screenEnd(c, s) {
    c.fillStyle = 'rgba(0,0,0,0.13)';
    for (let y = s.y; y < s.y + s.h; y += 3) c.fillRect(s.x, y, s.w, 1);
    const v = c.createRadialGradient(s.x + s.w / 2, s.y + s.h / 2, Math.min(s.w, s.h) * 0.3, s.x + s.w / 2, s.y + s.h / 2, Math.max(s.w, s.h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = v; c.fillRect(s.x, s.y, s.w, s.h);
    c.restore();
  }

  drawWeapons(c, s, p) {
    const g = this.g, { u } = this.L;
    this.screenBase(c, s);
    const fs = Math.max(9, 10.5 * u);
    label(c, 'WEAPON SYSTEMS', s.x + s.w / 2, s.y + 11 * u, fs, phos(0.95));
    c.fillStyle = phos(0.5); c.fillRect(s.x + 10 * u, s.y + 19 * u, s.w - 20 * u, 1);
    label(c, `Gun: ${p.gunName}`, s.x + 10 * u, s.y + 30 * u, fs * 0.92, phos(0.85), 'left');
    const step = g.storyStep();
    const job = g.missions[0];
    if (step) label(c, `Story: ${step.text}`, s.x + 10 * u, s.y + s.h - 24 * u, fs * 0.85, '#ffd36b', 'left');
    else if (job) label(c, `Job: ${missionSummary(g, job)}`, s.x + 10 * u, s.y + s.h - 24 * u, fs * 0.85, '#ffd36b', 'left');
    label(c, `Missile: ${MISSILES[p.missileType].name} x${p.ammo[p.missileType]}  (G)`, s.x + 10 * u, s.y + 43 * u, fs * 0.92, p.ammo[p.missileType] ? phos(0.85) : RED, 'left');
    label(c, Object.entries(p.ammo).map(([k, n]) => `${MISSILES[k].name[0]}:${n}`).join(' '), s.x + s.w - 10 * u, s.y + 43 * u, fs * 0.85, phos(0.55), 'right');
    // Ship systems, coloured by health
    const names = { guns: 'GUN', engine: 'ENG', shields: 'SHG', sensors: 'SNS' };
    const keys = Object.keys(names);
    keys.forEach((k, i) => {
      const v = p.sys ? p.sys[k] : 1;
      const col = v > 0.75 ? phos(0.85) : v > 0.4 ? AMBER : RED;
      const x = s.x + 10 * u + i * (s.w - 20 * u) / keys.length;
      const blink = v < 0.4 && (performance.now() / 300 | 0) % 2;
      if (!blink) label(c, `${names[k]} ${Math.round(v * 100)}`, x, s.y + 56 * u, fs * 0.8, col, 'left');
    });
    const w = g.ships.find(x => x.wing && x.alive);
    if (w) label(c, `${w.name} ${Math.round(w.armor / w.armorMax * 100)}%`, s.x + s.w - 10 * u, s.y + s.h - 24 * u - (g.storyStep() || g.missions[0] ? 13 * u : 0), fs * 0.8, '#7dffb0', 'right');
    label(c, `CR ${g.credits.toLocaleString()}`, s.x + 10 * u, s.y + s.h - 10 * u, fs * 0.92, '#ffe066', 'left');
    label(c, `HOLD ${g.cargoUsed()}/${g.cargoCap}`, s.x + s.w - 10 * u, s.y + s.h - 10 * u, fs * 0.92, phos(0.85), 'right');
    this.screenEnd(c, s);
  }

  // ------------------------------------------------------------------ comms
  // Spoken messages ("Speaker: text") take over the right screen with an animated portrait.
  comm(text, color) {
    const m = /^([^:]{2,40}):\s*(.+)$/.exec(text);
    if (!m) return;
    const who = m[1].trim();
    let kind = null;
    if (/Control$/.test(who)) kind = 'station';
    else if (/^(Ashfang|Marauder|Krell|Gallows)/i.test(who)) kind = 'pirate';
    else if (/^(Patrol|Authority|AUTHORITY|Commodore|Hale)/.test(who)) kind = 'police';
    else if (/^Wing/.test(who)) kind = 'wing';
    else if (/^Hauler/.test(who)) kind = 'civ';
    else if (/^(Varro|Dr\.)/.test(who)) kind = 'scientist';
    if (!kind) return;
    let seed = 0;
    for (const ch of who) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    this.commMsg = { who, text: m[2], kind, seed, t0: performance.now() / 1000, dur: Math.min(7, 2.5 + m[2].length * 0.045) };
  }
  commOn() { return this.commMsg && performance.now() / 1000 - this.commMsg.t0 < this.commMsg.dur; }

  drawComm(c, s, t) {
    const M = this.commMsg, { u } = this.L;
    const age = t - M.t0;
    const rnd = k => { const x = Math.sin(M.seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    const tint = { pirate: [255, 110, 90], police: [130, 190, 255], station: [140, 255, 170], wing: [140, 255, 170], civ: [255, 220, 130], scientist: [200, 230, 255] }[M.kind];
    const col = a => `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`;
    this.screenBase(c, s);
    c.fillStyle = `rgba(${tint[0] * 0.05 | 0},${tint[1] * 0.06 | 0},${tint[2] * 0.06 | 0},1)`;
    c.fillRect(s.x, s.y, s.w, s.h);
    // Signal acquisition: static that clears in the first half-second
    const noise = Math.max(0, 1 - age / 0.5) + (M.kind === 'pirate' ? 0.12 : 0.04);
    const fs = Math.max(9, 10.5 * u);
    label(c, 'INCOMING TRANSMISSION', s.x + s.w / 2, s.y + 11 * u, fs * 0.9, col(0.9));
    // Portrait
    const cx = s.x + s.w * 0.5, cy = s.y + s.h * 0.5, H = s.h * 0.62;
    const talk = age < M.dur - 0.6 ? Math.abs(Math.sin(age * 13 + Math.sin(age * 5) * 2)) : 0;
    const blink = (age * 0.7 + rnd(1)) % 3 < 0.12;
    const headW = H * (0.34 + rnd(2) * 0.08), headH = H * (0.44 + rnd(3) * 0.06);
    c.save();
    c.translate(cx + Math.sin(age * 0.9) * 2 * u, cy + H * 0.06);
    // shoulders / suit
    c.fillStyle = col(0.25);
    c.beginPath(); c.ellipse(0, H * 0.55, H * 0.62, H * 0.3, 0, Math.PI, 0); c.fill();
    c.strokeStyle = col(0.6); c.lineWidth = 1.5; c.stroke();
    if (M.kind === 'police' || M.kind === 'wing') { c.fillStyle = col(0.5); c.fillRect(-H * 0.07, H * 0.3, H * 0.14, H * 0.06); }
    // neck
    c.fillStyle = col(0.3); c.fillRect(-headW * 0.35, H * 0.08, headW * 0.7, H * 0.2);
    // hair (scientist / station) or helmet (pilots)
    if (M.kind === 'scientist') {
      c.fillStyle = col(0.45);
      c.beginPath(); c.ellipse(0, -headH * 0.1, headW * 1.15, headH * 1.1, 0, 0, Math.PI * 2); c.fill();
    }
    // head
    c.fillStyle = col(0.38);
    c.beginPath(); c.ellipse(0, -H * 0.12, headW, headH, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = col(0.85); c.stroke();
    if (M.kind === 'police' || M.kind === 'wing' || M.kind === 'pirate') {
      // flight helmet shell
      c.strokeStyle = col(0.9); c.lineWidth = 2.5 * u;
      c.beginPath(); c.ellipse(0, -H * 0.12, headW * 1.18, headH * 1.12, 0, Math.PI * 1.02, Math.PI * 1.98); c.stroke();
      c.lineWidth = 1.5;
    }
    if (M.kind === 'station') {
      // headset
      c.strokeStyle = col(0.9); c.lineWidth = 2;
      c.beginPath(); c.arc(0, -H * 0.12, headW * 1.08, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      c.beginPath(); c.moveTo(-headW * 1.02, -H * 0.1); c.quadraticCurveTo(-headW * 0.9, H * 0.12, -headW * 0.25, H * 0.1); c.stroke();
    }
    // eyes
    const ey = -H * 0.17, ex = headW * 0.38;
    c.fillStyle = col(0.95);
    for (const sx of [-1, 1]) {
      if (blink) c.fillRect(sx * ex - headW * 0.14, ey, headW * 0.28, 1.5);
      else { c.beginPath(); c.ellipse(sx * ex, ey, headW * 0.13, headH * 0.06, 0, 0, Math.PI * 2); c.fill(); }
    }
    if (M.kind === 'pirate') {
      // scar and eyepatch on some
      c.strokeStyle = col(0.9); c.lineWidth = 2;
      c.beginPath(); c.moveTo(ex * 0.4, ey - headH * 0.3); c.lineTo(ex * 1.5, ey + headH * 0.4); c.stroke();
      if (rnd(4) > 0.5) { c.fillStyle = col(0.9); c.beginPath(); c.ellipse(-ex, ey, headW * 0.17, headH * 0.09, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.moveTo(-headW, ey - headH * 0.25); c.lineTo(headW * 0.6, ey - headH * 0.35); c.stroke(); }
    }
    // brows / nose
    c.strokeStyle = col(0.7); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-ex - headW * 0.15, ey - headH * 0.14); c.lineTo(-ex + headW * 0.12, ey - headH * (M.kind === 'pirate' ? 0.08 : 0.16)); c.stroke();
    c.beginPath(); c.moveTo(ex + headW * 0.15, ey - headH * 0.14); c.lineTo(ex - headW * 0.12, ey - headH * (M.kind === 'pirate' ? 0.08 : 0.16)); c.stroke();
    c.beginPath(); c.moveTo(0, ey + headH * 0.05); c.lineTo(-headW * 0.08, ey + headH * 0.32); c.lineTo(headW * 0.04, ey + headH * 0.34); c.stroke();
    // mouth, animated while speaking
    const my = -H * 0.12 + headH * 0.48, mw = headW * 0.42;
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.beginPath(); c.ellipse(0, my, mw * (0.8 + talk * 0.2), 1.5 + talk * headH * 0.13, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = col(0.9); c.stroke();
    c.restore();
    // static / interference
    c.fillStyle = col(0.08 + noise * 0.25);
    for (let i = 0; i < 40 * noise + 6; i++) c.fillRect(s.x + Math.random() * s.w, s.y + Math.random() * s.h, 1 + Math.random() * 30 * noise, 1);
    if (noise > 0.3) { c.fillStyle = `rgba(0,0,0,${noise * 0.5})`; c.fillRect(s.x, s.y + ((age * 300) % s.h), s.w, 6 * u); }
    // caption
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(s.x, s.y + s.h - 30 * u, s.w, 30 * u);
    label(c, M.who.toUpperCase(), s.x + 8 * u, s.y + s.h - 21 * u, fs * 0.85, col(1), 'left');
    const words = M.text.length > 52 ? M.text.slice(0, 50) + '…' : M.text;
    label(c, words, s.x + 8 * u, s.y + s.h - 9 * u, fs * 0.75, col(0.75), 'left');
    this.screenEnd(c, s);
  }

  drawTargeting(c, s, t) {
    const g = this.g, p = g.player, tg = g.target, { u } = this.L;
    this.screenBase(c, s);
    const fs = Math.max(9, 10.5 * u);
    label(c, 'AUTO TARGETING', s.x + s.w / 2, s.y + 11 * u, fs, phos(0.95));
    c.fillStyle = phos(0.5); c.fillRect(s.x + 10 * u, s.y + 19 * u, s.w - 20 * u, 1);
    if (!tg) {
      label(c, 'NO TARGET', s.x + s.w / 2, s.y + s.h / 2, fs * 1.2, phos(0.8));
      label(c, 'T cycle  ·  R nearest hostile', s.x + s.w / 2, s.y + s.h / 2 + 16 * u, fs * 0.85, phos(0.45));
    } else {
      const hostile = tg.team === 'pirate';
      if (tg.cls) label(c, tg.cls, s.x + s.w - 10 * u, s.y + 30 * u, fs * 0.8, hostile ? '#ff7a6a' : '#ffd36b', 'right');
      label(c, `Target: ${tg.name}`, s.x + 10 * u, s.y + 30 * u, fs * 0.92, hostile ? '#ff7a6a' : phos(0.9), 'left');
      label(c, `Range: ${fmtDist(tg.pos.distanceTo(p.pos))}`, s.x + 10 * u, s.y + 43 * u, fs * 0.92, hostile ? '#ff7a6a' : phos(0.9), 'left');
      if (tg.team) {
        label(c, `SPD ${Math.round(tg.speed)}`, s.x + s.w - 10 * u, s.y + s.h - 10 * u, fs * 0.9, phos(0.8), 'right');
        // Curved gauges: shields on the left, armour on the right
        const cx = s.x + s.w / 2, cy = s.y + s.h * 0.62, R = Math.min(s.w * 0.46, s.h * 0.48);
        const arc = (from, to, f, flip) => {
          const n = 10;
          for (let i = 0; i < n; i++) {
            const k = flip ? n - 1 - i : i;
            const a0 = from + (to - from) * (i / n), a1 = from + (to - from) * ((i + 0.8) / n);
            c.beginPath(); c.arc(cx, cy, R, a0, a1);
            c.strokeStyle = k < Math.ceil(f * n - 0.01) ? (f > 0.3 ? phos(0.9) : RED) : 'rgba(120,255,140,0.12)';
            c.lineWidth = 5 * u; c.stroke();
          }
        };
        const sf = Math.max(0, (tg.shieldF + tg.shieldR) / (2 * tg.shieldMax));
        const af = Math.max(0, tg.armor / tg.armorMax);
        arc(Math.PI * 0.78, Math.PI * 1.22, sf, true);
        arc(-Math.PI * 0.22, Math.PI * 0.22, af, false);
        label(c, 'SHD', cx - R + 12 * u, cy + R * 0.62, fs * 0.8, phos(0.6));
        label(c, 'ARM', cx + R - 12 * u, cy + R * 0.62, fs * 0.8, phos(0.6));
      } else if (tg.isPod) {
        label(c, `Contents: ${tg.qty} t ${tg.cm.name}`, s.x + s.w / 2, s.y + s.h - 26 * u, fs * 0.9, '#ffd36b');
        label(c, 'FLY THROUGH TO SCOOP · B MATCHES SPEED', s.x + s.w / 2, s.y + s.h - 10 * u, fs * 0.8, phos(0.7));
      } else if (tg.isStation) {
        label(c, tg.pos.distanceTo(p.pos) < 2200 ? 'D: REQUEST DOCKING' : 'DOCKING RANGE 2.2 km', s.x + s.w / 2, s.y + s.h - 10 * u, fs * 0.9, phos(0.85));
      }
    }
    this.screenEnd(c, s);
  }

  // ----------------------------------------------- WebGL wireframe screens
  renderScreens(renderer) {
    const g = this.g, L = this.L, H = innerHeight, t = performance.now() / 1000;
    const cam = this.cam;
    const job = (s, model, setup) => {
      renderer.setScissor(s.x, H - s.y - s.h, s.w, s.h);
      renderer.setViewport(s.x, H - s.y - s.h, s.w, s.h);
      renderer.setClearColor(0x031408, 1);
      for (const m of Object.values(this.models)) m.visible = m === model;
      if (!model) { renderer.clear(); return; }
      setup(model);
      cam.aspect = s.w / s.h;
      const dist = model.userData.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.08;
      cam.near = dist * 0.05; cam.far = dist * 4;
      cam.updateProjectionMatrix();
      return dist;
    };
    renderer.setScissorTest(true);

    // Own ship: top-down schematic, gently rolling
    const pm = g.hull === 'bastion' ? this.models.bastion : this.models.player;
    let d = job(L.scrL, pm, m => m.rotation.set(0.55, 0, Math.sin(t * 0.6) * 0.25));
    cam.position.set(0, d * 0.9, d * 0.35);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    renderer.render(this.scene, cam);

    // Target, oriented as you see it
    const tg = g.target;
    const tm = tg && !this.commOn() ? (tg.isStation ? this.models.station : this.models[tg.kind] || null) : null;
    d = job(L.scrR, tm, m => {
      const src = tg.isStation ? tg.group : tg.obj;
      m.quaternion.copy(g.camera.quaternion).invert().multiply(src.quaternion);
    });
    if (tm) {
      cam.position.set(0, 0, d);
      cam.up.set(0, 1, 0);
      cam.lookAt(0, 0, 0);
      renderer.render(this.scene, cam);
    }

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.setClearColor(0x000000, 1);
  }
}
