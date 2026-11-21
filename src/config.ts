export const SITE = {
  name: 'Rimba S6',
  /** Server yang disorot secara default di tracker (bisa diganti pengunjung). */
  homeServer: 1196,
  /** Waktu server Last War. Cocok dengan timer in-game yang habis di 02:00 UTC. */
  serverUtcOffset: -2,
} as const;

export const LANGS = ['id', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const ROUTES = [
  { path: '', key: 'nav.home' },
  { path: 'faction-reveal/', key: 'nav.faction' },
  { path: 'map/', key: 'nav.map' },
  { path: 'season/', key: 'nav.season' },
  { path: 'planner/', key: 'nav.planner' },
  { path: 'badai/', key: 'nav.badai' },
] as const;
