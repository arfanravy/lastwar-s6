import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FACTION_ICON, predictFactions, type Faction, type GroupKey } from '../faction';
import type { Theme } from '../theme';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface MapTile {
  id: number;
  group: GroupKey;
  rank: number;
  row: number;
  col: number;
}

export interface MapLabels {
  deepwood: string;
  wetland: string;
  center: string;
  temple: string;
}

export interface MapOptions {
  mode: 'full' | 'ambient';
  tiles: MapTile[];
  picks: { A: number; B: number };
  myServer?: string;
  labels: MapLabels;
  labelRoot?: HTMLElement;
  /** Site theme for the initial palette (default 'dark' = night scene). */
  theme?: Theme;
  onSelect?: (id: number | 'center' | null) => void;
}

export interface MapHandle {
  setPicks(a: number, b: number): void;
  setMyServer(id: string): void;
  select(id: number | 'center' | null): void;
  resetView(): void;
  setLabelsVisible(v: boolean): void;
  /** Screen position (px, relative to the map container) of a tile's label anchor. */
  anchorOf(key: number | 'center'): { x: number; y: number; visible: boolean } | null;
  setHighQuality(v: boolean): void;
  readonly highQuality: boolean;
  /** Switch between the night (dark) and daytime (light) palette without rebuilding. */
  setTheme(theme: Theme): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                 */
/* ------------------------------------------------------------------ */

const TILE = 8;
const GAP = 1.7;
const STEP = TILE + GAP;
const TOP = 0.25; // y of a tile's top surface
const DEPTH = 1.6;

const FACTION_COLOR: Record<Faction, THREE.Color> = {
  deepwood: new THREE.Color(0x3fdc78),
  wetland: new THREE.Color(0x2fb0ff),
};
const GOLD = new THREE.Color(0xffc24d);
const TORCH = new THREE.Color(0xff8a2a);
const PULSE = new THREE.Color(0xff3344);

/* ------------------------------------------------------------------ */
/* Palettes                                                            */
/* ------------------------------------------------------------------ */

/** Everything in the scene that changes with the site theme. */
interface Palette {
  clear: number;
  fog: number;
  /** Multiplier on the fog density (pale daytime haze reads much stronger). */
  fogScale: number;
  exposure: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  rim: number;
  rimIntensity: number;
  waterDeep: number;
  waterShallow: number;
  waterGlint: number;
  outerLand: number;
  jungleTop: number;
  plazaTop: number;
  earthSide: number;
  /** Faction ring colours (unlit, not tone mapped) and their brightness boost. */
  ring: Record<Faction, THREE.Color>;
  ringBoost: number;
  goldRing: THREE.Color;
  goldRingBoost: number;
  capGlow: number;
  goldGlow: number;
  templeGlow: number;
  torchBoost: number;
  pulseBoost: number;
  /** Spores: raw shader colours, brightness, alpha and blending. */
  sporeA: [number, number, number];
  sporeB: [number, number, number];
  sporeBoost: number;
  sporeAlpha: number;
  sporeAdditive: boolean;
  beam: THREE.Color;
  beamBoost: number;
  beamAlpha: number;
  beamAdditive: boolean;
  bloomStrength: number;
  bloomThreshold: number;
}

const PALETTES: Record<Theme, Palette> = {
  // Night: the original look (keep these values as they are).
  dark: {
    clear: 0x07170f,
    fog: 0x0a2417,
    fogScale: 1,
    exposure: 1.05,
    hemiSky: 0xcdeedb,
    hemiGround: 0x0c2216,
    hemiIntensity: 1.1,
    sun: 0xffe7c2,
    sunIntensity: 2.2,
    rim: 0x6fd0ff,
    rimIntensity: 0.6,
    waterDeep: 0x06302e,
    waterShallow: 0x1c7f6d,
    waterGlint: 0xbff7e0,
    outerLand: 0x1d4a2c,
    jungleTop: 0x2c6b3f,
    plazaTop: 0x5f6b4a,
    earthSide: 0x4a3a28,
    ring: FACTION_COLOR,
    ringBoost: 1.35,
    goldRing: GOLD,
    goldRingBoost: 1.3,
    capGlow: 1.6,
    goldGlow: 2.2,
    templeGlow: 60,
    torchBoost: 2.2,
    pulseBoost: 1.8,
    sporeA: [0.78, 1.0, 0.35],
    sporeB: [1.0, 0.5, 0.85],
    sporeBoost: 1.6,
    sporeAlpha: 0.9,
    sporeAdditive: true,
    beam: GOLD,
    beamBoost: 1.4,
    beamAlpha: 0.32,
    beamAdditive: true,
    bloomStrength: 0.7,
    bloomThreshold: 0.85,
  },
  // Daytime: bright sky haze, sunlit jungle, clear river water. Glow is
  // toned down and drawn with normal blending so it still reads on a
  // bright scene; faction rings are deeper so they stand out on the water.
  light: {
    clear: 0xdfeae3,
    fog: 0xdfeae3,
    fogScale: 0.5,
    exposure: 1.0,
    hemiSky: 0xeaf6ff,
    hemiGround: 0x4d6b45,
    hemiIntensity: 1.6,
    sun: 0xfff0d8,
    sunIntensity: 3.4,
    rim: 0xcfeaff,
    rimIntensity: 0.5,
    waterDeep: 0x1b6b80,
    waterShallow: 0x4bb0b8,
    waterGlint: 0xffffff,
    outerLand: 0x528a46,
    jungleTop: 0x3f8f45,
    plazaTop: 0x8a8f6a,
    earthSide: 0x7a5a3a,
    ring: { deepwood: new THREE.Color(0x1fbf5c), wetland: new THREE.Color(0x168fe8) },
    ringBoost: 1,
    goldRing: new THREE.Color(0xe8a41c),
    goldRingBoost: 1,
    capGlow: 0.45,
    goldGlow: 0.7,
    templeGlow: 18,
    torchBoost: 1.4,
    pulseBoost: 1.1,
    sporeA: [0.45, 0.62, 0.12],
    sporeB: [0.85, 0.3, 0.62],
    sporeBoost: 1,
    sporeAlpha: 0.6,
    sporeAdditive: false,
    beam: new THREE.Color(0xffb020),
    beamBoost: 1,
    beamAlpha: 0.3,
    beamAdditive: false,
    bloomStrength: 0.35,
    bloomThreshold: 0.95,
  },
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRect(size: number, r: number) {
  const s = new THREE.Shape();
  const h = size / 2;
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}

function ringShape(outer: number, inner: number, r: number) {
  const s = roundedRect(outer, r);
  s.holes.push(roundedRect(inner, Math.max(0.1, r - (outer - inner) / 2)) as unknown as THREE.Path);
  return s;
}

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Canvas textures                                                     */
/* ------------------------------------------------------------------ */

const flagTextureCache = new Map<string, THREE.CanvasTexture>();

/** Simple original deer-head emblem (antlers + head). */
function drawDeer(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  g.save();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 5 * s;
  g.beginPath();
  g.moveTo(cx - 12 * s, cy - 6 * s);
  g.lineTo(cx + 12 * s, cy - 6 * s);
  g.lineTo(cx + 5 * s, cy + 22 * s);
  g.lineTo(cx - 5 * s, cy + 22 * s);
  g.closePath();
  g.fill();
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + d * 11 * s, cy - 4 * s);
    g.lineTo(cx + d * 25 * s, cy - 11 * s);
    g.lineTo(cx + d * 15 * s, cy + 3 * s);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx + d * 6 * s, cy - 7 * s);
    g.quadraticCurveTo(cx + d * 9 * s, cy - 28 * s, cx + d * 27 * s, cy - 40 * s);
    g.moveTo(cx + d * 9 * s, cy - 19 * s);
    g.lineTo(cx + d * 21 * s, cy - 21 * s);
    g.moveTo(cx + d * 14 * s, cy - 30 * s);
    g.lineTo(cx + d * 13 * s, cy - 44 * s);
    g.stroke();
  }
  g.restore();
}

/** Simple original crocodile emblem (open jaws with teeth). */
function drawCroc(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  g.save();
  g.fillStyle = color;
  // upper jaw
  g.beginPath();
  g.moveTo(cx - 30 * s, cy - 8 * s);
  g.quadraticCurveTo(cx - 10 * s, cy - 22 * s, cx + 34 * s, cy - 18 * s);
  g.lineTo(cx + 36 * s, cy - 10 * s);
  g.lineTo(cx - 12 * s, cy - 2 * s);
  g.closePath();
  g.fill();
  // lower jaw
  g.beginPath();
  g.moveTo(cx - 30 * s, cy + 8 * s);
  g.lineTo(cx - 12 * s, cy + 6 * s);
  g.lineTo(cx + 32 * s, cy + 18 * s);
  g.lineTo(cx + 30 * s, cy + 25 * s);
  g.quadraticCurveTo(cx - 6 * s, cy + 26 * s, cx - 30 * s, cy + 18 * s);
  g.closePath();
  g.fill();
  // head
  g.beginPath();
  g.ellipse(cx - 30 * s, cy + 4 * s, 14 * s, 16 * s, 0, 0, Math.PI * 2);
  g.fill();
  // eye
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.ellipse(cx - 27 * s, cy - 6 * s, 4 * s, 3 * s, -0.3, 0, Math.PI * 2);
  g.fill();
  // teeth
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const x = cx - 6 * s + i * 8 * s;
    const yU = cy - 2 * s - (i + 0.5) * 1.5 * s;
    g.beginPath();
    g.moveTo(x, yU);
    g.lineTo(x + 5 * s, yU - 0.8 * s);
    g.lineTo(x + 2.5 * s, yU + 6 * s);
    g.fill();
    const yL = cy + 7 * s + (i + 0.5) * 2.3 * s;
    g.beginPath();
    g.moveTo(x + 3 * s, yL);
    g.lineTo(x + 8 * s, yL + 1.2 * s);
    g.lineTo(x + 5 * s, yL - 6 * s);
    g.fill();
  }
  g.restore();
}

function factionFlagTexture(faction: Faction) {
  const cached = flagTextureCache.get(faction);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  const [a, b] = faction === 'deepwood' ? ['#1f7a45', '#0e3d22'] : ['#1a6fae', '#0b3456'];
  const grad = g.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#e8c56a';
  g.lineWidth = 8;
  g.strokeRect(6, 6, 244, 148);
  g.beginPath();
  g.arc(128, 80, 50, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = faction === 'deepwood' ? '#8ff0b1' : '#9bd7ff';
  g.stroke();
  if (faction === 'deepwood') drawDeer(g, 128, 92, 1.05, '#d9ffe6');
  else drawCroc(g, 128, 80, 1.05, '#dff3ff');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  flagTextureCache.set(faction, tex);
  return tex;
}

function merahPutihTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e11d2a';
  g.fillRect(0, 0, 128, 40);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 40, 128, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

function waterMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x06302e) },
        uShallow: { value: new THREE.Color(0x1c7f6d) },
        uGlint: { value: new THREE.Color(0xbff7e0) },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uGlint;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz;
        float w = sin(p.x * 0.9 + uTime * 0.8) * sin(p.y * 0.7 - uTime * 1.1)
                + 0.5 * sin((p.x + p.y) * 1.7 - uTime * 1.6);
        float flow = sin(p.y * 0.35 + uTime * 0.6 + sin(p.x * 0.4) * 1.5);
        vec3 col = mix(uDeep, uShallow, smoothstep(-1.2, 1.6, w + flow * 0.6));
        float glint = smoothstep(1.25, 1.45, w + flow * 0.4);
        col += uGlint * glint * 0.35;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function sporeMaterial(pixelRatio: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uHeight: { value: 14 },
      // Raw shader colours (no colour management), set per theme
      uColorA: { value: new THREE.Vector3(0.78, 1.0, 0.35) },
      uColorB: { value: new THREE.Vector3(1.0, 0.5, 0.85) },
      uBoost: { value: 1.6 },
      uAlpha: { value: 0.9 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uHeight;
      varying float vSeed;
      varying float vFade;
      void main() {
        vec3 p = position;
        float speed = 0.25 + aSeed * 0.45;
        p.y = mod(p.y + uTime * speed, uHeight);
        p.x += sin(uTime * 0.6 + aSeed * 40.0) * 0.7;
        p.z += cos(uTime * 0.5 + aSeed * 23.0) * 0.7;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.5 + aSeed * 3.5) * uPixelRatio * (28.0 / -mv.z);
        vSeed = aSeed;
        vFade = smoothstep(0.0, 1.5, p.y) * (1.0 - smoothstep(uHeight - 4.0, uHeight, p.y));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uBoost;
      uniform float uAlpha;
      varying float vSeed;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 col = mix(uColorA, uColorB, step(0.72, vSeed)) * uBoost;
        gl_FragColor = vec4(col, a * vFade * uAlpha);
      }
    `,
  });
}

function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: GOLD.clone() }, uBoost: { value: 1.4 }, uAlpha: { value: 0.32 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uBoost;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 2.2);
        float bands = 0.75 + 0.25 * sin(vUv.y * 30.0 - uTime * 3.0);
        gl_FragColor = vec4(uColor * uBoost, fade * bands * uAlpha);
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/* Scene builder                                                       */
/* ------------------------------------------------------------------ */

interface TileRuntime {
  data: MapTile | null; // null = center
  key: number | 'center';
  group: THREE.Group;
  pick: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  ringColor: THREE.Color;
  ringTarget: THREE.Color;
  flag?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  flagBase?: Float32Array;
  lift: number;
  label?: HTMLButtonElement;
  anchor: THREE.Vector3;
}

export function createRainforestMap(container: HTMLElement, opts: MapOptions): MapHandle {
  const ambient = opts.mode === 'ambient';
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  let highQuality = !coarse && cores >= 4 && !ambient;
  const shadows = highQuality;
  const motion = reducedMotion ? 0.15 : 1;
  let theme: Theme = opts.theme ?? 'dark';
  let pal = PALETTES[theme];
  const ringColorFor = (f: Faction) => pal.ring[f].clone().multiplyScalar(pal.ringBoost);
  const goldRingColor = () => pal.goldRing.clone().multiplyScalar(pal.goldRingBoost);

  /* Renderer ------------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(pal.clear);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = pal.exposure;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const maxDpr = () => Math.min(window.devicePixelRatio || 1, highQuality ? 2 : 1.5);
  renderer.setPixelRatio(maxDpr());
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  const scene = new THREE.Scene();
  const fogDensity = ambient ? 0.02 : 0.016;
  const fog = new THREE.FogExp2(pal.fog, fogDensity * pal.fogScale);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  const HOME_BASE = ambient ? new THREE.Vector3(26, 24, 30) : new THREE.Vector3(0, 34, 38);
  const HOME_POS = HOME_BASE.clone();
  let ambientRadius = 40;
  const HOME_TARGET = new THREE.Vector3(0, 0, 0);
  camera.position.copy(HOME_POS);
  camera.lookAt(HOME_TARGET);

  /* Lights --------------------------------------------------------- */
  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiIntensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(pal.sun, pal.sunIntensity);
  sun.position.set(-20, 34, 16);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -24;
    sc.right = sc.top = 24;
    sc.near = 1;
    sc.far = 90;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun);
  const rim = new THREE.DirectionalLight(pal.rim, pal.rimIntensity);
  rim.position.set(24, 10, -30);
  scene.add(rim);

  /* Shared geometry & materials ----------------------------------- */
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const tileGeo = track(
    new THREE.ExtrudeGeometry(roundedRect(TILE, 0.9), {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.25,
      bevelSize: 0.25,
      bevelSegments: 2,
      curveSegments: 6,
    }),
  );
  tileGeo.rotateX(-Math.PI / 2);
  tileGeo.translate(0, -DEPTH, 0);

  const ringGeo = track(new THREE.ShapeGeometry(ringShape(TILE + 0.75, TILE + 0.2, 1.2), 6));
  ringGeo.rotateX(-Math.PI / 2);

  const jungleTop = track(new THREE.MeshStandardMaterial({ color: pal.jungleTop, roughness: 0.95, flatShading: true }));
  const plazaTop = track(new THREE.MeshStandardMaterial({ color: pal.plazaTop, roughness: 0.9, flatShading: true }));
  const earthSide = track(new THREE.MeshStandardMaterial({ color: pal.earthSide, roughness: 1, flatShading: true }));

  const trunkGeo = track(new THREE.CylinderGeometry(0.1, 0.17, 1, 5));
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeoA = track(new THREE.IcosahedronGeometry(1, 0));
  const canopyGeoB = track(new THREE.ConeGeometry(0.85, 2.1, 6));
  const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1, flatShading: true }));
  const canopyMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }));
  const greens = [0x1f5e36, 0x2d7a43, 0x3d8f4f, 0x24502f, 0x4a9a52, 0x2f6d3a].map((c) => new THREE.Color(c));

  const stemGeo = track(new THREE.CylinderGeometry(0.12, 0.2, 1.1, 6));
  stemGeo.translate(0, 0.55, 0);
  const capGeo = track(new THREE.SphereGeometry(0.62, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
  const stemMat = track(new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.7 }));
  const capMats = [0xff4fa0, 0xb36bff, 0x4fe3ff].map((c) =>
    track(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: pal.capGlow, roughness: 0.4 })),
  );

  const stoneMat = track(new THREE.MeshStandardMaterial({ color: 0x8a8d68, roughness: 0.95, flatShading: true }));
  const stoneDark = track(new THREE.MeshStandardMaterial({ color: 0x6c6f50, roughness: 0.95, flatShading: true }));
  const goldMat = track(
    new THREE.MeshStandardMaterial({ color: 0xffc24d, emissive: 0xffa31a, emissiveIntensity: pal.goldGlow, metalness: 0.6, roughness: 0.3 }),
  );
  const poleMat = track(new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.9 }));
  const flagGeo = track(new THREE.PlaneGeometry(1.7, 1.06, 14, 6));
  flagGeo.translate(0.85, 0, 0);

  const rand = mulberry32(6061);

  /* Water & outer land -------------------------------------------- */
  const water = new THREE.Mesh(track(new THREE.PlaneGeometry(520, 520)), track(waterMaterial()));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.7;
  scene.add(water);

  const outerGeo = track(
    new THREE.ExtrudeGeometry(ringShape(180, STEP * 3 + 3.2, 4), { depth: 1, bevelEnabled: false, curveSegments: 6 }),
  );
  outerGeo.rotateX(-Math.PI / 2);
  outerGeo.translate(0, -1.1, 0);
  const outerTop = track(new THREE.MeshStandardMaterial({ color: pal.outerLand, roughness: 1, flatShading: true }));
  const outer = new THREE.Mesh(outerGeo, [outerTop, earthSide]);
  outer.receiveShadow = shadows;
  scene.add(outer);

  // Outer jungle (instanced)
  {
    const count = ambient || !highQuality ? 260 : 650;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crowns = new THREE.InstancedMesh(canopyGeoA, canopyMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const inner = (STEP * 3 + 3.2) / 2 + 1.5;
    let i = 0;
    while (i < count) {
      const x = (rand() - 0.5) * 90;
      const z = (rand() - 0.5) * 90;
      if (Math.abs(x) < inner && Math.abs(z) < inner) continue;
      const h = 1 + rand() * 1.4;
      const s = 0.7 + rand() * 0.8;
      m.compose(new THREE.Vector3(x, -0.1, z), q, new THREE.Vector3(1, h, 1));
      trunks.setMatrixAt(i, m);
      q.setFromEuler(new THREE.Euler(rand(), rand() * 6, rand()));
      m.compose(new THREE.Vector3(x, -0.1 + h + s * 0.6, z), q, new THREE.Vector3(s, s * 1.1, s));
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, greens[Math.floor(rand() * greens.length)].clone().multiplyScalar(0.7));
      q.identity();
      i++;
    }
    trunks.castShadow = crowns.castShadow = shadows;
    scene.add(trunks, crowns);
  }

  /* Tiles ---------------------------------------------------------- */
  const tiles: TileRuntime[] = [];
  const pickables: THREE.Object3D[] = [];
  let factions = predictFactions(opts.picks.A, opts.picks.B);

  const makeTrees = (parent: THREE.Group, count: number, clear: (x: number, z: number) => boolean) => {
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crownsA = new THREE.InstancedMesh(canopyGeoA, canopyMat, count);
    const crownsB = new THREE.InstancedMesh(canopyGeoB, canopyMat, count);
    let a = 0;
    let b = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const lim = TILE / 2 - 0.7;
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < count * 30) {
      const x = (rand() * 2 - 1) * lim;
      const z = (rand() * 2 - 1) * lim;
      if (!clear(x, z)) continue;
      const h = 0.7 + rand() * 1.3;
      const s = 0.45 + rand() * 0.55;
      m.compose(new THREE.Vector3(x, TOP, z), q.identity(), new THREE.Vector3(1, h, 1));
      trunks.setMatrixAt(placed, m);
      const color = greens[Math.floor(rand() * greens.length)];
      if (rand() < 0.62) {
        q.setFromEuler(new THREE.Euler(rand(), rand() * 6, rand()));
        m.compose(new THREE.Vector3(x, TOP + h + s * 0.55, z), q, new THREE.Vector3(s, s * 1.15, s));
        crownsA.setMatrixAt(a, m);
        crownsA.setColorAt(a++, color);
      } else {
        q.setFromEuler(new THREE.Euler(0, rand() * 6, 0));
        m.compose(new THREE.Vector3(x, TOP + h + s * 0.9, z), q, new THREE.Vector3(s, s, s));
        crownsB.setMatrixAt(b, m);
        crownsB.setColorAt(b++, color);
      }
      placed++;
    }
    trunks.count = placed;
    crownsA.count = a;
    crownsB.count = b;
    for (const im of [trunks, crownsA, crownsB]) {
      im.castShadow = shadows;
      im.receiveShadow = false;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    parent.add(trunks, crownsA, crownsB);
  };

  const makeMushrooms = (parent: THREE.Group, n: number, clear: (x: number, z: number) => boolean) => {
    let made = 0;
    let guard = 0;
    while (made < n && guard++ < 200) {
      const x = (rand() * 2 - 1) * (TILE / 2 - 1);
      const z = (rand() * 2 - 1) * (TILE / 2 - 1);
      if (!clear(x, z)) continue;
      const s = 0.8 + rand() * 0.9;
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.scale.set(s, s, s);
      stem.position.set(x, TOP, z);
      const cap = new THREE.Mesh(capGeo, capMats[Math.floor(rand() * capMats.length)]);
      cap.scale.set(s, s * 0.8, s);
      cap.position.set(x, TOP + 1.05 * s, z);
      stem.castShadow = cap.castShadow = shadows;
      parent.add(stem, cap);
      made++;
    }
  };

  for (const data of opts.tiles) {
    const key = data.id;
    const group = new THREE.Group();
    group.position.set((data.col - 1) * STEP, 0, (data.row - 1) * STEP);
    const base = new THREE.Mesh(tileGeo, [jungleTop, earthSide]);
    base.receiveShadow = shadows;
    base.castShadow = shadows;
    base.userData.tileKey = key;
    group.add(base);

    const faction = factions[data.group];
    const ringMat = track(new THREE.MeshBasicMaterial({ color: ringColorFor(faction), toneMapped: false }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = TOP + 0.03;
    group.add(ring);

    // Banner pole in the middle clearing
    const plinth = new THREE.Mesh(track(new THREE.CylinderGeometry(0.75, 0.9, 0.35, 6)), stoneMat);
    plinth.position.y = TOP + 0.17;
    plinth.castShadow = shadows;
    const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.07, 3.6, 6)), poleMat);
    pole.position.y = TOP + 1.9;
    pole.castShadow = shadows;
    const flagMat = track(
      new THREE.MeshStandardMaterial({ map: factionFlagTexture(faction), side: THREE.DoubleSide, roughness: 0.8 }),
    );
    const flag = new THREE.Mesh(flagGeo.clone(), flagMat);
    track(flag.geometry);
    flag.position.set(0.05, TOP + 3.05, 0);
    flag.castShadow = shadows;
    group.add(plinth, pole, flag);
    if (data.rank === 1) {
      const crown = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.28)), goldMat);
      crown.position.y = TOP + 3.9;
      crown.userData.spin = true;
      group.add(crown);
    }

    const clear = (x: number, z: number) => Math.hypot(x, z) > 1.7;
    makeTrees(group, ambient || !highQuality ? 34 : 60, clear);
    makeMushrooms(group, 3, (x, z) => Math.hypot(x, z) > 2.2);

    scene.add(group);
    pickables.push(base);
    tiles.push({
      data,
      key,
      group,
      pick: base,
      ringMat,
      ringColor: ringMat.color.clone(),
      ringTarget: ringMat.color.clone(),
      flag,
      flagBase: Float32Array.from(flag.geometry.attributes.position.array as Float32Array),
      lift: 0,
      anchor: new THREE.Vector3(),
    });
  }

  /* Center tile: Ancestral Temple --------------------------------- */
  let gem: THREE.Mesh;
  let glow: THREE.PointLight;
  const beamMat = track(beamMaterial());
  const torchMat = track(new THREE.MeshBasicMaterial({ color: TORCH.clone().multiplyScalar(pal.torchBoost), toneMapped: false }));
  {
    const group = new THREE.Group();
    const base = new THREE.Mesh(tileGeo, [plazaTop, earthSide]);
    base.receiveShadow = shadows;
    base.userData.tileKey = 'center';
    group.add(base);
    const ringMat = track(new THREE.MeshBasicMaterial({ color: goldRingColor(), toneMapped: false }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = TOP + 0.03;
    group.add(ring);

    const tiers = 5;
    const tierH = 0.62;
    for (let i = 0; i < tiers; i++) {
      const w = 5.2 - i * 0.92;
      const box = new THREE.Mesh(track(new THREE.BoxGeometry(w, tierH, w)), i % 2 ? stoneDark : stoneMat);
      box.position.y = TOP + tierH / 2 + i * tierH;
      box.castShadow = box.receiveShadow = shadows;
      group.add(box);
    }
    const H = tiers * tierH;
    const steps = 10;
    const startZ = 3.15;
    const endZ = 0.75;
    const run = (startZ - endZ) / steps;
    for (let s = 0; s < steps; s++) {
      const yTop = ((s + 1) / steps) * H;
      const st = new THREE.Mesh(track(new THREE.BoxGeometry(1.15, yTop, run)), stoneDark);
      st.position.set(0, TOP + yTop / 2, startZ - s * run - run / 2);
      st.castShadow = st.receiveShadow = shadows;
      group.add(st);
    }
    const shrine = new THREE.Mesh(track(new THREE.BoxGeometry(1.25, 0.9, 1.25)), stoneMat);
    shrine.position.y = TOP + H + 0.45;
    shrine.castShadow = shadows;
    const roof = new THREE.Mesh(track(new THREE.ConeGeometry(1.05, 0.7, 4)), goldMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = TOP + H + 1.25;
    group.add(shrine, roof);

    gem = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.42)), goldMat);
    gem.position.y = TOP + H + 2.3;
    group.add(gem);

    const beam = new THREE.Mesh(track(new THREE.CylinderGeometry(0.35, 0.75, 16, 20, 1, true)), beamMat);
    beam.position.y = TOP + H + 1.2 + 8;
    group.add(beam);

    glow = new THREE.PointLight(0xffb340, pal.templeGlow, 22, 2);
    glow.position.y = TOP + H + 2.2;
    group.add(glow);

    // Torches on plaza corners
    for (const [x, z] of [
      [-3.2, -3.2],
      [3.2, -3.2],
      [-3.2, 3.2],
      [3.2, 3.2],
    ]) {
      const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.3, 1.2, 0.3)), stoneDark);
      post.position.set(x, TOP + 0.6, z);
      const fire = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.2)), torchMat);
      fire.position.set(x, TOP + 1.35, z);
      fire.userData.flicker = rand() * 10;
      group.add(post, fire);
    }

    makeTrees(group, ambient || !highQuality ? 10 : 18, (x, z) => Math.max(Math.abs(x), Math.abs(z)) > 3.4);
    scene.add(group);
    pickables.push(base);
    tiles.push({
      data: null,
      key: 'center',
      group,
      pick: base,
      ringMat,
      ringColor: ringMat.color.clone(),
      ringTarget: ringMat.color.clone(),
      lift: 0,
      anchor: new THREE.Vector3(),
    });
  }

  /* Merah putih marker for "my server" ---------------------------- */
  const marker = new THREE.Group();
  const pulseMat = track(
    new THREE.MeshBasicMaterial({ color: PULSE.clone().multiplyScalar(pal.pulseBoost), transparent: true, toneMapped: false, depthWrite: false }),
  );
  {
    const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, 5.4, 6)), track(new THREE.MeshStandardMaterial({ color: 0xf2f2f2 })));
    pole.position.y = 2.7;
    const tip = new THREE.Mesh(track(new THREE.SphereGeometry(0.13, 10, 8)), goldMat);
    tip.position.y = 5.45;
    const fm = track(new THREE.MeshStandardMaterial({ map: track(merahPutihTexture()), side: THREE.DoubleSide, roughness: 0.7 }));
    const flag = new THREE.Mesh(track(new THREE.PlaneGeometry(1.5, 0.95, 14, 6)), fm);
    flag.geometry.translate(0.75, 0, 0);
    flag.position.y = 4.9;
    flag.userData.base = Float32Array.from(flag.geometry.attributes.position.array as Float32Array);
    flag.name = 'mp-flag';
    const pulse = new THREE.Mesh(track(new THREE.RingGeometry(0.9, 1.05, 48)), pulseMat);
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.y = TOP + 0.06;
    pulse.name = 'mp-pulse';
    marker.add(pole, tip, flag, pulse);
    marker.position.set(2.3, 0, 2.3);
    marker.visible = false;
  }

  /* Spores --------------------------------------------------------- */
  const sporeCount = ambient ? 500 : highQuality ? 1600 : 700;
  const sporeGeo = track(new THREE.BufferGeometry());
  {
    const pos = new Float32Array(sporeCount * 3);
    const seed = new Float32Array(sporeCount);
    for (let i = 0; i < sporeCount; i++) {
      pos[i * 3] = (rand() - 0.5) * 50;
      pos[i * 3 + 1] = rand() * 14;
      pos[i * 3 + 2] = (rand() - 0.5) * 50;
      seed[i] = rand();
    }
    sporeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sporeGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  }
  const sporeMat = track(sporeMaterial(renderer.getPixelRatio()));
  const spores = new THREE.Points(sporeGeo, sporeMat);
  spores.frustumCulled = false;
  scene.add(spores);

  /* Post-processing ------------------------------------------------ */
  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  const buildComposer = () => {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), pal.bloomStrength, 0.5, pal.bloomThreshold);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  };
  if (highQuality) buildComposer();

  /* Theme ---------------------------------------------------------- */
  // Pushes the current palette into the renderer, lights, materials and
  // uniforms. Runs once at start-up and again on every setTheme().
  const applyPalette = () => {
    renderer.setClearColor(pal.clear);
    renderer.toneMappingExposure = pal.exposure;
    fog.color.setHex(pal.fog);
    fog.density = fogDensity * pal.fogScale;
    hemi.color.setHex(pal.hemiSky);
    hemi.groundColor.setHex(pal.hemiGround);
    hemi.intensity = pal.hemiIntensity;
    sun.color.setHex(pal.sun);
    sun.intensity = pal.sunIntensity;
    rim.color.setHex(pal.rim);
    rim.intensity = pal.rimIntensity;
    const wu = (water.material as THREE.ShaderMaterial).uniforms;
    wu.uDeep.value.setHex(pal.waterDeep);
    wu.uShallow.value.setHex(pal.waterShallow);
    wu.uGlint.value.setHex(pal.waterGlint);
    outerTop.color.setHex(pal.outerLand);
    jungleTop.color.setHex(pal.jungleTop);
    plazaTop.color.setHex(pal.plazaTop);
    earthSide.color.setHex(pal.earthSide);
    for (const m of capMats) m.emissiveIntensity = pal.capGlow;
    goldMat.emissiveIntensity = pal.goldGlow;
    glow.intensity = pal.templeGlow;
    torchMat.color.copy(TORCH).multiplyScalar(pal.torchBoost);
    pulseMat.color.copy(PULSE).multiplyScalar(pal.pulseBoost);
    const su = sporeMat.uniforms;
    su.uColorA.value.fromArray(pal.sporeA);
    su.uColorB.value.fromArray(pal.sporeB);
    su.uBoost.value = pal.sporeBoost;
    su.uAlpha.value = pal.sporeAlpha;
    sporeMat.blending = pal.sporeAdditive ? THREE.AdditiveBlending : THREE.NormalBlending;
    const bu = beamMat.uniforms;
    bu.uColor.value.copy(pal.beam);
    bu.uBoost.value = pal.beamBoost;
    bu.uAlpha.value = pal.beamAlpha;
    beamMat.blending = pal.beamAdditive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (bloom) {
      bloom.strength = pal.bloomStrength;
      bloom.threshold = pal.bloomThreshold;
    }
    // Rings jump straight to the new colours (faction changes still fade)
    for (const t of tiles) {
      t.ringTarget.copy(t.data ? ringColorFor(factions[t.data.group]) : goldRingColor());
      t.ringColor.copy(t.ringTarget);
      t.ringMat.color.copy(t.ringTarget);
    }
  };
  applyPalette();

  /* Controls ------------------------------------------------------- */
  let controls: OrbitControls | null = null;
  let userInteracted = false;
  if (!ambient) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 12;
    controls.maxDistance = 75;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = 1.3;
    controls.screenSpacePanning = false;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.35;
    controls.target.copy(HOME_TARGET);
    controls.addEventListener('start', () => {
      userInteracted = true;
      controls!.autoRotate = false;
      focus = null;
    });
    controls.addEventListener('change', () => {
      const t = controls!.target;
      t.x = THREE.MathUtils.clamp(t.x, -18, 18);
      t.z = THREE.MathUtils.clamp(t.z, -18, 18);
      t.y = THREE.MathUtils.clamp(t.y, 0, 4);
    });
  }

  /* Labels --------------------------------------------------------- */
  const labelRoot = opts.labelRoot;
  let labelsVisible = true;
  let mine = opts.myServer ?? '';

  const renderLabel = (t: TileRuntime) => {
    if (!t.label) return;
    if (!t.data) {
      t.label.innerHTML = `<span class="em">🏛️</span><span class="txt">${opts.labels.center}</span>`;
      return;
    }
    const f = factions[t.data.group];
    const isMine = String(t.data.id) === mine;
    t.label.dataset.faction = f;
    t.label.classList.toggle('is-mine', isMine);
    t.label.innerHTML =
      `<span class="em">${FACTION_ICON[f]}</span>` +
      `<span class="txt">#${t.data.id}</span>` +
      (ambient ? '' : `<span class="rk">No.${t.data.rank}</span>`) +
      (isMine ? '<span class="pin">📍</span>' : '');
  };

  if (labelRoot) {
    for (const t of tiles) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'm3d-label' + (t.data ? '' : ' is-center');
      b.tabIndex = ambient ? -1 : 0;
      b.addEventListener('click', () => select(t.key));
      t.label = b;
      renderLabel(t);
      labelRoot.appendChild(b);
    }
  }

  /* Selection, hover, focus --------------------------------------- */
  let hovered: TileRuntime | null = null;
  let selected: TileRuntime | null = null;
  let focus: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  const tileByKey = (k: number | 'center' | null) => tiles.find((t) => t.key === k) ?? null;

  function select(key: number | 'center' | null) {
    selected = tileByKey(key);
    for (const t of tiles) t.label?.classList.toggle('is-selected', t === selected);
    if (controls) {
      if (selected) {
        const target = selected.group.position.clone();
        target.y = 1;
        const dir = camera.position.clone().sub(controls.target).normalize();
        dir.y = Math.max(dir.y, 0.55);
        dir.normalize();
        focus = { target, pos: target.clone().add(dir.multiplyScalar(selected.data ? 28 : 32)) };
        controls.autoRotate = false;
      }
    }
    opts.onSelect?.(selected ? selected.key : null);
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickAt = (clientX: number, clientY: number) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (!hit) return null;
    return tileByKey(hit.object.userData.tileKey);
  };

  let downAt: { x: number; y: number } | null = null;
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    hovered = pickAt(e.clientX, e.clientY);
    renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
    for (const t of tiles) t.label?.classList.toggle('is-hover', t === hovered);
  };
  const onPointerDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return;
    const t = pickAt(e.clientX, e.clientY);
    select(t ? t.key : null);
  };
  const onPointerLeave = () => {
    hovered = null;
    for (const t of tiles) t.label?.classList.remove('is-hover');
  };

  let parallax = { x: 0, y: 0 };
  const onAmbientMove = (e: PointerEvent) => {
    const r = container.getBoundingClientRect();
    parallax = { x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 };
  };

  if (!ambient) {
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  } else {
    container.addEventListener('pointermove', onAmbientMove);
  }

  /* Marker placement ----------------------------------------------- */
  const placeMarker = () => {
    marker.removeFromParent();
    const t = tiles.find((x) => x.data && String(x.data.id) === mine);
    marker.visible = !!t;
    if (t) t.group.add(marker);
    for (const tt of tiles) renderLabel(tt);
  };
  placeMarker();

  /* Resize & visibility ------------------------------------------- */
  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(maxDpr());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole board in view on tall/narrow screens
    camera.fov = camera.aspect < 0.9 ? 52 : 42;
    camera.updateProjectionMatrix();
    // Distance needed so the whole 3x3 board (+ margin) fits horizontally
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const need = (ambient ? 30 : 36) / 2 / Math.tan(hfov / 2);
    const dist = Math.max(HOME_BASE.length(), need);
    HOME_POS.copy(HOME_BASE).setLength(dist);
    ambientRadius = Math.max(40, need * 0.8);
    if (controls) {
      controls.maxDistance = Math.max(75, dist + 10);
      if (!userInteracted && !focus) {
        const off = camera.position.clone().sub(controls.target).setLength(dist);
        camera.position.copy(controls.target).add(off);
      }
    }
    composer?.setPixelRatio(renderer.getPixelRatio());
    composer?.setSize(w, h);
    sporeMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    if (!running) renderFrame(0);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let inView = true;
  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    updateRunning();
  });
  io.observe(container);
  const onVis = () => updateRunning();
  document.addEventListener('visibilitychange', onVis);

  /* Animation loop ------------------------------------------------- */
  let lastTime = performance.now();
  let elapsed = 0;
  let running = false;
  const tmp = new THREE.Vector3();
  const lerpColor = new THREE.Color();

  function waveFlag(mesh: THREE.Mesh, base: Float32Array, t: number, amp: number) {
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i];
      const k = x / 1.7;
      arr[i + 2] = base[i + 2] + Math.sin(x * 3.2 - t * 4.2) * amp * k;
      arr[i + 1] = base[i + 1] + Math.sin(x * 2.1 - t * 3.1) * amp * 0.35 * k;
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function renderFrame(dt: number) {
    elapsed += dt * motion;
    const t = elapsed;

    (water.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    sporeMat.uniforms.uTime.value = t;
    beamMat.uniforms.uTime.value = t;
    gem.rotation.y = t * 0.9;
    gem.position.y = TOP + 3.1 + 2.3 + Math.sin(t * 1.6) * 0.15;

    for (const tile of tiles) {
      const active = tile === hovered || tile === selected;
      const goal = active ? 0.45 : 0;
      tile.lift += (goal - tile.lift) * Math.min(1, dt * 8);
      tile.group.position.y = tile.lift;
      // Faction colour transition
      tile.ringColor.lerp(tile.ringTarget, Math.min(1, dt * 4));
      const pulse = tile === selected ? 1.15 + Math.sin(t * 5) * 0.12 : active ? 1.2 : 1;
      tile.ringMat.color.copy(lerpColor.copy(tile.ringColor).multiplyScalar(pulse));
      if (tile.flag && tile.flagBase && dt > 0) waveFlag(tile.flag, tile.flagBase, t + tile.group.position.x, 0.14);
      tile.group.traverse((o) => {
        if (o.userData.spin) o.rotation.y = t * 1.5;
        if (o.userData.flicker !== undefined) o.scale.setScalar(0.85 + Math.sin(t * 9 + o.userData.flicker) * 0.15);
      });
    }

    if (marker.visible) {
      const f = marker.getObjectByName('mp-flag') as THREE.Mesh;
      if (dt > 0) waveFlag(f, f.userData.base, t * 1.1, 0.12);
      const p = marker.getObjectByName('mp-pulse') as THREE.Mesh;
      const k = (t * 0.6) % 1;
      p.scale.setScalar(1 + k * 3.2);
      (p.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }

    // Camera
    if (controls) {
      if (focus) {
        const a = Math.min(1, dt * 3);
        controls.target.lerp(focus.target, a);
        camera.position.lerp(focus.pos, a);
        if (camera.position.distanceTo(focus.pos) < 0.05) focus = null;
      }
      controls.update(dt);
    } else {
      const ang = t * 0.06 + parallax.x * 0.35;
      const radius = ambientRadius;
      camera.position.set(Math.sin(ang) * radius, radius * 0.62 - parallax.y * 4, Math.cos(ang) * radius);
      camera.lookAt(0, 0, 0);
    }

    // Labels
    if (labelRoot) {
      const w = container.clientWidth;
      const h = container.clientHeight;
      for (const tile of tiles) {
        if (!tile.label) continue;
        if (!labelsVisible) {
          tile.label.style.visibility = 'hidden';
          continue;
        }
        tmp.copy(tile.group.position);
        tmp.y += tile.data ? 4.6 : 7.2;
        tmp.project(camera);
        const behind = tmp.z > 1;
        tile.label.style.visibility = behind ? 'hidden' : 'visible';
        tile.label.style.transform = `translate(-50%, -100%) translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
        tile.label.style.zIndex = String(Math.round((1 - tmp.z) * 10000));
      }
    }

    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
  }

  function loop() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    renderFrame(dt);
  }

  function updateRunning() {
    const should = inView && !document.hidden;
    if (should && !running) {
      running = true;
      lastTime = performance.now();
      renderer.setAnimationLoop(loop);
    } else if (!should && running) {
      running = false;
      renderer.setAnimationLoop(null);
    }
  }

  resize();
  updateRunning();

  /* Public API ----------------------------------------------------- */
  const applyFactions = () => {
    for (const t of tiles) {
      if (!t.data) continue;
      const f = factions[t.data.group];
      t.ringTarget.copy(ringColorFor(f));
      if (t.flag) {
        t.flag.material.map = factionFlagTexture(f);
        t.flag.material.needsUpdate = true;
      }
      renderLabel(t);
    }
  };

  return {
    setPicks(a, b) {
      factions = predictFactions(a, b);
      applyFactions();
    },
    setMyServer(id) {
      mine = id;
      placeMarker();
    },
    select,
    resetView() {
      if (!controls) return;
      select(null);
      focus = { pos: HOME_POS.clone(), target: HOME_TARGET.clone() };
      if (!userInteracted && !reducedMotion) controls.autoRotate = true;
    },
    anchorOf(key) {
      const t = tileByKey(key);
      if (!t) return null;
      const v = t.group.position.clone();
      v.y += t.data ? 4.6 : 7.2; // same anchor as the HTML labels
      v.project(camera);
      return {
        x: ((v.x + 1) / 2) * container.clientWidth,
        y: ((1 - v.y) / 2) * container.clientHeight,
        visible: v.z <= 1,
      };
    },
    setLabelsVisible(v) {
      labelsVisible = v;
    },
    setHighQuality(v) {
      highQuality = v;
      if (v && !composer) buildComposer();
      if (!v && composer) {
        composer.dispose();
        composer = null;
        bloom = null;
      }
      resize();
    },
    get highQuality() {
      return highQuality;
    },
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      pal = PALETTES[next];
      applyPalette();
      if (!running) renderFrame(0);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      container.removeEventListener('pointermove', onAmbientMove);
      controls?.dispose();
      composer?.dispose();
      for (const d of disposables) d.dispose();
      for (const t of tiles) t.label?.remove();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
