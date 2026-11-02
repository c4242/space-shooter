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
  }

  _rnd() {
    return this._v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
  }

  explosion(pos, s = 1, baseVel = null) {
    const b = baseVel || new THREE.Vector3();
    const v = this._v;
    this.emit(pos, b, { life: 0.3, size: 90 * s, sizeEnd: 150 * s, color: [5, 4, 3] });
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

  sparks(pos, color, n = 12) {
    for (let i = 0; i < n; i++) {
      this._rnd().multiplyScalar(40 + Math.random() * 160);
      this.emit(pos, this._v, { life: 0.25 + Math.random() * 0.3, size: 1.8, sizeEnd: 0.4, color, colorEnd: [color[0] * 0.3, color[1] * 0.3, color[2] * 0.3] });
    }
  }
}
