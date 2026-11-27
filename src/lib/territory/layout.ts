// Area layout for warzone #1196 (Wetland), taken from the in-game warzone map.
// Coordinates are in map units (warzone = 1000×1000). Fishing Grounds are the
// cells between the road lines; cities sit on the line intersections.
// Levels, buffs and influence come from src/data/territory-1196.json.

import data from '../../data/territory-1196.json';

export const SIZE = data.size;
export const LAYOUT_SOURCE = data.source;

export type AreaType = 'WS' | 'WA' | 'WB' | 'WV' | 'TP' | 'CON' | 'WO' | 'FG';
export type Buff = 'coin' | 'food' | 'iron' | 'research' | 'construction' | 'march';

export interface Area {
  idx: number;
  type: AreaType;
  level: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** centre */
  cx: number;
  cy: number;
  buff?: Buff;
  pct?: number;
  influence?: number;
  city: boolean;
}

export const AREA_TYPES: AreaType[] = ['WS', 'WO', 'WA', 'WB', 'WV', 'TP', 'CON', 'FG'];
export const BUFFS: Buff[] = ['coin', 'food', 'iron', 'research', 'construction', 'march'];

export const AREAS: Area[] = data.areas.map((a, idx) => ({
  idx,
  type: a.t as AreaType,
  level: a.lv,
  x: a.x,
  y: a.y,
  w: a.w,
  h: a.h,
  cx: a.x + a.w / 2,
  cy: a.y + a.h / 2,
  buff: 'b' in a ? (a.b as Buff) : undefined,
  pct: 'p' in a ? (a.p as number) : undefined,
  influence: 'inf' in a ? (a.inf as number) : undefined,
  city: a.t !== 'FG' && a.t !== 'WS',
}));

/** Areas an alliance can take (the Sanctuary belongs to the whole faction). */
export const assignable = (a: Area) => a.type !== 'WS';

// Adjacency: Fishing Grounds sharing an edge, a city and the (up to) 4 Fishing
// Grounds around its intersection, and cities joined by a road segment.
const NEIGHBOURS: number[][] = AREAS.map(() => []);
{
  const fgs = AREAS.filter((a) => !a.city);
  const cities = AREAS.filter((a) => a.city);
  const link = (a: Area, b: Area) => {
    NEIGHBOURS[a.idx].push(b.idx);
    NEIGHBOURS[b.idx].push(a.idx);
  };
  for (let i = 0; i < fgs.length; i++)
    for (let j = i + 1; j < fgs.length; j++) {
      const a = fgs[i];
      const b = fgs[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if ((ox === 0 && oy > 0) || (oy === 0 && ox > 0)) link(a, b);
    }
  for (const c of cities) {
    for (const f of fgs)
      if (c.cx >= f.x && c.cx <= f.x + f.w && c.cy >= f.y && c.cy <= f.y + f.h) link(c, f);
    for (const o of cities)
      if (o.idx > c.idx && Math.abs(o.cx - c.cx) + Math.abs(o.cy - c.cy) === 100) link(c, o);
  }
}

export const neighbours = (idx: number) => NEIGHBOURS[idx];

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
      for (const nb of NEIGHBOURS[cur])
        if (set.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
    }
  }
  return n;
}
