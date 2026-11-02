import * as THREE from 'three';
import { COMMODITIES } from './world.js';
import { glowTex } from './ships.js';

// Cargo pods dropped by destroyed ships. Fly within scoop range to collect them.
const POD_GEO = new THREE.BoxGeometry(3.2, 2.2, 4.2);
const POD_MAT = new THREE.MeshStandardMaterial({ color: 0x9a8a60, metalness: 0.5, roughness: 0.5, emissive: 0x332200, envMapIntensity: 0.3 });
const BAND_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2, 0.6) });
const LOOT = COMMODITIES.filter(c => !c.illegal);
export const SCOOP_RANGE = 45;

export class Salvage {
  constructor(game) { this.g = game; this.pods = []; }

  drop(ship) {
    const n = ship.kind === 'warlord' ? 4 : ship.kind === 'marauder' || ship.hauler ? 2 + (Math.random() < 0.5 ? 1 : 0) : Math.random() < 0.6 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      // Pricier goods are rarer.
      const w = LOOT.map(c => 1 / Math.sqrt(c.base));
      let r = Math.random() * w.reduce((a, b) => a + b, 0), cm = LOOT[0];
      for (let k = 0; k < LOOT.length; k++) { r -= w[k]; if (r <= 0) { cm = LOOT[k]; break; } }
      const g = new THREE.Group();
      g.add(new THREE.Mesh(POD_GEO, POD_MAT));
      const band = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 4.4), BAND_MAT);
      g.add(band);
      const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(3, 2, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      beacon.scale.setScalar(14);
      g.add(beacon);
      g.position.copy(ship.pos).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(ship.radius));
      this.g.scene.add(g);
      this.pods.push({
        isPod: true, alive: true, obj: g, beacon, name: `Cargo pod: ${cm.name}`, cm, qty: 1 + ((Math.random() * 3) | 0),
        radius: 4, vel: ship.vel.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(30)),
        spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(0.8), life: 150,
        get pos() { return this.obj.position; },
      });
    }
  }

  update(dt, player, onScoop) {
    const t = performance.now() / 1000;
    for (let i = this.pods.length - 1; i >= 0; i--) {
      const p = this.pods[i];
      p.life -= dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += p.spin.x * dt; p.obj.rotation.y += p.spin.y * dt; p.obj.rotation.z += p.spin.z * dt;
      p.beacon.visible = (t * 1.5 + i * 0.37) % 1 < 0.5;
      let gone = p.life <= 0;
      if (!gone && player && player.alive && p.pos.distanceTo(player.pos) < SCOOP_RANGE) gone = onScoop(p);
      if (gone) this.remove(i);
    }
  }

  remove(i) {
    const p = this.pods[i];
    p.alive = false;
    this.g.scene.remove(p.obj);
    this.pods.splice(i, 1);
  }

  clear() { while (this.pods.length) this.remove(this.pods.length - 1); }
}
