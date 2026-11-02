import * as THREE from 'three';

// Screen-space gravitational lensing around the black hole.
// Pixels near the hole sample the image closer to its centre, which bends the
// starfield and accretion disk into a ring, like a (very) simplified Einstein ring.
export const LensingShader = {
  uniforms: {
    tDiffuse: { value: null },
    center: { value: new THREE.Vector2(0.5, 0.5) },
    radius: { value: 0 },
    aspect: { value: 1 },
    strength: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 center;
    uniform float radius;
    uniform float aspect;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      if (strength > 0.0) {
        vec2 d = (vUv - center) * vec2(aspect, 1.0);
        float r = length(d);
        float rs = radius;
        if (r > rs * 1.25) {
          float defl = strength * 1.15 * rs * rs / r;
          vec2 nd = d - (d / r) * defl;
          uv = center + nd / vec2(aspect, 1.0);
        }
      }
      gl_FragColor = texture2D(tDiffuse, uv);
    }`,
};
