import * as THREE from 'three';

// GPU particle system (one draw call) used for explosions, sparks, engine and missile trails.
// Includes the logarithmic-depth chunks because the renderer uses a log depth buffer.
const VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float size;
attribute vec4 pcolor;
uniform float scale;
varying vec4 vColor;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size > 0.0 ? max(1.5, size * scale / -mv.z) : 0.0;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
varying vec4 vColor;
void main() {
  #include <logdepthbuf_fragment>
  float a = texture2D(map, gl_PointCoord).a;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

function softTexture() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

const WAVE_GEO = new THREE.PlaneGeometry(1, 1);
const WAVE_TEX = (() => {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.62, 'rgba(255,255,255,0)');
  grd.addColorStop(0.82, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.9, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
})();
const DEBRIS_GEO = new THREE.BoxGeometry(1, 1, 1);

export class Particles {
  constructor(scene, max = 6000) {
    this.max = max; this.next = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('pcolor', this.aCol);
    geo.setAttribute('size', this.aSize);
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: softTexture() }, scale: { value: 500 } },
      vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.scene = scene;
    this.waves = [];
    this.debris = [];
    this._v = new THREE.Vector3();
  }

  setScale(s) { this.material.uniforms.scale.value = s; }

  emit(p, v, o) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    this.vel[i3] = v ? v.x : 0; this.vel[i3 + 1] = v ? v.y : 0; this.vel[i3 + 2] = v ? v.z : 0;
    const life = o.life ?? 1;
    this.life[i] = life; this.maxLife[i] = life;
    const c = o.color || [1, 1, 1], ce = o.colorEnd || c;
    this.c0[i3] = c[0]; this.c0[i3 + 1] = c[1]; this.c0[i3 + 2] = c[2];
    this.c1[i3] = ce[0]; this.c1[i3 + 1] = ce[1]; this.c1[i3 + 2] = ce[2];
    this.a0[i] = o.alpha ?? 1;
    this.s0[i] = o.size ?? 2;
    this.s1[i] = o.sizeEnd ?? this.s0[i];
    this.drag[i] = o.drag ?? 0;
  }

  update(dt) {
    const { pos, vel, col, size, life, maxLife, c0, c1, a0, s0, s1, drag } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (size[i] !== 0) size[i] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; continue; }
      const t = 1 - life[i] / maxLife[i];
      const i3 = i * 3, i4 = i * 4;
      if (drag[i]) { const dr = Math.exp(-drag[i] * dt); vel[i3] *= dr; vel[i3 + 1] *= dr; vel[i3 + 2] *= dr; }
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      col[i4] = c0[i3] + (c1[i3] - c0[i3]) * t;
      col[i4 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * t;
      col[i4 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * t;
      col[i4 + 3] = a0[i] * (1 - t);
      size[i] = s0[i] + (s1[i] - s0[i]) * t;
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
    this.updateExtras(dt);
  }

  _rnd() {
    return this._v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
  }

  explosion(pos, s = 1, baseVel = null) {
    const b = baseVel || new THREE.Vector3();
    this.shockwave(pos, s, b);
    if (s >= 0.9) this.spawnDebris(pos, s, b);
    const v = this._v;
    this.emit(pos, b, { life: 0.22, size: 34 * s, sizeEnd: 70 * s, color: [3, 2.5, 2] });
    for (let i = 0; i < 36 * s; i++) {
      this._rnd().multiplyScalar((15 + Math.random() * 70) * s).add(b);
      this.emit(pos, v, { life: 0.5 + Math.random() * 0.9, size: (10 + Math.random() * 14) * s, sizeEnd: (30 + Math.random() * 30) * s, color: [4, 2, 0.7], colorEnd: [0.5, 0.08, 0.02], drag: 1.2 });
    }
    for (let i = 0; i < 60 * s; i++) {
      this._rnd().multiplyScalar((120 + Math.random() * 380) * s).add(b);
      this.emit(pos, v, { life: 0.4 + Math.random() * 0.8, size: 2.2 * s, sizeEnd: 0.6, color: [5, 3.5, 1.5], colorEnd: [2, 0.4, 0.05], drag: 0.4 });
    }
    for (let i = 0; i < 18 * s; i++) {
      this._rnd().multiplyScalar((10 + Math.random() * 35) * s).add(b);
      this.emit(pos, v, { life: 2 + Math.random() * 1.5, size: 14 * s, sizeEnd: 55 * s, color: [0.22, 0.2, 0.19], colorEnd: [0.03, 0.03, 0.03], alpha: 0.7, drag: 0.6 });
    }
  }

  // Expanding ring of light, oriented randomly so it reads as a 3D shell.
  shockwave(pos, s, vel) {
    const m = new THREE.Mesh(WAVE_GEO, new THREE.MeshBasicMaterial({
      map: WAVE_TEX, color: new THREE.Color(2.2, 1.6, 1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize());
    this.scene.add(m);
    this.waves.push({ m, t: 0, life: 0.9, size: 140 * s, vel: vel.clone() });
  }

  // Tumbling, glowing hull fragments.
  spawnDebris(pos, s, vel) {
    const n = Math.round(7 * s);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.6, roughness: 0.5, emissive: new THREE.Color(1.6, 0.6, 0.15), envMapIntensity: 0.3 });
      const m = new THREE.Mesh(DEBRIS_GEO, mat);
      m.scale.set(0.6 + Math.random() * 2.2, 0.3 + Math.random() * 1.2, 0.8 + Math.random() * 2.6).multiplyScalar(s);
      m.position.copy(pos);
      this.scene.add(m);
      const v = this._rnd().clone().multiplyScalar(40 + Math.random() * 140).add(vel);
      this.debris.push({ m, v, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6), t: 0, life: 4 + Math.random() * 3, smoke: 0 });
    }
  }

  updateExtras(dt) {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      const k = w.t / w.life;
      w.m.position.addScaledVector(w.vel, dt);
      w.m.scale.setScalar(5 + w.size * Math.sqrt(k));
      w.m.material.opacity = Math.max(0, 1 - k) * 0.9;
      if (k >= 1) { this.scene.remove(w.m); w.m.material.dispose(); this.waves.splice(i, 1); }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
      const heat = Math.max(0, 1 - d.t / 1.8);
      d.m.material.emissive.setRGB(1.6 * heat, 0.6 * heat, 0.15 * heat);
      d.smoke -= dt;
      if (heat > 0.05 && d.smoke <= 0) {
        d.smoke = 0.05;
        this.emit(d.m.position, d.v.clone().multiplyScalar(0.3), { life: 0.8, size: 2, sizeEnd: 6, color: [1.2 * heat + 0.15, 0.5 * heat + 0.14, 0.13], colorEnd: [0.04, 0.04, 0.04], alpha: 0.6 });
      }
      if (d.t > d.life - 1) d.m.scale.multiplyScalar(Math.exp(-3 * dt));
      if (d.t >= d.life) { this.scene.remove(d.m); d.m.material.dispose(); this.debris.splice(i, 1); }
    }
  }

  sparks(pos, color, n = 12) {
    for (let i = 0; i < n; i++) {
      this._rnd().multiplyScalar(40 + Math.random() * 160);
      this.emit(pos, this._v, { life: 0.25 + Math.random() * 0.3, size: 1.8, sizeEnd: 0.4, color, colorEnd: [color[0] * 0.3, color[1] * 0.3, color[2] * 0.3] });
    }
  }
}

// ---------------------------------------------------------------------------
// Shield impact bubbles: a fresnel-lit sphere that flashes around a ship when
// its shields absorb a hit, brightest on the side that was hit.
// ---------------------------------------------------------------------------
const BUBBLE_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vW = normalize(position);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const BUBBLE_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float alpha; uniform vec3 color; uniform vec3 hitDir;
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
  #include <logdepthbuf_fragment>
  float rim = pow(1.0 - abs(dot(vN, vV)), 2.2);
  float hit = pow(max(dot(vW, hitDir), 0.0), 6.0);
  gl_FragColor = vec4(color, alpha * (rim * 0.8 + hit * 1.6));
}`;
const BUBBLE_GEO = new THREE.SphereGeometry(1, 32, 20);

export class Bubbles {
  constructor(scene) { this.scene = scene; this.list = []; }
  add(ship, at) {
    if (this.list.some(b => b.ship === ship && b.t > 0.2)) return;
    const mat = new THREE.ShaderMaterial({
      uniforms: { alpha: { value: 1 }, color: { value: new THREE.Color(0.5, 1.4, 3.2) }, hitDir: { value: new THREE.Vector3() } },
      vertexShader: BUBBLE_VS, fragmentShader: BUBBLE_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(BUBBLE_GEO, mat);
    m.scale.setScalar(ship.radius * 1.4);
    m.position.copy(ship.pos);
    // Hit direction in the bubble's (unrotated) local space.
    mat.uniforms.hitDir.value.subVectors(at, ship.pos).normalize();
    this.scene.add(m);
    this.list.push({ m, ship, t: 0.35 });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.t -= dt;
      b.m.position.copy(b.ship.pos);
      b.m.material.uniforms.alpha.value = Math.max(0, b.t / 0.35);
      if (b.t <= 0 || !b.ship.alive) {
        this.scene.remove(b.m); b.m.material.dispose();
        this.list.splice(i, 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Space dust: faint streaks that wrap around the camera so speed is visible.
// ---------------------------------------------------------------------------
export class Dust {
  constructor(scene, n = 450, size = 700) {
    this.n = n; this.size = size;
    this.p = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) this.p[i] = (Math.random() - 0.5) * size;
    this.buf = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.buf, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: new THREE.Color(0.55, 0.65, 0.8), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }
  update(cam, vel, visible) {
    this.lines.visible = visible;
    if (!visible) return;
    const S = this.size, h = S / 2;
    const sp = vel.length();
    const k = sp > 1 ? Math.min(60, Math.max(1.5, sp * 0.045)) / sp : 0;
    const sx = vel.x * k, sy = vel.y * k, sz = vel.z * k;
    const p = this.p, b = this.buf;
    const wrap = (v, c) => { let d = v - c; d = ((d + h) % S + S) % S - h; return c + d; };
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, i6 = i * 6;
      p[i3] = wrap(p[i3], cam.x); p[i3 + 1] = wrap(p[i3 + 1], cam.y); p[i3 + 2] = wrap(p[i3 + 2], cam.z);
      b[i6] = p[i3]; b[i6 + 1] = p[i3 + 1]; b[i6 + 2] = p[i3 + 2];
      b[i6 + 3] = p[i3] - sx; b[i6 + 4] = p[i3 + 1] - sy; b[i6 + 5] = p[i3 + 2] - sz;
    }
    this.attr.needsUpdate = true;
  }
}
