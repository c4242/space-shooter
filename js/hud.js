import * as THREE from 'three';
import { LASER_SPEED, LOCK_TIME } from './ships.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const _pv = new THREE.Vector3(), _tv = new THREE.Vector3(), _lead = new THREE.Vector3();

const C = {
  hud: '125,255,176',
  red: '#ff5a4a',
  amber: '#ffb84d',
  green: '#6dff9a',
  cyan: '#7fd8ff',
  yellow: '#ffe066',
};

export function fmtDist(d) {
  if (d < 1000) return `${Math.round(d)} m`;
  return `${(d / 1000).toFixed(d < 10000 ? 2 : 1)} km`;
}

function shieldColor(f) { return f > 0.6 ? '#6dff9a' : f > 0.25 ? '#ffb84d' : '#ff5a4a'; }

export class Hud {
  constructor(game) {
    this.g = game;
    this.canvas = document.getElementById('hud');
    this.ctx = this.canvas.getContext('2d');
    this.vdu = document.getElementById('vduCanvas');
    this.radar = document.getElementById('radar');
    this.instr = document.getElementById('instr');
    this.lights = {};
    for (const id of ['shld', 'armr', 'msl', 'lock', 'grav', 'fuel', 'auto', 'dock']) this.lights[id] = document.getElementById('lt-' + id);
    this.messages = [];
    this.flash = 0;
    this.flashRGB = '255,40,30';
    this.viewH = innerHeight;
    this.resize();
  }

  fit(c) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, h, ctx];
  }

  resize() { this.W = innerWidth; this.H = innerHeight; this.fit(this.canvas); }

  msg(text, color = '#9fe8ff') {
    this.messages.push({ text, color, t: performance.now() / 1000 });
    if (this.messages.length > 5) this.messages.shift();
  }

  project(p) {
    const cam = this.g.camera;
    _v.copy(p).applyMatrix4(cam.matrixWorldInverse);
    const behind = _v.z > 0;
    const camX = _v.x, camY = _v.y, camZ = _v.z;
    _w.copy(p).project(cam);
    const x = (_w.x + 1) / 2 * this.W, y = (1 - _w.y) / 2 * this.H;
    const on = !behind && x > 8 && x < this.W - 8 && y > 8 && y < this.viewH - 8;
    return { x, y, behind, camX, camY, camZ, on };
  }

  edgeArrow(ctx, pr, color, label) {
    const cx = this.W / 2, cy = this.viewH / 2;
    let dx = pr.camX, dy = -pr.camY;
    if (!pr.behind) { dx = pr.x - cx; dy = pr.y - cy; }
    const a = Math.atan2(dy, dx);
    const rx = this.W * 0.42, ry = this.viewH * 0.4;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-7, -9); ctx.lineTo(-3, 0); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (label) {
      ctx.fillStyle = color; ctx.textAlign = 'center';
      ctx.fillText(label, x - Math.cos(a) * 30, y - Math.sin(a) * 22 + 4);
    }
  }

  draw(dt) {
    const g = this.g, ctx = this.ctx, W = this.W, H = this.H;
    this.viewH = g.dashVisible ? H - g.dashH : H;
    this.focalPx = g.camera.projectionMatrix.elements[5] * H / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '13px "Share Tech Mono", monospace';
    ctx.textBaseline = 'alphabetic';
    const p = g.player;
    const flying = ['flight', 'map', 'trade', 'paused', 'docking'].includes(g.state);

    if (g.state === 'autopilot') this.drawAutopilot(ctx);
    if (p && p.alive && flying) {
      if (g.view === 'cockpit') this.drawCanopy(ctx);
      this.drawContacts(ctx);
      this.drawNav(ctx);
      this.drawTarget(ctx);
      this.drawCrosshair(ctx);
      if (g.mouseFlight && g.mouse.inside && g.state === 'flight') this.drawMouse(ctx);
      if (p.gAccel > 15) this.drawGravity(ctx, p.gAccel);
    }
    this.drawMessages(ctx);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashRGB},${Math.min(0.45, this.flash)})`;
      ctx.fillRect(0, 0, W, H);
      this.flash -= dt * 1.8;
    }
    if (g.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, g.fade)})`; ctx.fillRect(0, 0, W, H); }

    if (g.dashVisible && p) {
      this.drawVDU();
      this.drawRadar();
      this.drawInstruments();
      this.updateLights();
    }
  }

  drawCanopy(ctx) {
    const W = this.W, H = this.viewH;
    ctx.save();
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#20262e'); grd.addColorStop(1, '#0d1014');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H * 0.07);
    ctx.quadraticCurveTo(W / 2, -H * 0.03, 0, H * 0.07);
    ctx.closePath(); ctx.fill();
    for (const side of [0, 1]) {
      ctx.beginPath();
      const x0 = side ? W : 0, s = side ? -1 : 1;
      ctx.moveTo(x0, H * 0.05);
      ctx.lineTo(x0 + s * W * 0.085, H * 0.045);
      ctx.lineTo(x0 + s * W * 0.03, H + 4);
      ctx.lineTo(x0, H + 4);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(140,160,185,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0 + s * W * 0.085, H * 0.045); ctx.lineTo(x0 + s * W * 0.03, H + 4); ctx.stroke();
      ctx.fillStyle = '#3a434e';
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        ctx.beginPath();
        ctx.arc(x0 + s * (W * 0.085 + (W * 0.03 - W * 0.085) * t) - s * 8, H * 0.045 + (H - H * 0.045) * t, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = grd;
    }
    ctx.restore();
  }

  drawCrosshair(ctx) {
    const cx = this.W / 2, cy = this.viewH / 2;
    ctx.strokeStyle = `rgba(${C.hud},0.9)`; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + dx * 7, cy + dy * 7); ctx.lineTo(cx + dx * 17, cy + dy * 17);
    }
    ctx.stroke();
    ctx.fillStyle = `rgba(${C.hud},0.9)`;
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }

  drawMouse(ctx) {
    const g = this.g, cx = this.W / 2, cy = this.viewH / 2;
    const R = Math.min(this.W, this.viewH) * 0.38;
    ctx.strokeStyle = `rgba(${C.hud},0.12)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.06, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(${C.hud},0.25)`;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(g.mouse.x, g.mouse.y); ctx.stroke();
    ctx.strokeStyle = `rgba(${C.hud},0.8)`;
    ctx.beginPath(); ctx.arc(g.mouse.x, g.mouse.y, 5, 0, Math.PI * 2); ctx.stroke();
  }

  drawContacts(ctx) {
    const g = this.g, p = g.player;
    for (const s of g.ships) {
      if (!s.alive || s.isPlayer || s === g.target) continue;
      if (s.pos.distanceTo(p.pos) > 15000) continue;
      const pr = this.project(s.pos);
      if (!pr.on) continue;
      ctx.strokeStyle = C.red; ctx.lineWidth = 1.3;
      const k = 7;
      ctx.beginPath();
      ctx.moveTo(pr.x - k, pr.y - k + 3); ctx.lineTo(pr.x - k, pr.y - k); ctx.lineTo(pr.x - k + 3, pr.y - k);
      ctx.moveTo(pr.x + k, pr.y + k - 3); ctx.lineTo(pr.x + k, pr.y + k); ctx.lineTo(pr.x + k - 3, pr.y + k);
      ctx.stroke();
    }
    for (const m of g.missiles) {
      if (m.target !== p) continue;
      const pr = this.project(m.mesh.position);
      if (pr.on) {
        ctx.strokeStyle = C.yellow; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = C.yellow; ctx.textAlign = 'center'; ctx.fillText('MSL', pr.x, pr.y - 12);
      }
    }
    for (const st of g.world.stations) {
      if (st === g.target) continue;
      const pr = this.project(st.pos);
      if (!pr.on) continue;
      ctx.strokeStyle = 'rgba(109,255,154,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(pr.x - 5, pr.y - 5, 10, 10);
    }
  }

  drawNav(ctx) {
    const g = this.g, nav = g.navs[g.navIndex];
    if (!nav) return;
    const d = nav.pos.distanceTo(g.player.pos);
    const pr = this.project(nav.pos);
    if (!pr.on) { this.edgeArrow(ctx, pr, C.cyan, `NAV ${fmtDist(d)}`); return; }
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pr.x, pr.y - 10); ctx.lineTo(pr.x + 10, pr.y); ctx.lineTo(pr.x, pr.y + 10); ctx.lineTo(pr.x - 10, pr.y); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = C.cyan; ctx.textAlign = 'left';
    ctx.fillText(nav.name, pr.x + 14, pr.y - 2);
    ctx.fillText(fmtDist(d), pr.x + 14, pr.y + 12);
  }

  drawTarget(ctx) {
    const g = this.g, t = g.target, p = g.player;
    if (!t) return;
    const hostile = t.team === 'pirate';
    const col = hostile ? C.red : t.isStation ? C.green : C.yellow;
    const dist = t.pos.distanceTo(p.pos);
    const pr = this.project(t.pos);
    if (!pr.on) { this.edgeArrow(ctx, pr, col, fmtDist(dist)); return; }

    const px = Math.max(12, (t.radius || 20) / Math.max(1, -pr.camZ) * this.focalPx);
    const s = px * 1.15 + 6, k = Math.min(12, s * 0.5);
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = pr.x + sx * s, y = pr.y + sy * s;
      ctx.moveTo(x, y - sy * k); ctx.lineTo(x, y); ctx.lineTo(x - sx * k, y);
    }
    ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = 'center';
    ctx.fillText(t.name, pr.x, pr.y - s - 8);
    ctx.fillText(fmtDist(dist), pr.x, pr.y + s + 16);

    if (hostile && t.alive) {
      // ITTS: where to shoot so bolts meet the target.
      p.totalVel(_pv); t.totalVel(_tv);
      _lead.copy(t.pos);
      for (let i = 0; i < 2; i++) {
        const tt = _lead.distanceTo(p.pos) / LASER_SPEED;
        _lead.copy(t.pos).addScaledVector(_tv.clone().sub(_pv), tt);
      }
      const lp = this.project(_lead);
      if (!lp.behind) {
        const onTarget = Math.hypot(lp.x - this.W / 2, lp.y - this.viewH / 2) < 12;
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(lp.x, lp.y, 7, 0, Math.PI * 2);
        if (onTarget) { ctx.fillStyle = col; ctx.fill(); } else ctx.stroke();
        ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(lp.x, lp.y); ctx.stroke(); ctx.setLineDash([]);
      }
      // Missile lock
      if (p.lockTime > 0) {
        const f = Math.min(1, p.lockTime / LOCK_TIME);
        const locked = p.lockTime >= LOCK_TIME;
        const r = s + 10;
        ctx.strokeStyle = locked ? '#ff2d2d' : C.amber; ctx.lineWidth = 2.5;
        if (locked) {
          ctx.beginPath();
          ctx.moveTo(pr.x, pr.y - r); ctx.lineTo(pr.x + r, pr.y); ctx.lineTo(pr.x, pr.y + r); ctx.lineTo(pr.x - r, pr.y); ctx.closePath();
          ctx.stroke();
          ctx.fillStyle = '#ff2d2d'; ctx.fillText('LOCKED', pr.x, pr.y + s + 30);
        } else {
          ctx.beginPath(); ctx.arc(pr.x, pr.y, r, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
        }
      }
    }
  }

  drawGravity(ctx, a) {
    const W = this.W, H = this.viewH;
    const lvl = Math.min(1, (a - 15) / 250);
    const grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
    grd.addColorStop(0, 'rgba(90,0,60,0)');
    grd.addColorStop(1, `rgba(130,0,70,${0.12 + 0.55 * lvl})`);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    if (a > 80 && (performance.now() / 300 | 0) % 2 === 0) {
      ctx.font = 'bold 22px "Orbitron", sans-serif';
      ctx.fillStyle = '#ff6a8a'; ctx.textAlign = 'center';
      ctx.fillText('GRAVITY WELL — BURN AWAY FROM THE RIFT', W / 2, H * 0.3);
      ctx.font = '13px "Share Tech Mono", monospace';
    }
  }

  drawMessages(ctx) {
    const now = performance.now() / 1000;
    this.messages = this.messages.filter(m => now - m.t < 7);
    const y0 = (this.g.dashVisible ? this.viewH : this.H) * 0.1 + 6;
    ctx.textAlign = 'center';
    this.messages.forEach((m, i) => {
      const age = now - m.t;
      ctx.globalAlpha = Math.min(1, (7 - age) / 1.5);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const w = ctx.measureText(m.text).width;
      ctx.fillRect(this.W / 2 - w / 2 - 8, y0 + i * 20 - 13, w + 16, 18);
      ctx.fillStyle = m.color;
      ctx.fillText(m.text, this.W / 2, y0 + i * 20);
    });
    ctx.globalAlpha = 1;
  }

  drawAutopilot(ctx) {
    const W = this.W, H = this.H, bar = H * 0.1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
    ctx.fillStyle = C.cyan; ctx.textAlign = 'left';
    ctx.font = '16px "Orbitron", sans-serif';
    const ap = this.g.ap;
    if (ap) ctx.fillText(`AUTOPILOT  ▸  ${ap.nav.name.toUpperCase()}`, 24, H - bar / 2 + 6);
    ctx.font = '13px "Share Tech Mono", monospace';
  }

  // ----- Left MFD: target VDU (3D view is rendered underneath by main.js) -----
  drawVDU() {
    const [w, h, c] = this.fit(this.vdu);
    const g = this.g, t = g.target, p = g.player;
    c.clearRect(0, 0, w, h);
    const fs = Math.max(10, Math.min(14, h * 0.075));
    c.font = `${fs}px "Share Tech Mono", monospace`;
    if (!t) {
      c.fillStyle = '#03140c'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(125,255,176,0.75)'; c.textAlign = 'center';
      c.fillText('NO TARGET', w / 2, h / 2 - 6);
      c.fillStyle = 'rgba(125,255,176,0.4)';
      c.fillText('T cycle · R nearest', w / 2, h / 2 + fs + 2);
    } else {
      const col = t.team === 'pirate' ? '#ff7a6a' : '#8dffb0';
      c.textAlign = 'left'; c.fillStyle = col;
      c.fillText(t.name.toUpperCase(), 8, fs + 4);
      c.fillStyle = 'rgba(160,255,200,0.7)';
      c.fillText(t.team === 'pirate' ? 'ASHFANG RAIDER · HOSTILE' : t.isStation ? 'STATION · FRIENDLY' : '', 8, fs * 2 + 6);
      c.fillText(`RNG ${fmtDist(t.pos.distanceTo(p.pos))}`, 8, h - 8);
      if (t.team) {
        c.textAlign = 'right';
        c.fillText(`SPD ${Math.round(t.speed)}`, w - 8, h - 8);
        const bw = w * 0.36, bx = w - bw - 8;
        const bars = [['SHF', t.shieldF / t.shieldMax], ['SHR', t.shieldR / t.shieldMax], ['ARM', t.armor / t.armorMax]];
        bars.forEach(([label, f], i) => {
          const y = fs * 3 + 8 + i * (fs + 4);
          c.fillStyle = 'rgba(160,255,200,0.6)'; c.textAlign = 'right';
          c.fillText(label, bx - 4, y + fs * 0.75);
          c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(bx, y, bw, fs * 0.8);
          c.fillStyle = shieldColor(Math.max(0, f)); c.fillRect(bx, y, bw * Math.max(0, f), fs * 0.8);
        });
      } else if (t.isStation) {
        c.textAlign = 'right';
        c.fillText(t.pos.distanceTo(p.pos) < 2200 ? 'D: DOCK' : 'DOCK < 2.2 km', w - 8, h - 8);
      }
    }
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
    c.strokeStyle = 'rgba(125,255,176,0.35)'; c.lineWidth = 1;
    c.strokeRect(4.5, 4.5, w - 9, h - 9);
  }

  // ----- Right MFD: sphere radar. Centre = dead ahead, rim = directly behind. -----
  drawRadar() {
    const [w, h, c] = this.fit(this.radar);
    const g = this.g, p = g.player;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 10;
    const bg = c.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2);
    bg.addColorStop(0, '#062016'); bg.addColorStop(1, '#020905');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(125,255,176,0.45)'; c.lineWidth = 1.2;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(125,255,176,0.2)';
    c.setLineDash([3, 4]);
    c.beginPath(); c.arc(cx, cy, R * 0.5, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();

    _q.copy(p.obj.quaternion).invert();
    const plot = (pos, color, size, shape, ring) => {
      _v.subVectors(pos, p.pos).applyQuaternion(_q);
      const len = _v.length();
      if (len < 1) return;
      const ang = Math.acos(THREE.MathUtils.clamp(-_v.z / len, -1, 1));
      const r = ang / Math.PI * R, a = Math.atan2(_v.y, _v.x);
      const x = cx + Math.cos(a) * r, y = cy - Math.sin(a) * r;
      c.fillStyle = color;
      if (shape === 'sq') c.fillRect(x - size, y - size, size * 2, size * 2);
      else if (shape === 'dia') { c.beginPath(); c.moveTo(x, y - size); c.lineTo(x + size, y); c.lineTo(x, y + size); c.lineTo(x - size, y); c.closePath(); c.fill(); }
      else { c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.fill(); }
      if (ring) { c.strokeStyle = color; c.lineWidth = 1; c.beginPath(); c.arc(x, y, size + 4, 0, Math.PI * 2); c.stroke(); }
    };
    const bh = g.world.blackHole;
    if (bh.pos.distanceTo(p.pos) < 80000) plot(bh.pos, '#c46bff', 4, 'circle');
    for (const st of g.world.stations) if (st.pos.distanceTo(p.pos) < 120000) plot(st.pos, '#6dff9a', 3, 'sq', st === g.target);
    const nav = g.navs[g.navIndex];
    if (nav) plot(nav.pos, '#7fd8ff', 4, 'dia');
    for (const s of g.ships) if (s.alive && !s.isPlayer && s.pos.distanceTo(p.pos) < 25000) plot(s.pos, '#ff5a4a', 2.6, 'circle', s === g.target);
    for (const m of g.missiles) if (m.mesh.position.distanceTo(p.pos) < 8000) plot(m.mesh.position, '#ffe066', 2, 'circle');
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  }

  // ----- Centre console instruments -----
  drawInstruments() {
    const [w, h, c] = this.fit(this.instr);
    const g = this.g, p = g.player;
    c.clearRect(0, 0, w, h);
    const fs = Math.max(10, Math.min(15, h * 0.11));
    const green = 'rgba(125,255,176,0.95)', dim = 'rgba(125,255,176,0.45)';
    c.font = `${fs}px "Share Tech Mono", monospace`;
    c.textBaseline = 'middle';
    const pad = 10;
    const colW = (w - pad * 2) / 3;

    // Column 1 — speed & throttle
    let x = pad, y = pad + fs * 0.6;
    c.textAlign = 'left';
    c.fillStyle = dim; c.fillText('SET', x, y);
    c.fillStyle = green; c.fillText(String(Math.round(p.setSpeed)).padStart(4, ' '), x + fs * 2.4, y);
    y += fs * 1.5;
    c.fillStyle = dim; c.fillText('SPD', x, y);
    c.font = `${Math.round(fs * 1.7)}px "Share Tech Mono", monospace`;
    c.fillStyle = p.afterburner ? '#ffb84d' : green;
    c.fillText(String(Math.round(p.speed)).padStart(4, ' '), x + fs * 2.2, y + fs * 0.25);
    c.font = `${fs}px "Share Tech Mono", monospace`;
    y += fs * 1.9;
    c.fillStyle = p.afterburner ? '#ffb84d' : dim;
    c.fillText(p.afterburner ? 'AFTERBURNER' : 'm/s', x, y);
    const tbx = x + colW - 22, tby = pad, tbh = h - pad * 2;
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(tbx, tby, 10, tbh);
    const sf = Math.min(1, p.speed / p.abSpeed);
    c.fillStyle = p.afterburner ? '#ffb84d' : 'rgba(125,255,176,0.8)';
    c.fillRect(tbx, tby + tbh * (1 - sf), 10, tbh * sf);
    const setY = tby + tbh * (1 - p.setSpeed / p.abSpeed);
    c.fillStyle = '#fff'; c.fillRect(tbx - 4, setY - 1, 18, 2);
    const maxY = tby + tbh * (1 - p.maxSpeed / p.abSpeed);
    c.fillStyle = 'rgba(255,184,77,0.6)'; c.fillRect(tbx - 3, maxY, 16, 1);

    // Column 2 — shields & armour diagram
    const cx = pad + colW * 1.5, cy = h / 2 + 4;
    const rr = Math.min(colW * 0.42, h * 0.38);
    c.strokeStyle = dim; c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(cx, cy - rr * 0.55); c.lineTo(cx + rr * 0.4, cy + rr * 0.35); c.lineTo(cx + rr * 0.12, cy + rr * 0.3);
    c.lineTo(cx, cy + rr * 0.45); c.lineTo(cx - rr * 0.12, cy + rr * 0.3); c.lineTo(cx - rr * 0.4, cy + rr * 0.35); c.closePath();
    c.stroke();
    const sF = Math.max(0, p.shieldF / p.shieldMax), sR = Math.max(0, p.shieldR / p.shieldMax);
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.beginPath(); c.arc(cx, cy, rr, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    c.beginPath(); c.arc(cx, cy, rr, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
    c.strokeStyle = shieldColor(sF);
    c.beginPath(); c.arc(cx, cy, rr, Math.PI * 1.5 - 0.35 * Math.PI * sF, Math.PI * 1.5 + 0.35 * Math.PI * sF); c.stroke();
    c.strokeStyle = shieldColor(sR);
    c.beginPath(); c.arc(cx, cy, rr, Math.PI * 0.5 - 0.35 * Math.PI * sR, Math.PI * 0.5 + 0.35 * Math.PI * sR); c.stroke();
    const af = Math.max(0, p.armor / p.armorMax);
    c.textAlign = 'center';
    c.fillStyle = shieldColor(af);
    c.fillText(`ARMOR ${Math.round(af * 100)}%`, cx, h - pad - fs * 0.2);
    c.fillStyle = dim;
    c.fillText('SHIELDS', cx, pad + fs * 0.5);

    // Column 3 — energy, fuel, ordnance, money, cargo, nav
    x = pad + colW * 2 + 6;
    const bw = colW - 12;
    y = pad + fs * 0.6;
    const bar = (label, f, color) => {
      c.textAlign = 'left'; c.fillStyle = dim; c.fillText(label, x, y);
      const bx = x + fs * 3.3, bwid = bw - fs * 3.3;
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(bx, y - fs * 0.35, bwid, fs * 0.7);
      c.fillStyle = color; c.fillRect(bx, y - fs * 0.35, bwid * Math.max(0, Math.min(1, f)), fs * 0.7);
      y += fs * 1.35;
    };
    bar('GUNS', p.energy / 100, '#7fd8ff');
    bar('BURN', p.abFuel / 100, p.abFuel < 20 ? '#ff5a4a' : '#ffb84d');
    const line = (txt, color = green) => { c.textAlign = 'left'; c.fillStyle = color; c.fillText(txt, x, y); y += fs * 1.3; };
    line(`MSL ${p.missiles}/${p.maxMissiles}  DCY ${p.decoys}`);
    line(`CR ${g.credits.toLocaleString()}  HOLD ${g.cargoUsed()}/${g.cargoCap}`, '#ffe066');
    const nav = g.navs[g.navIndex];
    if (nav && y < h - 2) line(`NAV ${nav.name.length > 14 ? nav.name.slice(0, 13) + '…' : nav.name}`, '#7fd8ff');
    if (p.gAccel > 5 && y < h - 2) line(`GRAV ${(p.gAccel / 9.81).toFixed(1)} g`, p.gAccel > 80 ? '#ff5a4a' : '#c46bff');
    c.textBaseline = 'alphabetic';
  }

  updateLights() {
    const g = this.g, p = g.player;
    const set = (id, cls) => {
      const el = this.lights[id];
      const v = 'light' + (cls ? ' ' + cls : '');
      if (el.className !== v) el.className = v;
    };
    const sh = (p.shieldF + p.shieldR) / (2 * p.shieldMax);
    set('shld', sh < 0.15 ? 'red blink' : sh < 0.4 ? 'amber' : '');
    const ar = p.armor / p.armorMax;
    set('armr', ar < 0.3 ? 'red blink' : ar < 0.7 ? 'amber' : '');
    set('msl', g.missiles.some(m => m.target === p) ? 'red blink' : '');
    const enemyLock = g.ships.some(s => s.alive && s.team === 'pirate' && s.lockTime > 1);
    set('lock', enemyLock ? 'amber blink' : p.lockTime >= LOCK_TIME ? 'green' : '');
    set('grav', p.gAccel > 80 ? 'red blink' : p.gAccel > 15 ? 'amber' : '');
    set('fuel', p.abFuel < 20 ? 'amber blink' : '');
    set('auto', g.autopilotStatus().ok ? 'green' : '');
    set('dock', g.dockableStation() ? 'green' : '');
  }
}
