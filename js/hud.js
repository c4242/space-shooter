import * as THREE from 'three';
import { LASER_SPEED, lockTimeFor } from './ships.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
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

export function shieldColor(f) { return f > 0.6 ? '#6dff9a' : f > 0.25 ? '#ffb84d' : '#ff5a4a'; }

export class Hud {
  constructor(game) {
    this.g = game;
    this.canvas = document.getElementById('hud');
    this.ctx = this.canvas.getContext('2d');
    this.messages = [];
    this.cracks = [];
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

  resize() { this.W = innerWidth; this.H = innerHeight; this.dpr = Math.min(devicePixelRatio || 1, 2); this.fit(this.canvas); }

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
      this.drawContacts(ctx);
      this.drawNav(ctx);
      this.drawTarget(ctx);
      this.drawVelocity(ctx);
      this.drawCrosshair(ctx);
      if (g.mouseFlight && !g.mouseFree && g.mouse.inside && g.state === 'flight') this.drawMouse(ctx);
      if ((g.mouseFree || !g.mouseFlight) && !g.touchMode && g.state === 'flight' && g.mouse.inside) this.drawPickHint(ctx);
      if (p.gAccel > 15) this.drawGravity(ctx, p.gAccel);
    }
    if (g.dashVisible && this.cracks.length) this.drawCracks(ctx);
    this.drawMessages(ctx);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashRGB},${Math.min(0.45, this.flash)})`;
      ctx.fillRect(0, 0, W, H);
      this.flash -= dt * 1.8;
    }
    if (g.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, g.fade)})`; ctx.fillRect(0, 0, W, H); }
  }

  // Prograde (where you are actually going) and retrograde (point here and thrust to slow down).
  drawVelocity(ctx) {
    const p = this.g.player;
    if (p.speed < 3) return;
    const v = p.vel.clone().normalize().multiplyScalar(5000);
    const pro = this.project(v.clone().add(p.pos));
    const retro = this.project(v.negate().add(p.pos));
    if (pro.on) {
      ctx.strokeStyle = 'rgba(125,255,176,0.95)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(pro.x, pro.y, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pro.x - 8, pro.y); ctx.lineTo(pro.x - 15, pro.y);
      ctx.moveTo(pro.x + 8, pro.y); ctx.lineTo(pro.x + 15, pro.y);
      ctx.moveTo(pro.x, pro.y - 8); ctx.lineTo(pro.x, pro.y - 15);
      ctx.stroke();
      ctx.fillStyle = 'rgba(125,255,176,0.8)'; ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(p.speed)}`, pro.x + 18, pro.y + 4);
    }
    if (retro.on) {
      ctx.strokeStyle = 'rgba(255,184,77,0.95)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(retro.x, retro.y, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(retro.x - 5, retro.y - 5); ctx.lineTo(retro.x + 5, retro.y + 5);
      ctx.moveTo(retro.x + 5, retro.y - 5); ctx.lineTo(retro.x - 5, retro.y + 5);
      ctx.stroke();
    }
  }

  // Canopy damage: a branching crack radiating from an impact point (stored in screen fractions).
  addCrack() {
    if (this.cracks.length >= 10) return;
    let fx, fy;
    do { fx = 0.12 + Math.random() * 0.76; fy = 0.08 + Math.random() * 0.5; } while (Math.abs(fx - 0.5) < 0.12 && Math.abs(fy - 0.3) < 0.12);
    const lines = [];
    const branch = (x, y, a, len, depth) => {
      const pts = [[x, y]];
      let cx = x, cy = y;
      const n = 4 + (Math.random() * 4 | 0);
      for (let i = 0; i < n; i++) {
        a += (Math.random() - 0.5) * 0.7;
        cx += Math.cos(a) * len / n; cy += Math.sin(a) * len / n;
        pts.push([cx, cy]);
        if (depth < 2 && Math.random() < 0.25) branch(cx, cy, a + (Math.random() < 0.5 ? 0.7 : -0.7), len * 0.45, depth + 1);
      }
      lines.push({ pts, w: depth ? 0.7 : 1.2 });
    };
    const rays = 4 + (Math.random() * 4 | 0);
    for (let i = 0; i < rays; i++) branch(0, 0, i / rays * Math.PI * 2 + Math.random() * 0.5, 0.05 + Math.random() * 0.13, 0);
    this.cracks.push({ fx, fy, lines });
  }

  drawCracks(ctx) {
    const S = Math.min(this.W, this.viewH);
    for (const c of this.cracks) {
      const ox = c.fx * this.W, oy = c.fy * this.viewH;
      ctx.fillStyle = 'rgba(210,225,240,0.28)';
      ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
      for (const pass of [[4, 'rgba(0,0,0,0.25)'], [1, 'rgba(225,238,255,0.55)']]) {
        ctx.strokeStyle = pass[1];
        for (const l of c.lines) {
          ctx.lineWidth = l.w * pass[0];
          ctx.beginPath();
          l.pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](ox + x * S, oy + y * S));
          ctx.stroke();
        }
      }
    }
  }

  drawCrosshair(ctx) {
    const g = this.g;
    const tags = [];
    if (g.flightAssist) tags.push('FLIGHT ASSIST');
    if (g.matching) tags.push('MATCHING VELOCITY');
    if (tags.length) {
      ctx.font = '11px "Share Tech Mono", monospace';
      ctx.fillStyle = 'rgba(125,255,176,0.75)'; ctx.textAlign = 'center';
      ctx.fillText(tags.join('  ·  '), this.W / 2, this.viewH / 2 + 42);
      ctx.font = '13px "Share Tech Mono", monospace';
    }
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

  // With the cursor free, highlight whatever a click would target.
  drawPickHint(ctx) {
    const g = this.g, t = g.pickHover;
    if (!t || t === g.target) return;
    const pr = this.project(t.pos);
    if (!pr.on) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(pr.x - 14, pr.y - 14, 28, 28);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'center';
    ctx.fillText(`click: target ${t.name}`, pr.x, pr.y + 28);
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
      ctx.strokeStyle = s.team === 'civ' ? C.yellow : s.team === 'police' ? '#6ab0ff' : s.team === 'player' ? C.green : C.red; ctx.lineWidth = 1.3;
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
    for (const pod of g.salvage.pods) {
      if (pod === g.target || pod.pos.distanceTo(p.pos) > 6000) continue;
      const pr = this.project(pod.pos);
      if (!pr.on) continue;
      ctx.strokeStyle = 'rgba(255,200,90,0.85)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(pr.x, pr.y - 5); ctx.lineTo(pr.x + 5, pr.y); ctx.lineTo(pr.x, pr.y + 5); ctx.lineTo(pr.x - 5, pr.y); ctx.closePath(); ctx.stroke();
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
    const hostile = t.team === 'pirate' || (t.team === 'police' && g.isWanted());
    const col = hostile ? C.red : t.isStation ? C.green : t.team === 'police' ? '#6ab0ff' : C.yellow;
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
      const need = lockTimeFor(p);
      if (need > 0 && p.lockTime > 0) {
        const f = Math.min(1, p.lockTime / need);
        const locked = p.lockTime >= need;
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
    const y0 = this.g.dashVisible ? this.g.cockpit.L.topBand + 30 : this.H * 0.12;
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
}
