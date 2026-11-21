import * as THREE from 'three';

/**
 * Latar 3D situs: jalan setapak di dalam hutan hujan, kamera berjalan pelan
 * tanpa henti. Dibuat murni dari kode (tanpa file model/tekstur) dengan gaya
 * low-poly yang sama dengan Peta 3D. Sengaja ringan: tanpa bayangan, tanpa
 * post-processing, semua vegetasi di-instance, dibatasi ~30 fps.
 */

export interface BackdropOptions {
  /** false = gambar satu frame diam saja (hemat baterai / reduced motion). */
  animate: boolean;
}

export interface BackdropHandle {
  dispose(): void;
}

const CHUNK = 90; // panjang satu potongan hutan (sumbu z)
const HALF_W = 46;
const LEAD = 10; // hutan yang masih ada di belakang kamera
const SPEED = 1.1; // unit per detik
const FRAME = 1 / 30;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Posisi x jalan setapak; periodik sepanjang CHUNK supaya sambungannya mulus. */
const pathX = (z: number) => Math.sin((z / CHUNK) * Math.PI * 2) * 4 + Math.sin((z / CHUNK) * Math.PI * 4) * 1.5;

function sporeMaterial(pixelRatio: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uHeight: { value: 12 },
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
        float speed = 0.2 + aSeed * 0.4;
        p.y = mod(p.y + uTime * speed, uHeight);
        p.x += sin(uTime * 0.5 + aSeed * 40.0) * 0.8;
        p.z += cos(uTime * 0.4 + aSeed * 23.0) * 0.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.5 + aSeed * 3.5) * uPixelRatio * (22.0 / max(1.0, -mv.z));
        vSeed = aSeed;
        vFade = smoothstep(0.0, 1.2, p.y)
              * (1.0 - smoothstep(uHeight - 3.0, uHeight, p.y))
              * (1.0 - smoothstep(22.0, 46.0, -mv.z));
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
        vec3 col = mix(lime, pink, step(0.72, vSeed)) * 1.4;
        gl_FragColor = vec4(col, a * vFade * 0.85);
      }
    `,
  });
}

export function createBackdrop(container: HTMLElement, opts: BackdropOptions): BackdropHandle {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  /* Renderer ------------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: !coarse, powerPreference: 'low-power' });
  renderer.setClearColor(0x07170f);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const dpr = () => Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.25);
  renderer.setPixelRatio(dpr());
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a2417, 0.032);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 160);

  scene.add(new THREE.HemisphereLight(0xbfe8d0, 0x08180f, 0.95));
  const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
  sun.position.set(-12, 30, 8);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x5fc4ff, 0.5);
  rim.position.set(20, 8, -20);
  scene.add(rim);

  /* Ground --------------------------------------------------------- */
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(400, 400)),
    track(new THREE.MeshStandardMaterial({ color: 0x143a22, roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  /* Shared geometry & materials ----------------------------------- */
  const trunkGeo = track(new THREE.CylinderGeometry(0.22, 0.4, 1, 6));
  trunkGeo.translate(0, 0.5, 0);
  const crownGeoA = track(new THREE.IcosahedronGeometry(1, 0));
  const crownGeoB = track(new THREE.ConeGeometry(0.9, 2.2, 6));
  const stemGeo = track(new THREE.CylinderGeometry(0.12, 0.2, 1.1, 6));
  stemGeo.translate(0, 0.55, 0);
  const capGeo = track(new THREE.SphereGeometry(0.62, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));

  const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1, flatShading: true }));
  const leafMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }));
  const stemMat = track(new THREE.MeshStandardMaterial({ color: 0xd9d2bf, roughness: 0.7 }));
  const capMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));

  const greens = [0x1f5e36, 0x2d7a43, 0x3d8f4f, 0x24502f, 0x4a9a52, 0x2f6d3a].map((c) => new THREE.Color(c));
  const glows = [0xff4fa0, 0xb36bff, 0x4fe3ff].map((c) => new THREE.Color(c));

  /* Forest chunks -------------------------------------------------- */
  // Dua potongan dengan isi identik (seed sama) dipasang berurutan dan digeser
  // seperti treadmill, jadi perjalanan kamera bisa berulang tanpa sambungan.
  const buildChunk = () => {
    const rand = mulberry32(6061);
    const group = new THREE.Group();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s3 = new THREE.Vector3();

    const TREES = coarse ? 110 : 170;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREES);
    const crownsA = new THREE.InstancedMesh(crownGeoA, leafMat, TREES * 2);
    const crownsB = new THREE.InstancedMesh(crownGeoB, leafMat, TREES);
    let nT = 0;
    let nA = 0;
    let nB = 0;
    let guard = 0;
    while (nT < TREES && guard++ < TREES * 20) {
      const z = -rand() * CHUNK;
      const x = (rand() * 2 - 1) * HALF_W;
      if (Math.abs(x - pathX(z)) < 3.4) continue;
      const h = 4 + rand() * 7.5;
      const w = 0.8 + rand() * 1.1;
      m.compose(v.set(x, 0, z), q.identity(), s3.set(w, h, w));
      trunks.setMatrixAt(nT++, m);
      const color = greens[Math.floor(rand() * greens.length)];
      const cs = 1.7 + rand() * 2;
      if (rand() < 0.68) {
        q.setFromEuler(e.set(rand(), rand() * 6, rand()));
        m.compose(v.set(x, h + cs * 0.35, z), q, s3.set(cs, cs * 1.05, cs));
        crownsA.setMatrixAt(nA, m);
        crownsA.setColorAt(nA++, color);
      } else {
        q.setFromEuler(e.set(0, rand() * 6, 0));
        m.compose(v.set(x, h + cs * 0.6, z), q, s3.set(cs, cs * 1.2, cs));
        crownsB.setMatrixAt(nB, m);
        crownsB.setColorAt(nB++, color);
      }
      // Semak di kaki sebagian pohon, supaya lantai hutan tidak kosong
      if (rand() < 0.5) {
        const bs = 0.5 + rand() * 0.9;
        q.setFromEuler(e.set(rand(), rand() * 6, rand()));
        m.compose(v.set(x + (rand() - 0.5) * 3, bs * 0.45, z + (rand() - 0.5) * 3), q, s3.set(bs * 1.3, bs, bs * 1.3));
        crownsA.setMatrixAt(nA, m);
        crownsA.setColorAt(nA++, color.clone().multiplyScalar(0.75));
      }
    }
    trunks.count = nT;
    crownsA.count = nA;
    crownsB.count = nB;

    const SHROOMS = 30;
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, SHROOMS);
    const caps = new THREE.InstancedMesh(capGeo, capMat, SHROOMS);
    for (let i = 0; i < SHROOMS; i++) {
      const z = -rand() * CHUNK;
      const side = rand() < 0.5 ? -1 : 1;
      const x = pathX(z) + side * (2.4 + rand() * 7);
      const s = 0.45 + rand() * 0.95;
      m.compose(v.set(x, 0, z), q.identity(), s3.set(s, s, s));
      stems.setMatrixAt(i, m);
      m.compose(v.set(x, 1.05 * s, z), q.identity(), s3.set(s, s * 0.8, s));
      caps.setMatrixAt(i, m);
      caps.setColorAt(i, glows[Math.floor(rand() * glows.length)]);
    }

    for (const im of [trunks, crownsA, crownsB, stems, caps]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      // Instance tersebar di seluruh potongan; culling per-mesh tidak berguna
      im.frustumCulled = false;
      track(im);
      group.add(im);
    }
    return group;
  };

  const chunkA = buildChunk();
  const chunkB = buildChunk();
  scene.add(chunkA, chunkB);

  /* Spores --------------------------------------------------------- */
  const sporeCount = coarse ? 220 : 420;
  const sporeGeo = track(new THREE.BufferGeometry());
  {
    const rand = mulberry32(99);
    const pos = new Float32Array(sporeCount * 3);
    const seed = new Float32Array(sporeCount);
    for (let i = 0; i < sporeCount; i++) {
      pos[i * 3] = (rand() - 0.5) * 50;
      pos[i * 3 + 1] = rand() * 12;
      pos[i * 3 + 2] = 3 - rand() * 48;
      seed[i] = rand();
    }
    sporeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sporeGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  }
  const sporeMat = track(sporeMaterial(renderer.getPixelRatio()));
  const spores = new THREE.Points(sporeGeo, sporeMat);
  spores.frustumCulled = false;
  scene.add(spores);

  /* Frame ---------------------------------------------------------- */
  let pointer = 0;
  let pointerSmooth = 0;
  const onPointer = (ev: PointerEvent) => {
    pointer = ev.clientX / Math.max(1, window.innerWidth) - 0.5;
  };

  const render = (t: number, dt: number) => {
    const offset = (t * SPEED) % CHUNK;
    chunkA.position.z = offset + LEAD;
    chunkB.position.z = offset + LEAD - CHUNK;
    const localZ = -(offset + LEAD); // posisi kamera di dalam potongan

    pointerSmooth += (pointer - pointerSmooth) * Math.min(1, dt * 2);
    const scroll = Math.min(2, window.scrollY / Math.max(1, window.innerHeight));

    camera.position.set(pathX(localZ), 2.3 + Math.sin(t * 0.7) * 0.08 + scroll * 0.5, 0);
    camera.lookAt(pathX(localZ - 14) + pointerSmooth * 5, 3 + scroll * 0.9, -14);
    camera.rotation.z = Math.sin(t * 0.23) * 0.012;

    sporeMat.uniforms.uTime.value = t;
    renderer.render(scene, camera);
  };

  /* Loop, resize, visibility --------------------------------------- */
  let elapsed = 7; // mulai di titik yang komposisinya enak dilihat
  let last = performance.now();
  let acc = 0;
  let running = false;

  const loop = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    acc += dt;
    if (acc < FRAME) return;
    elapsed += acc;
    render(elapsed, acc);
    acc = 0;
  };

  const updateRunning = () => {
    const should = opts.animate && !document.hidden;
    if (should && !running) {
      running = true;
      last = performance.now();
      acc = 0;
      renderer.setAnimationLoop(loop);
    } else if (!should && running) {
      running = false;
      renderer.setAnimationLoop(null);
    }
  };

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(dpr());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 68 : 55;
    camera.updateProjectionMatrix();
    sporeMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    if (!running) render(elapsed, 0);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const onScroll = () => {
    if (!running) render(elapsed, 0);
  };

  document.addEventListener('visibilitychange', updateRunning);
  if (opts.animate && !coarse) window.addEventListener('pointermove', onPointer, { passive: true });
  if (!opts.animate) window.addEventListener('scroll', onScroll, { passive: true });

  resize();
  updateRunning();

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      running = false;
      ro.disconnect();
      document.removeEventListener('visibilitychange', updateRunning);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', onScroll);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
