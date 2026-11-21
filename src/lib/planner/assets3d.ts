/**
 * Procedural low-poly asset kit for the planner's 3D view.
 *
 * Everything here is generated in code (no model / texture files) and follows
 * the look of the site's 3D rainforest map: flat-shaded shapes, earth-brown
 * ground with a green top, instanced trees, glowing mushrooms.
 *
 * Draw-call budget: every building type is ONE merged geometry rendered through
 * an InstancedMesh, so ~100 bases cost about a dozen draw calls in total.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SQUAD_COLORS, SQUADS, type Squad } from './i18n';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/** World units per grid cell. */
export const CELL = 1;

export interface GroundSpec {
  cols: number;
  rows: number;
  /** World coordinate of the bottom-left cell. */
  startX: number;
  startY: number;
}

export interface ItemSpec {
  /** Placement key: "x,y" anchor (top-left cell in grid space). */
  key: string;
  x: number;
  y: number;
  /** Footprint is size × size cells. */
  size: number;
  kind: 'player' | 'object';
  name: string;
  /** Centre coordinate text, identical to the 2D banner. */
  coord: string;
  /** Validated #rrggbb colour. */
  color: string;
  squad?: Squad;
  symbol?: string;
}

export interface KitOptions {
  highQuality: boolean;
  shadows: boolean;
  pixelRatio: number;
  maxAnisotropy: number;
  /** CSS font-family used for the coordinate ticks. */
  monoFont: string;
  tickColor: string;
  tickMajorColor: string;
}

export interface GroundBuild {
  group: THREE.Group;
  /** Half extents of the playable grid. */
  halfX: number;
  halfZ: number;
  /** Half extents of the raised slab (grid + border). */
  slabHalfX: number;
  slabHalfZ: number;
  tick(t: number): void;
  setPixelRatio(r: number): void;
  setSporeScale(s: number): void;
  dispose(): void;
}

export interface ItemRuntime {
  spec: ItemSpec;
  /** Footprint centre on the ground plane. */
  center: THREE.Vector3;
  /** Height of the tallest part (label anchor). */
  height: number;
  /** Pick volume. */
  box: THREE.Box3;
}

export interface ItemsBuild {
  group: THREE.Group;
  items: ItemRuntime[];
  maxHeight: number;
  setHighlight(index: number | null): void;
  tick(t: number): void;
  dispose(): void;
}

export interface AssetKit {
  buildGround(spec: GroundSpec): GroundBuild;
  buildItems(spec: GroundSpec, items: ItemSpec[]): ItemsBuild;
  tick(t: number): void;
  dispose(): void;
}

/** Footprint centre of a size×size item anchored at grid cell (gx, gy). */
export function footprintCenter(spec: GroundSpec, gx: number, gy: number, size: number, out = new THREE.Vector3()) {
  return out.set((gx + size / 2 - spec.cols / 2) * CELL, 0, (gy + size / 2 - spec.rows / 2) * CELL);
}

/* ------------------------------------------------------------------ */
/* Constants & small helpers                                           */
/* ------------------------------------------------------------------ */

type Disposable = { dispose(): void };

const SLAB_TOP = -0.06; // the grid plane itself sits at y = 0
const SLAB_DEPTH = 2;
const OUTER_TOP = -0.9;
const OUTER_DEPTH = 1.2;
const WATER_Y = -1.5;

const STONE = new THREE.Color(0x8a8d68);
const STONE_DARK = new THREE.Color(0x6c6f50);
const WOOD = new THREE.Color(0x5a4030);
const WINDOW_GLOW = new THREE.Color(1.9, 1.4, 0.62);
const WHITE = new THREE.Color(1, 1, 1);
const GREENS = [0x1f5e36, 0x2d7a43, 0x3d8f4f, 0x24502f, 0x4a9a52, 0x2f6d3a].map((c) => new THREE.Color(c));

const clamp = THREE.MathUtils.clamp;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bake a flat vertex colour into a geometry (and normalise it for merging). */
function tint(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  let g = geo;
  if (geo.index) {
    g = geo.toNonIndexed();
    geo.dispose();
  }
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Box whose bottom face sits at y. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.Color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return tint(g, color);
}

/** Four-sided pyramid (square base of width w) whose base sits at y. */
function pyramid(w: number, h: number, x: number, y: number, z: number, color: THREE.Color) {
  const g = new THREE.ConeGeometry((w / Math.SQRT2) * 1.06, h, 4);
  g.rotateY(Math.PI / 4);
  g.translate(x, y + h / 2, z);
  return tint(g, color);
}

function gemShape(r: number, x: number, y: number, z: number, color: THREE.Color) {
  const g = new THREE.OctahedronGeometry(r);
  g.translate(x, y, z);
  return tint(g, color);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('planner3d: geometry merge failed');
  return merged;
}

/* ------------------------------------------------------------------ */
/* Canvas textures                                                     */
/* ------------------------------------------------------------------ */

/**
 * One repeating tile = 3×3 cells. Thin dark lines on every cell border and a
 * brighter line on the tile border, i.e. every third cell counted from the
 * bottom-left origin (the plane's UV origin).
 */
function gridTileTexture(anisotropy: number) {
  const S = 384;
  const cell = S / 3;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2c6b3f';
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(6, 26, 14, 0.5)';
  for (let i = 0; i <= 3; i++) {
    g.fillRect(i * cell - 2.5, 0, 5, S);
    g.fillRect(0, i * cell - 2.5, S, 5);
  }
  g.fillStyle = 'rgba(176, 240, 196, 0.62)';
  for (const edge of [0, S]) {
    g.fillRect(edge - 4, 0, 8, S);
    g.fillRect(0, edge - 4, S, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

function symbolTexture(symbol: string, color: string) {
  const S = 160;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2);
  g.fillStyle = 'rgba(7, 23, 15, 0.86)';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = color;
  g.stroke();
  const glyph = Array.from(symbol || '◆')
    .slice(0, 2)
    .join('');
  let px = S * 0.54;
  const font = (n: number) =>
    `700 ${n}px "Segoe UI Symbol", "Noto Sans Symbols 2", "Noto Sans Symbols", "Apple Symbols", "DejaVu Sans", sans-serif`;
  g.font = font(px);
  const w = g.measureText(glyph).width;
  if (w > S * 0.62) {
    px *= (S * 0.62) / w;
    g.font = font(px);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.fillStyle = '#ffffff';
  g.fillText(glyph, S / 2, S / 2 + px * 0.04); // canvas text only: no HTML involved
  g.shadowBlur = 0;
  g.fillText(glyph, S / 2, S / 2 + px * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Shaders (same recipes as the rainforest map)                        */
/* ------------------------------------------------------------------ */

function waterMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uScale: { value: 1 },
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
      uniform float uScale;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uGlint;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz / uScale; // larger maps get proportionally larger ripples (no moiré far away)
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

function sporeMaterial(pixelRatio: number, height: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uHeight: { value: height },
      uScale: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uHeight;
      uniform float uScale;
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
        gl_PointSize = (1.5 + aSeed * 3.5) * uPixelRatio * (28.0 * uScale / -mv.z);
        vSeed = aSeed;
        vFade = smoothstep(0.0, 1.5, p.y) * (1.0 - smoothstep(uHeight * 0.7, uHeight, p.y));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vSeed;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 lime = vec3(0.78, 1.0, 0.35);
        vec3 pink = vec3(1.0, 0.5, 0.85);
        vec3 col = mix(lime, pink, step(0.72, vSeed)) * 1.6;
        gl_FragColor = vec4(col, a * vFade * 0.9);
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/* Building blueprints                                                 */
/* ------------------------------------------------------------------ */

interface BaseBlueprint {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  /** Tallest point, including pole and gem. */
  height: number;
  /** Centre height of the flag. */
  flagY: number;
  /** Height of the floating gem (R5 only). */
  gemY: number | null;
}

const FLAG_W = 0.74;
const FLAG_H = 0.44;

/** Keep levels per tier: [width, height]. Tier 1 = R1 … tier 5 = R5. */
const KEEP_LEVELS: Record<number, [number, number][]> = {
  1: [[1.15, 0.55]],
  2: [[1.5, 0.7]],
  3: [
    [1.5, 0.7],
    [1.0, 0.5],
  ],
  4: [
    [1.6, 0.75],
    [1.15, 0.6],
    [0.75, 0.5],
  ],
  5: [
    [1.7, 0.8],
    [1.25, 0.7],
    [0.85, 0.6],
    [0.5, 0.45],
  ],
};
const ROOF_H: Record<number, number> = { 1: 0.5, 2: 0.55, 3: 0.55, 4: 0.6, 5: 0.9 };
const WALL_H: Record<number, number> = { 3: 0.34, 4: 0.44, 5: 0.52 };
const TOWER_H: Record<number, number> = { 3: 0.85, 4: 1.05, 5: 1.3 };

/**
 * HQ compound on a 3×3 footprint. Higher tiers get more keep levels, walls,
 * corner towers and beacons; R5 is the tallest and carries a floating gem.
 */
function buildBaseBlueprint(squad: Squad): BaseBlueprint {
  const tier = 5 - SQUADS.indexOf(squad);
  const sc = new THREE.Color(SQUAD_COLORS[squad]);
  const stone = STONE.clone().lerp(sc, 0.16);
  const stoneDark = STONE_DARK.clone().lerp(sc, 0.12);
  const trim = sc.clone().multiplyScalar(0.82);
  const apron = sc.clone().multiplyScalar(0.42);
  const beacon = sc.clone().lerp(WHITE, 0.15).multiplyScalar(1.8);

  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];

  // Concrete pad with a squad-coloured apron so the tier reads from above.
  body.push(box(2.76, 0.14, 2.76, 0, 0, 0, stoneDark));
  body.push(box(2.5, 0.03, 2.5, 0, 0.14, 0, apron));
  let y = 0.17;

  // Keep
  const levels = KEEP_LEVELS[tier];
  levels.forEach(([w, h], i) => {
    body.push(box(w, h, w, 0, y, 0, i % 2 ? stoneDark : stone));
    const perFace = tier === 1 ? 1 : Math.max(1, Math.round(w / 0.55));
    const ww = 0.15;
    const wh = Math.min(0.22, h * 0.42);
    const wy = y + h * 0.5 - wh / 2;
    for (let k = 0; k < perFace; k++) {
      const off = perFace === 1 ? 0 : ((k + 0.5) / perFace - 0.5) * w * 0.84;
      glow.push(box(ww, wh, 0.03, off, wy, w / 2, WINDOW_GLOW)); // front
      if (tier > 1) {
        glow.push(box(ww, wh, 0.03, off, wy, -w / 2, WINDOW_GLOW));
        glow.push(box(0.03, wh, ww, w / 2, wy, off, WINDOW_GLOW));
        glow.push(box(0.03, wh, ww, -w / 2, wy, off, WINDOW_GLOW));
      }
    }
    y += h;
    body.push(box(w + 0.12, 0.06, w + 0.12, 0, y, 0, trim)); // cornice
    y += 0.06;
  });
  const topW = levels[levels.length - 1][0];
  const roofH = ROOF_H[tier];
  body.push(pyramid(tier === 5 ? topW * 0.9 : topW + 0.16, roofH, 0, y, 0, sc));
  y += roofH;

  // Banner pole on the roof apex (the flag itself is an instanced, waving plane).
  const poleH = tier === 5 ? 0.62 : 0.78;
  const pole = new THREE.CylinderGeometry(0.03, 0.04, poleH + 0.15, 5);
  pole.translate(0, y - 0.15 + (poleH + 0.15) / 2, 0);
  body.push(tint(pole, WOOD));
  const poleTop = y + poleH;
  const flagY = poleTop - FLAG_H / 2 - 0.02;
  let height = poleTop;
  let gemY: number | null = null;
  if (tier === 5) {
    gemY = poleTop + 0.42;
    height = gemY + 0.36;
  } else {
    glow.push(gemShape(0.05, 0, poleTop + 0.03, 0, beacon));
  }

  // Extras for the low tiers
  if (tier === 1) {
    body.push(box(0.34, 0.3, 0.34, -0.85, 0.17, 0.75, WOOD));
    body.push(box(0.26, 0.22, 0.26, -0.5, 0.17, 0.9, WOOD.clone().multiplyScalar(1.25)));
  }
  if (tier === 2) {
    body.push(box(0.72, 0.42, 0.72, 0.86, 0.17, -0.72, stoneDark));
    body.push(box(0.8, 0.05, 0.8, 0.86, 0.59, -0.72, trim));
    glow.push(box(0.14, 0.16, 0.03, 0.86, 0.3, -0.36, WINDOW_GLOW));
  }

  // Perimeter wall (with a gate gap at the front) and corner towers
  const wallH = WALL_H[tier];
  if (wallH) {
    const e = 1.2;
    body.push(box(2.52, wallH, 0.14, 0, 0.14, -e, stoneDark));
    body.push(box(0.14, wallH, 2.52, -e, 0.14, 0, stoneDark));
    body.push(box(0.14, wallH, 2.52, e, 0.14, 0, stoneDark));
    body.push(box(0.86, wallH, 0.14, -0.83, 0.14, e, stoneDark));
    body.push(box(0.86, wallH, 0.14, 0.83, 0.14, e, stoneDark));
    const th = TOWER_H[tier];
    const corners: [number, number][] =
      tier === 3
        ? [
            [-1.14, -1.14],
            [1.14, -1.14],
          ]
        : [
            [-1.14, -1.14],
            [1.14, -1.14],
            [-1.14, 1.14],
            [1.14, 1.14],
          ];
    for (const [tx, tz] of corners) {
      body.push(box(0.4, th, 0.4, tx, 0.14, tz, stone));
      body.push(pyramid(0.5, 0.34, tx, 0.14 + th, tz, sc));
      if (tier >= 4) glow.push(gemShape(0.065, tx, 0.14 + th + 0.42, tz, beacon));
    }
  }

  return { body: merge(body), glow: merge(glow), height, flagY, gemY };
}

/** Top of the obelisk tip in unit space (before the vertical scale). */
const OBJECT_UNIT_HEIGHT = 1.16;

/**
 * Monument on a unit (1×1) footprint, later scaled to N×N. Three geometries so
 * the instance colour can tint stone, accent and glowing parts differently.
 */
function buildObjectBlueprint() {
  const light = new THREE.Color(1, 1, 1);
  const shade = new THREE.Color(0.8, 0.8, 0.8);
  const stone = merge([
    box(0.9, 0.12, 0.9, 0, 0, 0, shade),
    box(0.7, 0.12, 0.7, 0, 0.12, 0, light),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.1, 0.36, 0.1, sx * 0.39, 0.12, sz * 0.39, shade))),
  ]);
  const obelisk = new THREE.CylinderGeometry(0.085, 0.2, 0.72, 4);
  obelisk.rotateY(Math.PI / 4);
  obelisk.translate(0, 0.24 + 0.36, 0);
  const accent = merge([
    box(0.985, 0.04, 0.985, 0, 0, 0, light), // coloured rim marking the footprint
    box(0.76, 0.03, 0.76, 0, 0.225, 0, shade),
    tint(obelisk, light),
  ]);
  const glow = merge([
    gemShape(0.11, 0, 1.05, 0, light),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.07, 0.07, 0.07, sx * 0.39, 0.48, sz * 0.39, light))),
  ]);
  return { stone, accent, glow };
}

/* ------------------------------------------------------------------ */
/* Kit                                                                 */
/* ------------------------------------------------------------------ */

export function createAssetKit(opts: KitOptions): AssetKit {
  const shared: Disposable[] = [];
  const track = <T extends Disposable>(x: T) => (shared.push(x), x);
  const shadows = opts.shadows;

  /* Shared materials ---------------------------------------------- */
  const gridTex = track(gridTileTexture(opts.maxAnisotropy));
  const gridMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, map: gridTex, roughness: 0.95, flatShading: true }));
  const borderTop = track(new THREE.MeshStandardMaterial({ color: 0x4b5a3c, roughness: 0.95, flatShading: true }));
  const outerTop = track(new THREE.MeshStandardMaterial({ color: 0x1d4a2c, roughness: 1, flatShading: true }));
  const earthSide = track(new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 1, flatShading: true }));
  const cornerMat = track(new THREE.MeshStandardMaterial({ color: 0xe11d2a, emissive: 0xe11d2a, emissiveIntensity: 1.1, roughness: 0.5, flatShading: true }));
  const water = track(waterMaterial());

  const trunkGeo = track(new THREE.CylinderGeometry(0.1, 0.17, 1, 5));
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeoA = track(new THREE.IcosahedronGeometry(1, 0));
  const canopyGeoB = track(new THREE.ConeGeometry(0.85, 2.1, 6));
  const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1, flatShading: true }));
  const canopyMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }));

  const stemGeo = track(new THREE.CylinderGeometry(0.12, 0.2, 1.1, 6));
  stemGeo.translate(0, 0.55, 0);
  const capGeo = track(new THREE.SphereGeometry(0.62, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
  const stemMat = track(new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.7 }));
  const capMats = [0xff4fa0, 0xb36bff, 0x4fe3ff].map((c) =>
    track(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.25, roughness: 0.4 })),
  );

  /** Lit, flat-shaded material for every building; colour = vertex colour × instance colour. */
  const bodyMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, flatShading: true }));
  /** Unlit accents (windows, beacons, crystal tips) that read as emissive and feed the bloom pass. */
  const glowMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false }));
  const goldMat = track(
    new THREE.MeshStandardMaterial({ color: 0xffc24d, emissive: 0xffa31a, emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.3, flatShading: true }),
  );
  const gemGeo = track(new THREE.OctahedronGeometry(0.3));

  // Waving banner: one instanced plane for every base, displaced in the vertex shader.
  const flagTime = { value: 0 };
  const flagGeo = track(new THREE.PlaneGeometry(FLAG_W, FLAG_H, 8, 3));
  flagGeo.translate(FLAG_W / 2 + 0.03, 0, 0);
  const flagMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8, flatShading: true }));
  flagMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = flagTime;
    shader.vertexShader =
      'uniform float uTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          float k = clamp(position.x / ${FLAG_W.toFixed(2)}, 0.0, 1.0);
          float ph = 0.0;
          #ifdef USE_INSTANCING
            ph = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.4;
          #endif
          transformed.z += sin(position.x * 7.0 - uTime * 4.2 + ph) * 0.09 * k;
          transformed.y += sin(position.x * 4.5 - uTime * 3.1 + ph) * 0.03 * k;
        }`,
      );
  };
  flagMat.customProgramCacheKey = () => 'pl-flag-wave';

  /* Blueprints (built lazily, then reused for every rebuild) ------- */
  const baseBlueprints = new Map<Squad, BaseBlueprint>();
  const baseBlueprint = (squad: Squad) => {
    let bp = baseBlueprints.get(squad);
    if (!bp) {
      bp = buildBaseBlueprint(squad);
      track(bp.body);
      track(bp.glow);
      baseBlueprints.set(squad, bp);
    }
    return bp;
  };
  let objectBlueprint: ReturnType<typeof buildObjectBlueprint> | null = null;
  const objectGeos = () => {
    if (!objectBlueprint) {
      objectBlueprint = buildObjectBlueprint();
      track(objectBlueprint.stone);
      track(objectBlueprint.accent);
      track(objectBlueprint.glow);
    }
    return objectBlueprint;
  };

  /** Symbol billboards, cached by glyph + colour and pruned on every rebuild. */
  const symbolCache = new Map<string, { tex: THREE.CanvasTexture; mat: THREE.SpriteMaterial; used: boolean }>();
  const symbolMaterial = (symbol: string, color: string) => {
    const key = symbol + '|' + color;
    let entry = symbolCache.get(key);
    if (!entry) {
      const tex = symbolTexture(symbol, color);
      entry = { tex, mat: new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }), used: true };
      symbolCache.set(key, entry);
    }
    entry.used = true;
    return entry.mat;
  };

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _c = new THREE.Color();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  /* Ground --------------------------------------------------------- */
  function tickStrip(
    own: <T extends Disposable>(x: T) => T,
    axis: 'x' | 'y',
    spec: GroundSpec,
    ppc: number,
    step: number,
    fontPx: number,
    thickness: number,
  ) {
    const count = axis === 'x' ? spec.cols : spec.rows;
    const c = document.createElement('canvas');
    const long = count * ppc;
    const short = Math.max(8, Math.round(thickness * ppc));
    c.width = axis === 'x' ? long : short;
    c.height = axis === 'x' ? short : long;
    const g = c.getContext('2d')!;
    g.textBaseline = 'middle';
    g.textAlign = axis === 'x' ? 'center' : 'right';
    for (let i = 0; i < count; i++) {
      // X runs left→right; Y is flipped so that 0:0 is the bottom-left corner.
      const value = axis === 'x' ? spec.startX + i : spec.startY + (spec.rows - 1 - i);
      const major = (axis === 'x' ? i : value - spec.startY) % 3 === 0;
      if (step > 1 && !major) continue;
      g.font = `${major ? 700 : 500} ${fontPx}px ${opts.monoFont}`;
      g.fillStyle = major ? opts.tickMajorColor : opts.tickColor;
      if (axis === 'x') g.fillText(String(value), (i + 0.5) * ppc, short / 2 + 1);
      else g.fillText(String(value), short - ppc * 0.12, (i + 0.5) * ppc + 1);
    }
    const tex = own(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = opts.maxAnisotropy;
    const mat = own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    const W = spec.cols * CELL;
    const H = spec.rows * CELL;
    const geo = own(axis === 'x' ? new THREE.PlaneGeometry(W, thickness) : new THREE.PlaneGeometry(thickness, H));
    geo.rotateX(-Math.PI / 2); // canvas top ends up on the far (-Z) side, so text reads upright
    const mesh = new THREE.Mesh(geo, mat);
    const gap = 0.14;
    if (axis === 'x') mesh.position.set(0, 0, H / 2 + gap + thickness / 2);
    else mesh.position.set(-W / 2 - gap - thickness / 2, 0, 0);
    mesh.renderOrder = 1;
    return mesh;
  }

  function buildGround(spec: GroundSpec): GroundBuild {
    const local: Disposable[] = [];
    const own = <T extends Disposable>(x: T) => (local.push(x), x);
    const instanced: THREE.InstancedMesh[] = [];
    const group = new THREE.Group();
    const rand = mulberry32(6061 + spec.cols * 131 + spec.rows);

    const W = spec.cols * CELL;
    const H = spec.rows * CELL;
    const maxDim = Math.max(spec.cols, spec.rows);

    // Coordinate ticks: every cell on small maps, every third cell on large ones.
    const step = maxDim <= 45 ? 1 : 3;
    const ppc = clamp(Math.floor(4096 / maxDim), 24, 64);
    const fontPx = Math.round(step === 1 ? ppc * 0.5 : ppc * 1.05);
    const xDepth = step === 1 ? 1.0 : 1.7;
    const yWidth = step === 1 ? 1.25 : 2.3;
    const border = Math.max(xDepth, yWidth) + 0.4;

    const slabW = W + border * 2;
    const slabH = H + border * 2;

    // Raised slab: earth-brown sides, dark green border on top.
    const slab = new THREE.Mesh(own(new THREE.BoxGeometry(slabW, SLAB_DEPTH, slabH)), [
      earthSide,
      earthSide,
      borderTop,
      earthSide,
      earthSide,
      earthSide,
    ]);
    slab.position.y = SLAB_TOP - SLAB_DEPTH / 2;
    slab.receiveShadow = shadows;
    group.add(slab);

    // Playable grid. UV origin = bottom-left corner, one texture tile per 3 cells.
    const gridGeo = own(new THREE.PlaneGeometry(W, H));
    gridGeo.rotateX(-Math.PI / 2);
    gridTex.repeat.set(spec.cols / 3, spec.rows / 3);
    const gridMesh = new THREE.Mesh(gridGeo, gridMat);
    gridMesh.receiveShadow = shadows;
    group.add(gridMesh);

    group.add(tickStrip(own, 'x', spec, ppc, step, fontPx, xDepth), tickStrip(own, 'y', spec, ppc, step, fontPx, yWidth));

    // Red corner posts, echoing the corner brackets of the 2D frame.
    const postGeo = own(new THREE.BoxGeometry(0.22, 0.5, 0.22));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, cornerMat);
        post.position.set(sx * (slabW / 2 - 0.11), SLAB_TOP + 0.25, sz * (slabH / 2 - 0.11));
        group.add(post);
      }

    // Lower outer land + water.
    const treeScale = clamp(maxDim / 26, 1, 3.2);
    const margin = clamp(maxDim * 0.5, 12, 40);
    const ox = slabW / 2 + margin;
    const oz = slabH / 2 + margin;
    const outer = new THREE.Mesh(own(new THREE.BoxGeometry(ox * 2, OUTER_DEPTH, oz * 2)), [
      earthSide,
      earthSide,
      outerTop,
      earthSide,
      earthSide,
      earthSide,
    ]);
    outer.position.y = OUTER_TOP - OUTER_DEPTH / 2;
    outer.receiveShadow = shadows;
    group.add(outer);

    const waterSize = Math.max(300, Math.max(ox, oz) * 6);
    const waterGeo = own(new THREE.PlaneGeometry(waterSize, waterSize));
    waterGeo.rotateX(-Math.PI / 2);
    water.uniforms.uScale.value = treeScale * 1.6;
    const waterMesh = new THREE.Mesh(waterGeo, water);
    waterMesh.position.y = WATER_Y;
    group.add(waterMesh);

    // Jungle ring (instanced). Trees stay further back on the two edges that
    // carry the coordinate ticks so the numbers are not hidden from the default view.
    {
      const ringArea = 4 * ox * oz - slabW * slabH;
      const count = Math.round(clamp((ringArea * 0.42) / (treeScale * treeScale), 90, opts.highQuality ? 900 : 360));
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
      const crownsA = new THREE.InstancedMesh(canopyGeoA, canopyMat, count);
      const crownsB = new THREE.InstancedMesh(canopyGeoB, canopyMat, count);
      const nearClear = 3 * treeScale + 0.5;
      const farClear = 0.9 * treeScale;
      let placed = 0;
      let a = 0;
      let b = 0;
      let guard = 0;
      while (placed < count && guard++ < count * 40) {
        const x = (rand() * 2 - 1) * (ox - 0.8);
        const z = (rand() * 2 - 1) * (oz - 0.8);
        const inX = x > -(slabW / 2 + nearClear) && x < slabW / 2 + farClear;
        const inZ = z > -(slabH / 2 + farClear) && z < slabH / 2 + nearClear;
        if (inX && inZ) continue;
        const h = (1 + rand() * 1.4) * treeScale;
        const s = (0.7 + rand() * 0.8) * treeScale;
        _m.compose(_p.set(x, OUTER_TOP, z), _q.identity(), _s.set(treeScale, h, treeScale));
        trunks.setMatrixAt(placed, _m);
        _c.copy(GREENS[Math.floor(rand() * GREENS.length)]).multiplyScalar(0.82);
        if (rand() < 0.62) {
          _q.setFromEuler(_e.set(rand(), rand() * 6, rand()));
          _m.compose(_p.set(x, OUTER_TOP + h + s * 0.6, z), _q, _s.set(s, s * 1.1, s));
          crownsA.setMatrixAt(a, _m);
          crownsA.setColorAt(a++, _c);
        } else {
          _q.setFromEuler(_e.set(0, rand() * 6, 0));
          _m.compose(_p.set(x, OUTER_TOP + h + s * 0.9, z), _q, _s.set(s, s, s));
          crownsB.setMatrixAt(b, _m);
          crownsB.setColorAt(b++, _c);
        }
        placed++;
      }
      trunks.count = placed;
      crownsA.count = a;
      crownsB.count = b;
      for (const im of [trunks, crownsA, crownsB]) {
        im.castShadow = shadows;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        instanced.push(im);
        group.add(im);
      }
    }

    // A few glowing mushrooms hugging the slab.
    {
      const n = Math.round(clamp((slabW + slabH) / 5, 8, 26));
      const ms = Math.pow(treeScale, 0.7);
      const stems = new THREE.InstancedMesh(stemGeo, stemMat, n);
      const caps = capMats.map((mat) => new THREE.InstancedMesh(capGeo, mat, n));
      const capCount = caps.map(() => 0);
      for (let i = 0; i < n; i++) {
        const side = Math.floor(rand() * 4);
        const out = (0.5 + rand() * 1.6) * ms;
        const alongX = (rand() * 2 - 1) * (slabW / 2 + out);
        const alongZ = (rand() * 2 - 1) * (slabH / 2 + out);
        const x = side === 0 ? -(slabW / 2 + out) : side === 1 ? slabW / 2 + out : alongX;
        const z = side === 2 ? -(slabH / 2 + out) : side === 3 ? slabH / 2 + out : alongZ;
        const s = (0.4 + rand() * 0.45) * ms;
        _m.compose(_p.set(x, OUTER_TOP, z), _q.identity(), _s.set(s, s, s));
        stems.setMatrixAt(i, _m);
        const ci = Math.floor(rand() * caps.length);
        _m.compose(_p.set(x, OUTER_TOP + 1.05 * s, z), _q, _s.set(s, s * 0.8, s));
        caps[ci].setMatrixAt(capCount[ci]++, _m);
      }
      caps.forEach((im, i) => (im.count = capCount[i]));
      for (const im of [stems, ...caps]) {
        im.castShadow = shadows;
        im.instanceMatrix.needsUpdate = true;
        instanced.push(im);
        group.add(im);
      }
    }

    // Drifting spores over the map.
    const sporeHeight = 12 * Math.pow(treeScale, 0.6);
    const sporeMat = own(sporeMaterial(opts.pixelRatio, sporeHeight));
    {
      const count = Math.round(clamp(W * H * 0.9, 220, opts.highQuality ? 1100 : 450));
      const pos = new Float32Array(count * 3);
      const seed = new Float32Array(count);
      const sx = slabW + margin * 0.8;
      const sz = slabH + margin * 0.8;
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (rand() - 0.5) * sx;
        pos[i * 3 + 1] = rand() * sporeHeight;
        pos[i * 3 + 2] = (rand() - 0.5) * sz;
        seed[i] = rand();
      }
      const geo = own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      const spores = new THREE.Points(geo, sporeMat);
      spores.frustumCulled = false;
      group.add(spores);
    }

    return {
      group,
      halfX: W / 2,
      halfZ: H / 2,
      slabHalfX: slabW / 2,
      slabHalfZ: slabH / 2,
      tick(t) {
        water.uniforms.uTime.value = t;
        sporeMat.uniforms.uTime.value = t;
      },
      setPixelRatio(r) {
        sporeMat.uniforms.uPixelRatio.value = r;
      },
      setSporeScale(s) {
        sporeMat.uniforms.uScale.value = s;
      },
      dispose() {
        group.removeFromParent();
        for (const im of instanced) im.dispose();
        for (const d of local) d.dispose();
        group.clear();
      },
    };
  }

  /* Placed items --------------------------------------------------- */
  function buildItems(spec: GroundSpec, specs: ItemSpec[]): ItemsBuild {
    const group = new THREE.Group();
    const instanced: THREE.InstancedMesh[] = [];
    const items: ItemRuntime[] = [];
    /** Per item: the instances to tint when it is hovered. */
    const refs: { mesh: THREE.InstancedMesh; index: number; color: THREE.Color }[][] = [];
    let maxHeight = 0;

    for (const entry of symbolCache.values()) entry.used = false;

    const add = (im: THREE.InstancedMesh, cast: boolean) => {
      im.castShadow = cast && shadows;
      im.receiveShadow = cast && shadows;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      instanced.push(im);
      group.add(im);
    };

    // Index items by kind / squad first so every InstancedMesh gets its exact count.
    const bySquad = new Map<Squad, number[]>();
    const objectIdx: number[] = [];
    specs.forEach((s, i) => {
      const center = footprintCenter(spec, s.x, s.y, s.size);
      items.push({ spec: s, center, height: 1, box: new THREE.Box3() });
      refs.push([]);
      if (s.kind === 'player') {
        const squad = s.squad && SQUADS.includes(s.squad) ? s.squad : 'R5';
        let list = bySquad.get(squad);
        if (!list) bySquad.set(squad, (list = []));
        list.push(i);
      } else objectIdx.push(i);
    });

    // Player bases: body + glow per squad, one shared flag mesh, one gem mesh.
    const playerTotal = specs.length - objectIdx.length;
    const gems: { x: number; y: number; z: number; phase: number }[] = [];
    let gemMesh: THREE.InstancedMesh | null = null;
    if (playerTotal > 0) {
      const flags = new THREE.InstancedMesh(flagGeo, flagMat, playerTotal);
      let f = 0;
      for (const [squad, list] of bySquad) {
        const bp = baseBlueprint(squad);
        const body = new THREE.InstancedMesh(bp.body, bodyMat, list.length);
        const glow = new THREE.InstancedMesh(bp.glow, glowMat, list.length);
        const flagColor = new THREE.Color(SQUAD_COLORS[squad]);
        list.forEach((itemIndex, n) => {
          const it = items[itemIndex];
          _m.makeTranslation(it.center.x, 0, it.center.z);
          body.setMatrixAt(n, _m);
          glow.setMatrixAt(n, _m);
          body.setColorAt(n, WHITE);
          _m.makeTranslation(it.center.x, bp.flagY, it.center.z);
          flags.setMatrixAt(f, _m);
          flags.setColorAt(f, flagColor);
          refs[itemIndex].push({ mesh: body, index: n, color: WHITE }, { mesh: flags, index: f, color: flagColor });
          f++;
          it.height = bp.height;
          if (bp.gemY !== null) gems.push({ x: it.center.x, y: bp.gemY, z: it.center.z, phase: (it.center.x * 0.37 + it.center.z * 0.61) % 6.28 });
        });
        add(body, true);
        add(glow, false);
      }
      add(flags, false);
      if (gems.length) {
        gemMesh = new THREE.InstancedMesh(gemGeo, goldMat, gems.length);
        gemMesh.frustumCulled = false;
        add(gemMesh, false);
      }
    }

    // Objects: stone / accent / glow instanced meshes + one symbol billboard each.
    if (objectIdx.length) {
      const geos = objectGeos();
      const stone = new THREE.InstancedMesh(geos.stone, bodyMat, objectIdx.length);
      const accent = new THREE.InstancedMesh(geos.accent, bodyMat, objectIdx.length);
      const glow = new THREE.InstancedMesh(geos.glow, glowMat, objectIdx.length);
      objectIdx.forEach((itemIndex, n) => {
        const it = items[itemIndex];
        const size = it.spec.size;
        const ys = Math.pow(size, 0.6);
        _m.compose(_p.set(it.center.x, 0, it.center.z), _q.identity(), _s.set(size * CELL, ys, size * CELL));
        stone.setMatrixAt(n, _m);
        accent.setMatrixAt(n, _m);
        glow.setMatrixAt(n, _m);
        const col = new THREE.Color(it.spec.color);
        const stoneCol = STONE.clone().lerp(col, 0.35);
        const glowCol = col.clone().lerp(WHITE, 0.2).multiplyScalar(1.6);
        stone.setColorAt(n, stoneCol);
        accent.setColorAt(n, col);
        glow.setColorAt(n, glowCol);
        refs[itemIndex].push(
          { mesh: stone, index: n, color: stoneCol },
          { mesh: accent, index: n, color: col },
          { mesh: glow, index: n, color: glowCol },
        );
        const sprite = new THREE.Sprite(symbolMaterial(it.spec.symbol ?? '', it.spec.color));
        const ss = clamp(0.5 + 0.55 * Math.pow(size, 0.75), 0.9, 6);
        const top = OBJECT_UNIT_HEIGHT * ys;
        sprite.scale.set(ss, ss, 1);
        sprite.position.set(it.center.x, top + ss * 0.56, it.center.z);
        group.add(sprite);
        it.height = top + ss * 1.08;
      });
      add(stone, true);
      add(accent, true);
      add(glow, false);
    }

    // Drop billboard textures that no longer have a user.
    for (const [key, entry] of symbolCache) {
      if (entry.used) continue;
      entry.mat.dispose();
      entry.tex.dispose();
      symbolCache.delete(key);
    }

    for (const it of items) {
      const half = (it.spec.size * CELL) / 2;
      it.box.min.set(it.center.x - half, 0, it.center.z - half);
      it.box.max.set(it.center.x + half, it.height, it.center.z + half);
      maxHeight = Math.max(maxHeight, it.height);
    }

    let highlighted: number | null = null;
    const paint = (index: number, boost: number) => {
      for (const r of refs[index] ?? []) {
        r.mesh.setColorAt(r.index, _c.copy(r.color).multiplyScalar(boost));
        if (r.mesh.instanceColor) r.mesh.instanceColor.needsUpdate = true;
      }
    };

    return {
      group,
      items,
      maxHeight,
      setHighlight(index) {
        if (index === highlighted) return;
        if (highlighted !== null) paint(highlighted, 1);
        highlighted = index;
        if (index !== null) paint(index, 1.55);
      },
      tick(t) {
        if (!gemMesh) return;
        for (let i = 0; i < gems.length; i++) {
          const gm = gems[i];
          _q.setFromAxisAngle(Y_AXIS, t * 1.5 + gm.phase);
          _m.compose(_p.set(gm.x, gm.y + Math.sin(t * 1.6 + gm.phase) * 0.08, gm.z), _q, _s.set(1, 1.25, 1));
          gemMesh.setMatrixAt(i, _m);
        }
        gemMesh.instanceMatrix.needsUpdate = true;
      },
      dispose() {
        group.removeFromParent();
        for (const im of instanced) im.dispose();
        group.clear();
      },
    };
  }

  return {
    buildGround,
    buildItems,
    tick(t) {
      flagTime.value = t;
    },
    dispose() {
      for (const entry of symbolCache.values()) {
        entry.mat.dispose();
        entry.tex.dispose();
      }
      symbolCache.clear();
      for (const d of shared) d.dispose();
    },
  };
}
