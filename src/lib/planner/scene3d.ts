/**
 * 3D view of the alliance map planner.
 *
 * Loaded lazily (dynamic import from app.ts) the first time the user switches
 * to 3D, so `three` never weighs on the default 2D planner. The scene owns no
 * planner state: app.ts pushes a model in via `update()` and all placement
 * rules are answered by the host callbacks (the same canPlace as the 2D grid).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CELL, createAssetKit, type GroundBuild, type GroundSpec, type ItemSpec, type ItemsBuild } from './assets3d';
import { getTheme, onThemeChange, type Theme } from '../theme';

export type { ItemSpec };

export interface Planner3DModel extends GroundSpec {
  items: ItemSpec[];
}

export interface Planner3DHost {
  /** Footprint (in cells) of the unit selected in the roster, or null when nothing is selected. */
  selectionSize(): number | null;
  /** The pointer marks the footprint centre: top-left anchor of a size×size footprint centred on this cell. */
  anchorFor(gx: number, gy: number, size: number): { x: number; y: number };
  /** Same rule as the 2D grid: can a size×size footprint be anchored at this cell? */
  canPlace(ax: number, ay: number, size: number): boolean;
  /** Deploy the selected unit with its anchor at this cell. */
  place(ax: number, ay: number): void;
  /** Withdraw the placement with this "x,y" key. */
  remove(key: string): void;
}

export interface Planner3DOptions {
  canvasRoot: HTMLElement;
  labelRoot: HTMLElement;
  host: Planner3DHost;
}

export interface Planner3DHandle {
  /** Rebuild the scene from the current planner state. */
  update(model: Planner3DModel): void;
  /** The roster selection changed (card click, ESC…): refresh the footprint preview. */
  selectionChanged(): void;
  resetView(): void;
  /** Pause / resume rendering when the 3D view is hidden / shown. */
  setActive(active: boolean): void;
  dispose(): void;
}

const CLICK_SLOP = 6; // px of pointer travel that still counts as a click (not an orbit drag)
const HOME_DIR = new THREE.Vector3(0, 0.8, 0.6).normalize();
const UP = new THREE.Vector3(0, 1, 0);

/** Renderer, fog, lights and bloom per site theme (the asset kit has its own palette). */
interface ScenePalette {
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
  bloomStrength: number;
  bloomThreshold: number;
  /** Footprint preview: green = fits, red = blocked. */
  previewOk: number;
  previewBad: number;
  previewOpacity: number;
}

const SCENE_PALETTES: Record<Theme, ScenePalette> = {
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
    bloomStrength: 0.45,
    bloomThreshold: 0.85,
    previewOk: 0x3fbf6a,
    previewBad: 0xff4d57,
    previewOpacity: 0.42,
  },
  // Daytime: pale sky haze and strong sunlight. Bloom only catches real
  // highlights (windows, beacons, gems): a threshold of 1 keeps plain white
  // surfaces such as the symbol badges from glowing.
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
    bloomStrength: 0.22,
    bloomThreshold: 1,
    // The sunlit grass is about as bright as the night "ok" green: use a deep green.
    previewOk: 0x0b6b2c,
    previewBad: 0xe5303b,
    previewOpacity: 0.5,
  },
};

export function createPlannerScene(opts: Planner3DOptions): Planner3DHandle {
  const { canvasRoot: container, labelRoot, host } = opts;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const highQuality = !coarse && cores >= 4;
  const shadows = highQuality;
  const motion = reducedMotion ? 0 : 1; // ambient animation (water, spores, flags, gems) is frozen
  let theme: Theme = getTheme();
  let pal = SCENE_PALETTES[theme];

  /* Renderer ------------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(pal.clear);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = pal.exposure;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // the scene is static between rebuilds
  const maxDpr = () => Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
  renderer.setPixelRatio(maxDpr());
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(pal.fog, 0.016);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  const HOME_POS = new THREE.Vector3();
  const HOME_TARGET = new THREE.Vector3(0, 0, 0);
  let homeDist = 30;
  camera.position.copy(HOME_DIR).multiplyScalar(homeDist);
  camera.lookAt(HOME_TARGET);

  /* Lights --------------------------------------------------------- */
  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiIntensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(pal.sun, pal.sunIntensity);
  const SUN_DIR = new THREE.Vector3(-20, 34, 16).normalize();
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(pal.rim, pal.rimIntensity);
  rim.position.set(24, 10, -30);
  scene.add(rim);

  /* Assets --------------------------------------------------------- */
  const css = getComputedStyle(container);
  const cssVar = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const kit = createAssetKit({
    highQuality,
    shadows,
    pixelRatio: renderer.getPixelRatio(),
    maxAnisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    monoFont: cssVar('--mono', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'),
    theme,
    tickMajorColor: () => cssVar('--merah-text', '#ff8a92'),
  });

  let spec: GroundSpec | null = null;
  let ground: GroundBuild | null = null;
  let built: ItemsBuild | null = null;
  /** Grid cell "x,y" → index of the item covering it. */
  const cellOwner = new Map<string, number>();

  // Footprint preview (green = fits, red = blocked) and hover outline.
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  unitPlane.rotateX(-Math.PI / 2);
  const previewMat = new THREE.MeshBasicMaterial({
    color: pal.previewOk,
    transparent: true,
    opacity: pal.previewOpacity,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const preview = new THREE.Mesh(unitPlane, previewMat);
  preview.position.y = 0.04;
  preview.renderOrder = 2;
  preview.visible = false;
  const outlineGeo = new THREE.BufferGeometry().setFromPoints(
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  );
  const previewLineMat = new THREE.LineBasicMaterial({ color: pal.previewOk, toneMapped: false, depthTest: false, transparent: true });
  let previewFits = true; // state shown by the footprint preview (recoloured on a theme change)
  const previewLine = new THREE.LineLoop(outlineGeo, previewLineMat);
  previewLine.position.y = 0.05;
  previewLine.renderOrder = 3;
  previewLine.visible = false;
  const hoverLineMat = new THREE.LineBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false, transparent: true, opacity: 0.9 });
  const hoverLine = new THREE.LineLoop(outlineGeo, hoverLineMat);
  hoverLine.position.y = 0.05;
  hoverLine.renderOrder = 3;
  hoverLine.visible = false;
  scene.add(preview, previewLine, hoverLine);

  /* Post-processing ------------------------------------------------ */
  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  if (highQuality) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), pal.bloomStrength, 0.5, pal.bloomThreshold);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  /* Controls ------------------------------------------------------- */
  let userInteracted = false;
  let focus: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  let labelsDirty = true;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;
  controls.maxDistance = 80;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.36;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.target.copy(HOME_TARGET);
  controls.addEventListener('start', () => {
    userInteracted = true;
    focus = null;
  });
  controls.addEventListener('change', () => {
    // Keep the orbit target on the map so panning can never lose it.
    const t = controls.target;
    const hx = ground ? ground.halfX : 5;
    const hz = ground ? ground.halfZ : 5;
    t.x = THREE.MathUtils.clamp(t.x, -hx, hx);
    t.z = THREE.MathUtils.clamp(t.z, -hz, hz);
    t.y = THREE.MathUtils.clamp(t.y, 0, 3);
    labelsDirty = true;
  });

  /* Framing -------------------------------------------------------- */
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  /** Distance at which the whole slab (plus the tallest building) fits the viewport from the home angle. */
  function computeHome() {
    const hx = ground ? ground.slabHalfX : 6;
    const hz = ground ? ground.slabHalfZ : 6;
    const top = Math.max(3, built ? built.maxHeight : 0);
    const fwd = tmp2.copy(HOME_DIR).negate();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * camera.aspect;
    let d = 4;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (const y of [0, top]) {
          tmp.set(sx * hx, y, sz * hz);
          const z = tmp.dot(fwd);
          d = Math.max(d, Math.abs(tmp.dot(right)) / tanH - z, Math.abs(tmp.dot(up)) / tanV - z);
        }
    homeDist = d * 1.1;
    HOME_POS.copy(HOME_DIR).multiplyScalar(homeDist);
    controls.maxDistance = homeDist * 1.6;
    camera.far = Math.max(400, homeDist * 6);
    updateFogDensity();
    ground?.setSporeScale(Math.max(1, homeDist / 60));
  }

  function updateFogDensity() {
    fog.density = (0.45 / homeDist) * pal.fogScale;
  }

  function snapHome() {
    focus = null;
    controls.target.copy(HOME_TARGET);
    camera.position.copy(HOME_POS);
    camera.lookAt(HOME_TARGET);
    labelsDirty = true;
  }

  function fitShadows() {
    const hx = ground ? ground.slabHalfX : 6;
    const hz = ground ? ground.slabHalfZ : 6;
    const radius = Math.hypot(hx, hz) + 4;
    sun.position.copy(SUN_DIR).multiplyScalar(radius * 1.6 + 20);
    sun.target.position.set(0, 0, 0);
    if (shadows) {
      const sc = sun.shadow.camera;
      sc.left = sc.bottom = -radius;
      sc.right = sc.top = radius;
      sc.near = 1;
      sc.far = radius * 3.2 + 40;
      sc.updateProjectionMatrix();
    }
    rim.position.set(24, 10, -30).normalize().multiplyScalar(radius + 30);
  }

  /* Labels --------------------------------------------------------- */
  let labels: HTMLElement[] = [];
  let labelState: string[] = [];
  /** Unscaled label boxes: [width, full height, height without the coordinate line]. */
  let labelSize: [number, number, number][] = [];
  type Candidate = { i: number; x: number; y: number; z: number; scale: number; compact: boolean; hot: boolean };
  const candidates: Candidate[] = [];
  const keptRects: number[] = []; // flat [left, top, right, bottom, …]

  function buildLabels() {
    labelRoot.replaceChildren();
    labels = [];
    labelState = [];
    labelSize = [];
    if (!built) return;
    const frag = document.createDocumentFragment();
    for (const it of built.items) {
      const s = it.spec;
      const el = document.createElement('div');
      el.className = 'pl-3d-label' + (s.kind === 'object' ? ' is-object' : '');
      el.style.setProperty('--c', s.color);
      const name = document.createElement('span');
      name.className = 'nm';
      const tag = document.createElement('span');
      tag.className = 'tg';
      tag.textContent = s.kind === 'object' ? (s.symbol ?? '') : (s.squad ?? ''); // textContent: user strings never become HTML
      const text = document.createElement('span');
      text.className = 'tx';
      text.textContent = s.name;
      name.append(tag, text);
      const coord = document.createElement('span');
      coord.className = 'co';
      coord.textContent = s.coord;
      el.append(name, coord);
      el.style.visibility = 'hidden';
      frag.appendChild(el);
      labels.push(el);
      labelState.push('');
    }
    labelRoot.appendChild(frag);
    // One layout pass to learn the label sizes (used to keep labels from piling up).
    labelSize = labels.map((el) => {
      const co = el.lastElementChild as HTMLElement | null;
      return [el.offsetWidth, el.offsetHeight, el.offsetHeight - (co ? co.offsetHeight + 1 : 0)];
    });
    labelsDirty = true;
  }

  function hideLabel(i: number) {
    if (labelState[i] === 'off') return;
    labels[i].style.visibility = 'hidden';
    labelState[i] = 'off';
  }

  function projectLabels() {
    labelsDirty = false;
    if (!built || !labels.length) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    camera.updateMatrixWorld();
    candidates.length = 0;
    for (let i = 0; i < labels.length; i++) {
      const it = built.items[i];
      tmp.set(it.center.x, it.height + 0.3, it.center.z);
      const depth = -tmp2.copy(tmp).applyMatrix4(camera.matrixWorldInverse).z;
      tmp.project(camera);
      // Behind the camera or well outside the viewport: hide.
      if (depth <= camera.near || tmp.z > 1 || Math.abs(tmp.x) > 1.2 || Math.abs(tmp.y) > 1.3) {
        hideLabel(i);
        continue;
      }
      // Shrink (and drop the coordinate line) when the building gets small on screen.
      const px = (it.spec.size * CELL * h) / (2 * tanV * depth);
      const hot = i === hovered;
      candidates.push({
        i,
        x: ((tmp.x + 1) / 2) * w,
        y: ((1 - tmp.y) / 2) * h,
        z: tmp.z,
        scale: hot ? 1 : THREE.MathUtils.clamp(px / 58, 0.62, 1),
        compact: !hot && px < 30,
        hot,
      });
    }

    // Declutter: nearest labels win; one that would mostly cover an already kept label is
    // hidden until the user zooms in or hovers its building.
    candidates.sort((a, b) => (a.hot === b.hot ? a.z - b.z : a.hot ? -1 : 1));
    keptRects.length = 0;
    for (const c of candidates) {
      const [lw, lh, lhCompact] = labelSize[c.i];
      const bw = lw * c.scale;
      const bh = (c.compact ? lhCompact : lh) * c.scale;
      const left = c.x - bw / 2;
      const top = c.y - bh;
      let covered = false;
      if (!c.hot) {
        for (let k = 0; k < keptRects.length; k += 4) {
          const ix = Math.min(left + bw, keptRects[k + 2]) - Math.max(left, keptRects[k]);
          const iy = Math.min(c.y, keptRects[k + 3]) - Math.max(top, keptRects[k + 1]);
          if (ix <= 0 || iy <= 0) continue;
          const other = (keptRects[k + 2] - keptRects[k]) * (keptRects[k + 3] - keptRects[k + 1]);
          if (ix * iy > 0.3 * Math.min(bw * bh, other)) {
            covered = true;
            break;
          }
        }
      }
      if (covered) {
        hideLabel(c.i);
        continue;
      }
      keptRects.push(left, top, left + bw, c.y);
      const state = `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.scale.toFixed(2)},${c.compact ? 1 : 0},${c.hot ? 1 : 0}`;
      if (labelState[c.i] === state) continue;
      const el = labels[c.i];
      if (labelState[c.i] === 'off' || labelState[c.i] === '') el.style.visibility = 'visible';
      labelState[c.i] = state;
      el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-50%, -100%) scale(${c.scale.toFixed(2)})`;
      el.style.zIndex = c.hot ? '100000' : String(Math.round((1 - c.z) * 10000));
      el.classList.toggle('is-compact', c.compact);
      el.classList.toggle('is-hover', c.hot);
    }
  }

  /* Picking, hover, placement ------------------------------------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(UP, 0);
  let hovered: number | null = null;
  let pointer: { x: number; y: number } | null = null; // last mouse position over the canvas
  let flashUntil = 0;

  function setRay(clientX: number, clientY: number) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function cellUnderRay(): { gx: number; gy: number } | null {
    if (!spec) return null;
    const hit = raycaster.ray.intersectPlane(groundPlane, tmp);
    if (!hit) return null;
    const gx = Math.floor(hit.x / CELL + spec.cols / 2);
    const gy = Math.floor(hit.z / CELL + spec.rows / 2);
    if (gx < 0 || gy < 0 || gx >= spec.cols || gy >= spec.rows) return null;
    return { gx, gy };
  }

  function itemUnderRay(): number | null {
    if (!built) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < built.items.length; i++) {
      const hit = raycaster.ray.intersectBox(built.items[i].box, tmp);
      if (!hit) continue;
      const d = hit.distanceToSquared(raycaster.ray.origin);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * What is under the pointer?
   * - With a unit selected the ground cell is authoritative (exactly like the 2D grid:
   *   a free cell is an anchor, an occupied cell belongs to the building standing on it).
   * - Otherwise buildings are picked by their volume, which feels right for tall ones.
   */
  function pick(clientX: number, clientY: number) {
    setRay(clientX, clientY);
    const size = host.selectionSize();
    const cell = cellUnderRay();
    let item: number | null = null;
    if (size === null) item = itemUnderRay();
    if (item === null && cell) item = cellOwner.get(cell.gx + ',' + cell.gy) ?? null;
    return { size, cell, item };
  }

  function showFootprint(ax: number, ay: number, size: number, ok: boolean) {
    if (!spec) return;
    // Like the 2D grid, only the part of the footprint that lies on the map is drawn.
    const x0 = Math.max(0, ax);
    const y0 = Math.max(0, ay);
    const x1 = Math.min(spec.cols, ax + size);
    const y1 = Math.min(spec.rows, ay + size);
    const w = (x1 - x0) * CELL;
    const d = (y1 - y0) * CELL;
    const cx = ((x0 + x1) / 2 - spec.cols / 2) * CELL;
    const cz = ((y0 + y1) / 2 - spec.rows / 2) * CELL;
    previewFits = ok;
    const color = ok ? pal.previewOk : pal.previewBad;
    previewMat.color.setHex(color);
    previewLineMat.color.setHex(color);
    for (const o of [preview, previewLine]) {
      o.position.x = cx;
      o.position.z = cz;
      o.scale.set(w, 1, d);
      o.visible = true;
    }
  }

  function hidePreview() {
    preview.visible = false;
    previewLine.visible = false;
  }

  function setHovered(index: number | null) {
    if (index === hovered) return;
    hovered = index;
    built?.setHighlight(index);
    if (index !== null && built) {
      const it = built.items[index];
      hoverLine.position.x = it.center.x;
      hoverLine.position.z = it.center.z;
      hoverLine.scale.set(it.spec.size * CELL, 1, it.spec.size * CELL);
      hoverLine.visible = true;
    } else hoverLine.visible = false;
    labelsDirty = true;
  }

  function refreshHover() {
    if (!pointer) {
      setHovered(null);
      if (performance.now() >= flashUntil) hidePreview();
      canvas.style.cursor = '';
      requestRender();
      return;
    }
    const { size, cell, item } = pick(pointer.x, pointer.y);
    setHovered(item);
    if (item !== null) {
      hidePreview();
      canvas.style.cursor = 'pointer';
    } else if (size !== null && cell) {
      const a = host.anchorFor(cell.gx, cell.gy, size);
      showFootprint(a.x, a.y, size, host.canPlace(a.x, a.y, size));
      canvas.style.cursor = 'crosshair';
    } else {
      if (performance.now() >= flashUntil) hidePreview();
      canvas.style.cursor = '';
    }
    requestRender();
  }

  let downAt: { x: number; y: number; id: number } | null = null;
  let activePointers = 0;
  let multiTouch = false;

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return; // touch has no hover
    pointer = { x: e.clientX, y: e.clientY };
    if (e.buttons !== 0) return; // dragging: leave the hover state alone until release
    refreshHover();
  };
  const onPointerDown = (e: PointerEvent) => {
    activePointers++;
    if (activePointers > 1) multiTouch = true;
    else {
      multiTouch = false;
      downAt = e.button === 0 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    activePointers = Math.max(0, activePointers - 1);
    const start = downAt;
    if (!start || start.id !== e.pointerId) return;
    downAt = null;
    if (multiTouch) return; // pinch / two-finger pan
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) {
      if (e.pointerType !== 'touch') refreshHover();
      return; // orbit drag, not a click
    }
    const { size, cell, item } = pick(e.clientX, e.clientY);
    if (item !== null && built) {
      host.remove(built.items[item].spec.key); // same as clicking a marker in 2D
    } else if (size !== null && cell) {
      const a = host.anchorFor(cell.gx, cell.gy, size);
      if (host.canPlace(a.x, a.y, size)) host.place(a.x, a.y);
      else {
        // Blocked: flash the footprint red, like the 2D grid does.
        showFootprint(a.x, a.y, size, false);
        flashUntil = performance.now() + 400;
        window.setTimeout(() => {
          if (performance.now() >= flashUntil) refreshHover();
        }, 420);
        requestRender();
      }
    }
  };
  const onPointerCancel = () => {
    activePointers = Math.max(0, activePointers - 1);
    downAt = null;
  };
  const onPointerLeave = () => {
    pointer = null;
    refreshHover();
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);

  /* Rebuild -------------------------------------------------------- */
  function update(model: Planner3DModel) {
    const prev = spec;
    const sizeChanged = !prev || prev.cols !== model.cols || prev.rows !== model.rows;
    const groundChanged = sizeChanged || prev.startX !== model.startX || prev.startY !== model.startY;
    spec = { cols: model.cols, rows: model.rows, startX: model.startX, startY: model.startY };

    if (groundChanged || !ground) {
      ground?.dispose();
      ground = kit.buildGround(spec);
      ground.setPixelRatio(renderer.getPixelRatio());
      scene.add(ground.group);
    }

    hovered = null;
    hoverLine.visible = false;
    built?.dispose();
    built = kit.buildItems(spec, model.items);
    built.tick(elapsed);
    scene.add(built.group);

    cellOwner.clear();
    built.items.forEach((it, i) => {
      const s = it.spec;
      for (let dy = 0; dy < s.size; dy++) for (let dx = 0; dx < s.size; dx++) cellOwner.set(s.x + dx + ',' + (s.y + dy), i);
    });

    buildLabels();
    if (groundChanged) fitShadows();
    computeHome();
    if (sizeChanged || !userInteracted) snapHome(); // a new map size always gets a fresh framing
    renderer.shadowMap.needsUpdate = true;
    refreshHover();
  }

  /* Resize & visibility ------------------------------------------- */
  let active = false;
  let inView = true;
  let contextLost = false;
  let running = false;
  let lastTime = performance.now();
  let elapsed = 0;

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w < 2 || h < 2) return; // hidden (display: none)
    renderer.setPixelRatio(maxDpr());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.9 ? 52 : 42; // keep tall / narrow stages usable
    computeHome();
    camera.updateProjectionMatrix();
    if (!userInteracted && !focus) snapHome();
    composer?.setPixelRatio(renderer.getPixelRatio());
    composer?.setSize(w, h);
    ground?.setPixelRatio(renderer.getPixelRatio());
    labelsDirty = true;
    requestRender();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    updateRunning();
  });
  io.observe(container);
  const onVisibility = () => updateRunning();
  document.addEventListener('visibilitychange', onVisibility);

  const onContextLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
    updateRunning();
  };
  const onContextRestored = () => {
    contextLost = false;
    renderer.shadowMap.needsUpdate = true;
    updateRunning();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  /* Render loop ---------------------------------------------------- */
  function renderFrame(dt: number) {
    elapsed += dt * motion;
    kit.tick(elapsed);
    ground?.tick(elapsed);
    built?.tick(elapsed);

    if (focus) {
      const a = 1 - Math.exp(-dt * 7); // frame-rate independent ease-out
      controls.target.lerp(focus.target, a);
      camera.position.lerp(focus.pos, a);
      if (camera.position.distanceTo(focus.pos) < homeDist * 0.002) {
        controls.target.copy(focus.target);
        camera.position.copy(focus.pos);
        focus = null;
      }
      labelsDirty = true;
    }
    controls.update(dt);

    // Slide the near plane with the zoom level so far-away framing keeps its depth precision.
    const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.05, 0.1, 6);
    if (Math.abs(near - camera.near) > near * 0.1 || camera.far !== lastFar) {
      camera.near = near;
      lastFar = camera.far;
      camera.updateProjectionMatrix();
      labelsDirty = true;
    }

    if (labelsDirty) projectLabels();
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
  }
  let lastFar = camera.far;

  function loop() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    renderFrame(dt);
  }

  /** Draw one frame even while the loop is paused (e.g. state changed in a background tab). */
  function requestRender() {
    if (!running && active && !contextLost && container.clientWidth > 1) renderFrame(0);
  }

  function updateRunning() {
    const should = active && inView && !document.hidden && !contextLost;
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

  /* Theme ---------------------------------------------------------- */
  // Follow the site theme live (header toggle or OS change), no rebuild needed.
  function applyTheme(next: Theme) {
    if (next === theme) return;
    theme = next;
    pal = SCENE_PALETTES[next];
    renderer.setClearColor(pal.clear);
    renderer.toneMappingExposure = pal.exposure;
    fog.color.setHex(pal.fog);
    updateFogDensity();
    hemi.color.setHex(pal.hemiSky);
    hemi.groundColor.setHex(pal.hemiGround);
    hemi.intensity = pal.hemiIntensity;
    sun.color.setHex(pal.sun);
    sun.intensity = pal.sunIntensity;
    rim.color.setHex(pal.rim);
    rim.intensity = pal.rimIntensity;
    if (bloom) {
      bloom.strength = pal.bloomStrength;
      bloom.threshold = pal.bloomThreshold;
    }
    const previewColor = previewFits ? pal.previewOk : pal.previewBad;
    previewMat.color.setHex(previewColor);
    previewMat.opacity = pal.previewOpacity;
    previewLineMat.color.setHex(previewColor);
    kit.setTheme(next); // ground, water, tick labels, symbol badges, spores
    requestRender();
  }
  const offTheme = onThemeChange(applyTheme);

  /* Public API ----------------------------------------------------- */
  return {
    update,
    selectionChanged() {
      refreshHover();
    },
    resetView() {
      computeHome();
      userInteracted = false;
      if (reducedMotion) snapHome();
      else focus = { pos: HOME_POS.clone(), target: HOME_TARGET.clone() };
      requestRender();
    },
    setActive(v) {
      active = v;
      if (v) resize();
      else {
        pointer = null;
        downAt = null;
        activePointers = 0;
      }
      updateRunning();
    },
    dispose() {
      active = false;
      offTheme();
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();
      composer?.dispose();
      built?.dispose();
      ground?.dispose();
      kit.dispose();
      unitPlane.dispose();
      outlineGeo.dispose();
      previewMat.dispose();
      previewLineMat.dispose();
      hoverLineMat.dispose();
      labelRoot.replaceChildren();
      renderer.dispose();
      canvas.remove();
    },
  };
}
