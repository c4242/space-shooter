import * as THREE from 'three';

// Custom materials. All of them include the logarithmic-depth chunks because the
// renderer uses a log depth buffer (needed for planet-scale distances).

const NOISE = /* glsl */`
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

const VS_WORLD = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNw;
varying vec3 vPw;
varying vec3 vNo;
void main() {
  vUv = uv;
  vNo = normal;
  vNw = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPw = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

// ---------------------------------------------------------------- the star
export function sunMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(...color) } },
    vertexShader: VS_WORLD,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float time; uniform vec3 color;
      varying vec2 vUv; varying vec3 vNw; varying vec3 vPw; varying vec3 vNo;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        vec3 V = normalize(cameraPosition - vPw);
        float mu = clamp(dot(normalize(vNw), V), 0.0, 1.0);
        // Boiling granulation: two noise layers drifting at different speeds.
        float g = fbm(vNo * 6.0 + vec3(time * 0.05, time * 0.03, -time * 0.04));
        float g2 = fbm(vNo * 22.0 - vec3(time * 0.12));
        float spots = smoothstep(0.62, 0.7, fbm(vNo * 2.5 + 3.0 + time * 0.01));
        float limb = pow(mu, 0.45);
        vec3 c = color * 0.8 * (0.45 + 0.75 * g + 0.3 * g2) * mix(0.3, 1.0, limb);
        c *= 1.0 - spots * 0.55;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- planets
export function planetMaterial({ map, lights = null, spec = 0, atmo = [0.4, 0.6, 1], sunPos }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      day: { value: map }, night: { value: lights }, hasNight: { value: lights ? 1 : 0 },
      spec: { value: spec }, atmo: { value: new THREE.Color(...atmo) }, sunPos: { value: sunPos.clone() },
      sunColor: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: VS_WORLD,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D day; uniform sampler2D night; uniform float hasNight; uniform float spec;
      uniform vec3 atmo; uniform vec3 sunPos; uniform vec3 sunColor;
      varying vec2 vUv; varying vec3 vNw; varying vec3 vPw; varying vec3 vNo;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vNw);
        vec3 L = normalize(sunPos - vPw);
        vec3 V = normalize(cameraPosition - vPw);
        float ndl = dot(N, L);
        vec3 tex = texture2D(day, vUv).rgb;
        // Soft terminator; no ambient light: the night side is black apart from city lights.
        float diff = smoothstep(-0.05, 0.25, ndl) * clamp(ndl * 0.9 + 0.1, 0.0, 1.0);
        vec3 col = tex * diff * sunColor * 1.25;
        // Ocean glint
        float ocean = smoothstep(0.02, 0.12, tex.b - max(tex.r, tex.g) * 0.9);
        vec3 H = normalize(L + V);
        col += spec * ocean * pow(max(dot(N, H), 0.0), 60.0) * smoothstep(0.0, 0.2, ndl) * vec3(1.6, 1.5, 1.3);
        // City lights on the night side
        if (hasNight > 0.5) {
          float dark = 1.0 - smoothstep(-0.2, 0.05, ndl);
          col += texture2D(night, vUv).rgb * dark * 2.2;
        }
        // Atmospheric scattering near the limb on the day side
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += atmo * fres * smoothstep(-0.25, 0.6, ndl) * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// Thin glowing shell drawn from the inside (BackSide): brightest at the planet's
// limb, fading to nothing at the shell edge, and only on the sunlit side.
export function atmosphereMaterial(color, sunPos, edge) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(...color) }, sunPos: { value: sunPos.clone() }, edge: { value: edge } },
    vertexShader: VS_WORLD,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 color; uniform vec3 sunPos; uniform float edge;
      varying vec2 vUv; varying vec3 vNw; varying vec3 vPw; varying vec3 vNo;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vNw);
        vec3 V = normalize(cameraPosition - vPw);
        vec3 L = normalize(sunPos - vPw);
        float d = -dot(N, V);
        float k = pow(smoothstep(0.0, edge, d), 1.6);
        float lit = smoothstep(-0.35, 0.45, dot(N, L));
        gl_FragColor = vec4(color * k * lit * 1.4, 1.0);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------- final lens pass
// Vignette plus a touch of chromatic aberration toward the edges.
export const LensFinishShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.0016 }, vignette: { value: 0.55 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float amount; uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d);
      vec2 off = d * amount * r * 4.0;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= mix(1.0, smoothstep(0.85, 0.25, r), vignette);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// ---------------------------------------------------------------- lens flare
// Procedural, additive lens flare composited in HDR (before tone mapping), so it
// only ever adds light and never greys out black space.
export const FlareShader = {
  uniforms: {
    tDiffuse: { value: null }, sun: { value: new THREE.Vector2(0.5, 0.5) }, intensity: { value: 0 },
    aspect: { value: 1 }, tint: { value: new THREE.Color(1, 0.9, 0.75) }, time: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 sun; uniform float intensity; uniform float aspect; uniform vec3 tint; uniform float time;
    varying vec2 vUv;
    vec3 ghost(vec2 uv, float k, float size, vec3 col, float ring) {
      vec2 gp = sun + (vec2(0.5) - sun) * k;
      float r = length((uv - gp) * vec2(aspect, 1.0));
      float disk = smoothstep(size, size * 0.65, r);
      float edge = exp(-pow((r - size) / (size * 0.08), 2.0));
      return col * mix(disk, edge, ring);
    }
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      if (intensity <= 0.001) { gl_FragColor = vec4(base, 1.0); return; }
      vec2 d = (vUv - sun) * vec2(aspect, 1.0);
      float r = length(d);
      float a = atan(d.y, d.x);
      vec3 c = vec3(0.0);
      c += tint * exp(-r * 22.0) * 2.0;                                       // core
      float rays = pow(abs(sin(a * 6.0 + time * 0.05)), 80.0) + 0.6 * pow(abs(sin(a * 9.0 + 1.3 - time * 0.03)), 120.0);
      c += tint * rays * exp(-r * 6.0) * 1.1;                                 // starburst
      c += vec3(0.5, 0.68, 1.0) * exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 2.4) * 0.9; // anamorphic streak
      c += tint * 0.18 * exp(-pow((r - 0.33) * 30.0, 2.0));                   // halo ring
      c += ghost(vUv, 0.45, 0.025, vec3(1.0, 0.75, 0.45) * 0.35, 0.0);
      c += ghost(vUv, 0.8, 0.05, vec3(0.45, 1.0, 0.65) * 0.16, 0.0);
      c += ghost(vUv, 1.2, 0.018, vec3(1.0, 0.5, 0.35) * 0.4, 0.0);
      c += ghost(vUv, 1.45, 0.09, vec3(0.4, 0.55, 1.0) * 0.12, 0.6);
      c += ghost(vUv, 1.8, 0.035, vec3(0.75, 0.5, 1.0) * 0.25, 0.0);
      c += ghost(vUv, 2.15, 0.13, vec3(1.0, 0.85, 0.6) * 0.07, 0.8);
      gl_FragColor = vec4(base + c * intensity, 1.0);
    }`,
};
