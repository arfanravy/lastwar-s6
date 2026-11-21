// Types, defaults and pure helpers for the Badai Manager island.

export type EventKey = 'gurun' | 'ngarai';
export type Team = 'A' | 'B';
export type FilterMode = 'all' | 'gurun' | 'ngarai' | 'none';
export type TabKey = 'pemain' | 'gurun' | 'ngarai' | 'hasil';

export const EVENTS: EventKey[] = ['gurun', 'ngarai'];
export const TEAMS: Team[] = ['A', 'B'];

export interface Player {
  id: string;
  name: string;
  power: number;
  joinGurun: boolean;
  joinNgarai: boolean;
  gurunTeam: Team | null;
  ngaraiTeam: Team | null;
}

export interface Building {
  id: string;
  name: string;
  slots: number;
}

export interface EventConfig {
  teamAName: string;
  teamBName: string;
  buildings: Building[];
}

export interface Config {
  coreSlots: number;
  reserveSlots: number;
  gurun: EventConfig;
  ngarai: EventConfig;
}

export type Slots = (string | null)[];
export type TeamPlacements = Record<string, Slots>;
export type Placements = Record<EventKey, Record<Team, TeamPlacements>>;

export const STORAGE_KEY = 'badai-manager-v4';

export const joinField = (ev: EventKey) => (ev === 'gurun' ? 'joinGurun' : 'joinNgarai') as 'joinGurun' | 'joinNgarai';
export const teamField = (ev: EventKey) => (ev === 'gurun' ? 'gurunTeam' : 'ngaraiTeam') as 'gurunTeam' | 'ngaraiTeam';

// ─── Defaults ────────────────────────────────────────
export const DEFAULT_BUILDINGS: Record<EventKey, Building[]> = {
  gurun: [
    { id: 'rs1', name: 'RS 1', slots: 6 },
    { id: 'rs2', name: 'RS 2', slots: 6 },
    { id: 'kilang', name: 'Kilang Minyak', slots: 6 },
    { id: 'sains', name: 'Pusat Sains', slots: 6 },
    { id: 'info', name: 'Pusat Informasi', slots: 2 },
    { id: 'patroli', name: 'Patroli Gerilya', slots: 4 },
  ],
  ngarai: [
    { id: 'dataCenter', name: 'Data Center', slots: 4 },
    { id: 'powerTower', name: 'Power Tower', slots: 5 },
    { id: 'virusLab', name: 'Virus Lab', slots: 5 },
    { id: 'serumFactory', name: 'Serum Factory', slots: 4 },
    { id: 'defense', name: 'Defense System', slots: 4 },
    { id: 'warehouse', name: 'Sample Warehouse', slots: 8 },
  ],
};

export const DEFAULT_CONFIG: Config = {
  coreSlots: 20,
  reserveSlots: 10,
  gurun: { teamAName: 'TIM A', teamBName: 'TIM B', buildings: DEFAULT_BUILDINGS.gurun },
  ngarai: { teamAName: 'TIM A', teamBName: 'TIM B', buildings: DEFAULT_BUILDINGS.ngarai },
};

export const BUILDING_SLOT_OVERRIDES: Partial<Record<EventKey, Record<string, number>>> = {
  ngarai: { virusLab: 5, warehouse: 8 },
};

// Auto-fill priority: the highest-power players go into the first building
// in this list, then the next one. Buildings not listed are filled last
// (keeping their config order).
export const AUTOFILL_PRIORITY: Record<EventKey, string[]> = {
  gurun: ['patroli', 'rs1', 'rs2', 'sains', 'info', 'kilang'],
  ngarai: ['virusLab', 'powerTower', 'serumFactory', 'defense', 'dataCenter', 'warehouse'],
};

// Same migration as the standalone app: default buildings are always present
// (custom names/slots kept), slot overrides win.
export const normalizeConfig = (saved: Partial<Config> = {}): Config => {
  const normalizeBuildings = (eventKey: EventKey, savedBuildings?: Building[]): Building[] => {
    const savedMap = new Map((savedBuildings || []).map((b) => [b.id, b]));
    return DEFAULT_BUILDINGS[eventKey].map((def) => {
      const custom: Partial<Building> = savedMap.get(def.id) || {};
      const slotOverride = BUILDING_SLOT_OVERRIDES[eventKey]?.[def.id];
      return { ...def, ...custom, slots: slotOverride ?? custom.slots ?? def.slots };
    });
  };
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    gurun: {
      ...DEFAULT_CONFIG.gurun,
      ...(saved.gurun || {}),
      buildings: normalizeBuildings('gurun', saved.gurun?.buildings),
    },
    ngarai: {
      ...DEFAULT_CONFIG.ngarai,
      ...(saved.ngarai || {}),
      buildings: normalizeBuildings('ngarai', saved.ngarai?.buildings),
    },
  };
};

export const emptyPlacements = (cfg: Config): Placements => {
  const make = (eventKey: EventKey): TeamPlacements => {
    const team: TeamPlacements = {};
    cfg[eventKey].buildings.forEach((b) => {
      team[b.id] = Array(b.slots).fill(null);
    });
    return team;
  };
  return {
    gurun: { A: make('gurun'), B: make('gurun') },
    ngarai: { A: make('ngarai'), B: make('ngarai') },
  };
};

export const resize = (arr: Slots, n: number): Slots => {
  const next: Slots = Array(n).fill(null);
  arr.forEach((v, i) => {
    if (i < n) next[i] = v;
  });
  return next;
};

export const clonePlacements = (p: Placements): Placements => JSON.parse(JSON.stringify(p));

type SamplePlayer = Omit<Player, 'id'>;
export const SAMPLE_PLAYERS: SamplePlayer[] = [
  { name: 'Raja Naga', power: 850, joinGurun: true, joinNgarai: true, gurunTeam: 'A', ngaraiTeam: 'A' },
  { name: 'Pendekar Surya', power: 920, joinGurun: true, joinNgarai: false, gurunTeam: 'A', ngaraiTeam: null },
  { name: 'Petir Hitam', power: 780, joinGurun: false, joinNgarai: true, gurunTeam: null, ngaraiTeam: 'B' },
  { name: 'Bayangan Malam', power: 690, joinGurun: true, joinNgarai: true, gurunTeam: 'B', ngaraiTeam: 'A' },
  { name: 'Singa Padang', power: 880, joinGurun: true, joinNgarai: false, gurunTeam: 'A', ngaraiTeam: null },
  { name: 'Elang Gunung', power: 760, joinGurun: false, joinNgarai: true, gurunTeam: null, ngaraiTeam: 'A' },
  { name: 'Serigala Liar', power: 650, joinGurun: true, joinNgarai: true, gurunTeam: 'B', ngaraiTeam: 'B' },
  { name: 'Cakra Buana', power: 940, joinGurun: true, joinNgarai: true, gurunTeam: 'A', ngaraiTeam: 'A' },
  { name: 'Topan Biru', power: 720, joinGurun: false, joinNgarai: false, gurunTeam: null, ngaraiTeam: null },
  { name: 'Naga Merah', power: 810, joinGurun: true, joinNgarai: false, gurunTeam: 'B', ngaraiTeam: null },
  { name: 'Pedang Emas', power: 870, joinGurun: false, joinNgarai: true, gurunTeam: null, ngaraiTeam: 'A' },
  { name: 'Panah Petir', power: 700, joinGurun: true, joinNgarai: true, gurunTeam: 'A', ngaraiTeam: 'B' },
  { name: 'Gemuruh', power: 590, joinGurun: true, joinNgarai: false, gurunTeam: 'B', ngaraiTeam: null },
  { name: 'Halilintar', power: 830, joinGurun: true, joinNgarai: true, gurunTeam: 'A', ngaraiTeam: 'B' },
  { name: 'Badai Pasir', power: 740, joinGurun: true, joinNgarai: true, gurunTeam: 'B', ngaraiTeam: 'A' },
  { name: 'Kilat Senja', power: 770, joinGurun: false, joinNgarai: true, gurunTeam: null, ngaraiTeam: 'B' },
  { name: 'Macan Tutul', power: 820, joinGurun: true, joinNgarai: false, gurunTeam: 'A', ngaraiTeam: null },
  { name: 'Beruang Es', power: 670, joinGurun: true, joinNgarai: true, gurunTeam: 'B', ngaraiTeam: 'A' },
  { name: 'Phoenix', power: 950, joinGurun: true, joinNgarai: true, gurunTeam: 'A', ngaraiTeam: 'A' },
  { name: 'Hiu Putih', power: 680, joinGurun: false, joinNgarai: true, gurunTeam: null, ngaraiTeam: 'B' },
  { name: 'Garuda', power: 890, joinGurun: true, joinNgarai: true, gurunTeam: 'A', ngaraiTeam: 'A' },
  { name: 'Komodo', power: 730, joinGurun: true, joinNgarai: false, gurunTeam: 'B', ngaraiTeam: null },
  { name: 'Rajawali', power: 800, joinGurun: true, joinNgarai: true, gurunTeam: 'A', ngaraiTeam: 'B' },
  { name: 'Banteng Hitam', power: 660, joinGurun: true, joinNgarai: true, gurunTeam: 'B', ngaraiTeam: 'B' },
  { name: 'Mata Badai', power: 845, joinGurun: true, joinNgarai: false, gurunTeam: 'A', ngaraiTeam: null },
  { name: 'Pasir Emas', power: 710, joinGurun: true, joinNgarai: true, gurunTeam: 'B', ngaraiTeam: 'A' },
  { name: 'Lautan Api', power: 790, joinGurun: false, joinNgarai: true, gurunTeam: null, ngaraiTeam: 'B' },
  { name: 'Pemanah Awan', power: 640, joinGurun: true, joinNgarai: false, gurunTeam: 'A', ngaraiTeam: null },
  { name: 'Bunga Mawar', power: 610, joinGurun: true, joinNgarai: true, gurunTeam: 'B', ngaraiTeam: 'A' },
  { name: 'Pengembara', power: 750, joinGurun: true, joinNgarai: true, gurunTeam: 'B', ngaraiTeam: 'B' },
];

export interface SavedState {
  players: Player[];
  config: Config;
  placements: Placements;
}

export const loadSaved = (): Partial<SavedState> | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<SavedState>;
  } catch (e) {
    console.warn('localStorage get failed:', e);
    return null;
  }
};

export const saveState = (state: SavedState) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Save failed:', e);
  }
};
