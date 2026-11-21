// Built-in alliance rosters that the Planner and Badai Manager can import with
// one click. Anyone else just types or imports their own data as before.
//
// To add/update a roster, edit the JSON file. Per player:
//   name  (required)  in-game name
//   rank  (optional)  R1–R5, used by the Planner (squad/tier)
//   power (optional)  number, same unit the Badai Manager uses (MAAX: Power SQ1 in millions)
//   type  (optional)  main squad type: Tank / Aircraft / Rudal (kept for future tools)
import maax from '../data/alliances/maax.json';

export type Rank = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

export interface AlliancePlayer {
  name: string;
  rank?: Rank;
  power?: number;
  type?: string;
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
    players.push({
      name,
      rank: RANKS.includes(rank) ? (rank as Rank) : undefined,
      power: Number.isFinite(power) && power > 0 ? power : undefined,
      type: type || undefined,
    });
  }
  return { tag: raw.tag, server: raw.server, updatedAt: raw.updatedAt, players };
}

/** Case/space-insensitive key used to match players by name. */
export const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export const ALLIANCE_PRESETS: AlliancePreset[] = [clean(maax)];
