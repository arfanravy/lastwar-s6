// Approximate area layout for warzone #1196 (top-right of the 3×3 S6 map).
// NOT the real in-game map: counts and positions are estimates generated
// deterministically, so a saved plan always lines up with the same grid.
// Replace with real data (same AreaType ids) once in-game screenshots exist.

export const GRID = 16;
export const LAYOUT_ESTIMATED = true;

export type AreaType = 'SAN' | 'WA' | 'WB' | 'WV' | 'TP' | 'CON' | 'WO' | 'FG';
export type Buff = 'coin' | 'food' | 'iron' | 'gather';

export interface Area {
  idx: number;
  x: number;
  y: number;
  type: AreaType;
  level: number;
  buff?: Buff;
}

export const AREA_TYPES: AreaType[] = ['SAN', 'WA', 'WB', 'WV', 'TP', 'CON', 'WO', 'FG'];
export const BUFFS: Buff[] = ['coin', 'food', 'iron', 'gather'];

/** Areas an alliance can take (Sanctuary belongs to the whole faction). */
export const assignable = (a: Area) => a.type !== 'SAN';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(): Area[] {
  const r = rng(1196);
  const types: (AreaType | null)[] = Array(GRID * GRID).fill(null);
  const at = (x: number, y: number) => y * GRID + x;
  const sx = 8;
  const sy = 7;
  types[at(sx, sy)] = 'SAN';

  // Fixed spots: consoles toward the Central Area (bottom-left corner),
  // outposts on the borders shared with neighbouring warzones.
  for (const [x, y] of [[0, 15], [2, 13], [0, 11], [4, 15]]) types[at(x, y)] = 'CON';
  for (const [x, y] of [[0, 4], [0, 8], [8, 15], [12, 15]]) types[at(x, y)] = 'WO';

  const dist = (i: number) => Math.hypot((i % GRID) - sx, Math.floor(i / GRID) - sy);
  const jitter = Array.from({ length: GRID * GRID }, () => r());
  const cityNear = (i: number) => {
    const x = i % GRID;
    const y = Math.floor(i / GRID);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < GRID && ny < GRID && types[at(nx, ny)]) return true;
      }
    return false;
  };

  const place = (type: AreaType, count: number, target: number, spread: boolean) => {
    const order = types
      .map((_, i) => i)
      .filter((i) => !types[i])
      .sort((a, b) => Math.abs(dist(a) - target) + jitter[a] * 2.5 - (Math.abs(dist(b) - target) + jitter[b] * 2.5));
    let left = count;
    for (const pass of spread ? [true, false] : [false]) {
      for (const i of order) {
        if (!left) return;
        if (types[i] || (pass && cityNear(i))) continue;
        types[i] = type;
        left--;
      }
    }
  };

  place('WA', 12, 2, false);
  place('WB', 20, 4.5, true);
  place('TP', 10, 9.5, true);
  place('WV', 50, 7, true);

  return types.map((t, idx) => {
    const type = t ?? 'FG';
    const a: Area = { idx, x: idx % GRID, y: Math.floor(idx / GRID), type, level: 1 };
    switch (type) {
      case 'SAN': a.level = 6; break;
      case 'WA': a.level = 5; break;
      case 'WB': a.level = r() < 0.5 ? 3 : 4; break;
      case 'TP': a.level = 2; break;
      case 'CON': a.level = 6; break;
      case 'WO': a.level = 4; break;
      case 'WV': a.level = r() < 0.5 ? 1 : 2; break;
      case 'FG': a.level = 1 + Math.floor(r() * 3); break;
    }
    if (type === 'WV' || type === 'TP') a.buff = BUFFS[Math.floor(r() * 4)];
    return a;
  });
}

export const AREAS: Area[] = build();

export function neighbours(idx: number): number[] {
  const x = idx % GRID;
  const y = Math.floor(idx / GRID);
  const out: number[] = [];
  if (x > 0) out.push(idx - 1);
  if (x < GRID - 1) out.push(idx + 1);
  if (y > 0) out.push(idx - GRID);
  if (y < GRID - 1) out.push(idx + GRID);
  return out;
}

/** Number of separate territory blocks (in-game territory must be connected). */
export function components(cells: number[]): number {
  const set = new Set(cells);
  const seen = new Set<number>();
  let n = 0;
  for (const c of cells) {
    if (seen.has(c)) continue;
    n++;
    const stack = [c];
    seen.add(c);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of neighbours(cur))
        if (set.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
    }
  }
  return n;
}
