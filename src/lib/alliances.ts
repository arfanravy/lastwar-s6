// Built-in alliance rosters that the Planner and Badai Manager can import with
// one click. Anyone else just types or imports their own data as before.
//
// To add/update a roster, edit the JSON file. Per player:
//   name  (required)  in-game name
//   rank  (optional)  R1–R5, used by the Planner (squad/tier)
//   power (optional)  number, same unit the Badai Manager uses (MAAX: Power SQ1 in millions)
//   type  (optional)  main squad type: Tank / Aircraft / Rudal (kept for future tools)
//   was   (optional)  earlier in-game names; an imported player with one of
//                     these names is renamed instead of added twice
import maax from '../data/alliances/maax.json';

export type Rank = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

export interface AlliancePlayer {
  name: string;
  rank?: Rank;
  power?: number;
  type?: string;
  was?: string[];
}

export interface AlliancePreset {
  tag: string;
  server: number;
  updatedAt: string;
  players: AlliancePlayer[];
}

const RANKS: readonly string[] = ['R1', 'R2', 'R3', 'R4', 'R5'];

function clean(raw: { tag: string; server: number; updatedAt: string; players: unknown[] }): AlliancePreset {
  const players: AlliancePlayer[] = [];
  const seen = new Set<string>();
  for (const p of raw.players as Partial<AlliancePlayer>[]) {
    const name = String(p?.name ?? '').trim();
    if (!name || seen.has(normName(name))) continue;
    seen.add(normName(name));
    const rank = String(p.rank ?? '').toUpperCase().trim();
    const power = Number(p.power);
    const type = String(p.type ?? '').trim();
    const was = (Array.isArray(p.was) ? p.was : []).map((w) => String(w).trim()).filter(Boolean);
    players.push({
      name,
      rank: RANKS.includes(rank) ? (rank as Rank) : undefined,
      power: Number.isFinite(power) && power > 0 ? power : undefined,
      type: type || undefined,
      was: was.length ? was : undefined,
    });
  }
  return { tag: raw.tag, server: raw.server, updatedAt: raw.updatedAt, players };
}

/** Case/space-insensitive key used to match players by name. */
export const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Find the local player that corresponds to a roster entry: by current name,
 * otherwise by one of its earlier names. When found, the local player's name is
 * brought up to date (also fixes upper/lower case) and the lookup map re-keyed.
 * Returns the player and whether its name changed.
 */
export function matchRosterPlayer<T extends { name: string }>(byName: Map<string, T>, ap: AlliancePlayer) {
  const key = normName(ap.name);
  let found = byName.get(key);
  if (!found) {
    for (const old of ap.was ?? []) {
      found = byName.get(normName(old));
      if (found) {
        byName.delete(normName(old));
        break;
      }
    }
  }
  if (!found) return null;
  const renamed = found.name !== ap.name;
  if (renamed) found.name = ap.name;
  byName.set(key, found);
  return { player: found, renamed };
}

export const ALLIANCE_PRESETS: AlliancePreset[] = [clean(maax)];
