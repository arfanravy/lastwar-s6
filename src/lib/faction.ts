export type Faction = 'deepwood' | 'wetland';
export type GroupKey = 'A' | 'B';

/**
 * Aturan in-game: jika jumlah angka kedua server No.1 genap,
 * grup A (hijau, leader #1271) masuk Deepwood; jika ganjil, sebaliknya.
 */
export function predictFactions(pickA: number, pickB: number) {
  const sum = pickA + pickB;
  const even = sum % 2 === 0;
  return {
    sum,
    even,
    A: (even ? 'deepwood' : 'wetland') as Faction,
    B: (even ? 'wetland' : 'deepwood') as Faction,
  };
}

export const FACTION_ICON: Record<Faction, string> = {
  deepwood: '🦌',
  wetland: '🐊',
};
