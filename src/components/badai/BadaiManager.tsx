import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  AlertCircle,
  Award,
  Building2,
  Check,
  ClipboardList,
  Crown,
  Database,
  Download,
  FileText,
  ListChecks,
  MapPin,
  Medal,
  Mountain,
  Plus,
  Printer,
  RotateCcw,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Wand2,
  Wind,
  X,
} from 'lucide-react';
import type { Lang } from '../../config';
import { strings } from './i18n';
import type { BadaiStrings } from './i18n';
import {
  AUTOFILL_PRIORITY,
  DEFAULT_CONFIG,
  EVENTS,
  SAMPLE_PLAYERS,
  TEAMS,
  clonePlacements,
  emptyPlacements,
  joinField,
  loadSaved,
  normalizeConfig,
  resize,
  saveState,
  teamField,
} from './data';
import type { Building, Config, EventKey, FilterMode, Placements, Player, TabKey, Team } from './data';
import { downloadTemplate, exportWorkbook, readRows, rowsToPlayers } from './excel';
import './badai.css';

// ─── Small presentational components (module scope → never remounted) ────────

function RankBadge({ rank, size = 'sm' }: { rank?: number; size?: 'sm' | 'md' }) {
  const cls = `bm-rank bm-rank-${size}`;
  if (!rank || rank > 3) {
    return <span className={`${cls} bm-rank-plain`}>#{rank || '-'}</span>;
  }
  const Icon = rank === 1 ? Crown : rank === 2 ? Award : Medal;
  return (
    <span className={`${cls} bm-rank-${rank}`} title={`#${rank}`}>
      <Icon size={size === 'sm' ? 12 : 14} strokeWidth={2.5} />
    </span>
  );
}

function VotePill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`bm-vote ${active ? 'on' : 'off'}`} aria-pressed={active}>
      {active ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={2.5} />}
      <span>{label}</span>
    </button>
  );
}

function TeamPill({ team, title, onClick }: { team: Team; title?: string; onClick?: () => void }) {
  if (!onClick) return <span className={`bm-team-pill team-${team.toLowerCase()}`}>{team}</span>;
  return (
    <button type="button" onClick={onClick} className={`bm-team-pill team-${team.toLowerCase()}`} title={title}>
      {team}
    </button>
  );
}

interface PlayerRowProps {
  p: Player;
  rank?: number;
  s: BadaiStrings;
  onUpdate: (id: string, field: keyof Player, value: string | boolean | Team | null) => void;
  onDelete: (id: string) => void;
}

function PlayerRow({ p, rank, s, onUpdate, onDelete }: PlayerRowProps) {
  const rowCls = rank && rank <= 3 ? ` r${rank}` : '';
  return (
    <div className={`bm-prow${rowCls}`}>
      <div className="bm-prow-rank">
        <RankBadge rank={rank} />
      </div>
      <div className="bm-prow-name">
        <input
          className="bm-inline bm-strong"
          value={p.name}
          aria-label={s.colName}
          onChange={(e) => onUpdate(p.id, 'name', e.target.value)}
        />
      </div>
      <div className="bm-prow-power">
        <input
          className="bm-inline bm-mono bm-right"
          type="number"
          value={p.power}
          aria-label="Power"
          onChange={(e) => onUpdate(p.id, 'power', e.target.value)}
        />
      </div>
      <div className="bm-prow-votes">
        <div className="bm-votegroup ev-gurun">
          <VotePill active={p.joinGurun} label={s.pillGurun} onClick={() => onUpdate(p.id, 'joinGurun', !p.joinGurun)} />
          {p.joinGurun && (
            <TeamPill
              team={p.gurunTeam || 'A'}
              title={s.moveToTeam(p.gurunTeam === 'A' ? 'B' : 'A')}
              onClick={() => onUpdate(p.id, 'gurunTeam', p.gurunTeam === 'A' ? 'B' : 'A')}
            />
          )}
        </div>
        <div className="bm-votegroup ev-ngarai">
          <VotePill active={p.joinNgarai} label={s.pillNgarai} onClick={() => onUpdate(p.id, 'joinNgarai', !p.joinNgarai)} />
          {p.joinNgarai && (
            <TeamPill
              team={p.ngaraiTeam || 'A'}
              title={s.moveToTeam(p.ngaraiTeam === 'A' ? 'B' : 'A')}
              onClick={() => onUpdate(p.id, 'ngaraiTeam', p.ngaraiTeam === 'A' ? 'B' : 'A')}
            />
          )}
        </div>
      </div>
      <div className="bm-prow-del">
        <button type="button" onClick={() => onDelete(p.id)} className="bm-icon-btn danger" title={s.remove} aria-label={s.remove}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

interface BuildingCardProps {
  building: Building;
  slots: (string | null)[];
  options: (slotIdx: number) => Player[];
  playerById: Map<string, Player>;
  powerRankMap: Map<string, number>;
  s: BadaiStrings;
  onSet: (slotIdx: number, value: string) => void;
}

function BuildingCard({ building, slots, options, playerById, powerRankMap, s, onSet }: BuildingCardProps) {
  const filled = slots.filter(Boolean).length;
  return (
    <div className="bm-building">
      <div className="bm-building-head">
        <div className="bm-row bm-gap-2">
          <span className="bm-bicon">
            <Building2 size={13} />
          </span>
          <span className="bm-building-name">{building.name}</span>
        </div>
        <span className="bm-count">
          {filled}/{slots.length}
        </span>
      </div>
      <div className="bm-stack-sm">
        {slots.map((playerId, i) => {
          const player = playerId ? playerById.get(playerId) : undefined;
          const opts = options(i);
          const rank = player ? powerRankMap.get(player.id) : undefined;
          return (
            <div key={i} className="bm-slot">
              <span className="bm-slot-no">{String(i + 1).padStart(2, '0')}</span>
              <select className="bm-select" value={playerId || ''} onChange={(e) => onSet(i, e.target.value)}>
                <option value="">{s.emptySlot}</option>
                {opts.map((op) => (
                  <option key={op.id} value={op.id}>
                    #{powerRankMap.get(op.id)} · {op.name} · {op.power}
                  </option>
                ))}
                {playerId && player && !opts.find((op) => op.id === playerId) && (
                  <option value={playerId}>
                    #{powerRankMap.get(playerId)} · {player.name} ⚠
                  </option>
                )}
              </select>
              {rank && rank <= 3 ? <RankBadge rank={rank} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventIcon({ eventKey, size = 22 }: { eventKey: EventKey; size?: number }) {
  const Icon = eventKey === 'gurun' ? Wind : Mountain;
  return <Icon size={size} strokeWidth={2.2} />;
}

// ─── Main component ──────────────────────────────────────────────────────────

interface State {
  players: Player[];
  config: Config;
  placements: Placements;
}

function initialState(): State {
  const saved = typeof window !== 'undefined' ? loadSaved() : null;
  const config = saved?.config ? normalizeConfig(saved.config) : DEFAULT_CONFIG;
  return {
    players: Array.isArray(saved?.players) ? saved!.players! : [],
    config,
    placements: saved?.placements ?? emptyPlacements(config),
  };
}

export default function BadaiManager({ lang = 'id' }: { lang?: Lang }) {
  const s = strings[lang] ?? strings.id;
  const [init] = useState(initialState);
  const [players, setPlayers] = useState<Player[]>(init.players);
  const [config, setConfig] = useState<Config>(init.config);
  const [placements, setPlacements] = useState<Placements>(init.placements);
  const [newPlayer, setNewPlayer] = useState({ name: '', power: '' });
  const [tab, setTab] = useState<TabKey>('pemain');
  const [activeTeam, setActiveTeam] = useState<Record<EventKey, Team>>({ gurun: 'A', ngarai: 'A' });
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [showSettings, setShowSettings] = useState<Record<EventKey, boolean>>({ gurun: false, ngarai: false });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounced autosave (same key + JSON shape as the standalone app)
  useEffect(() => {
    const t = setTimeout(() => saveState({ players, config, placements }), 300);
    return () => clearTimeout(t);
  }, [players, config, placements]);

  // Keep placement arrays in sync with building config (add/remove/resize)
  useEffect(() => {
    setPlacements((prev) => {
      const next: Placements = { gurun: { A: {}, B: {} }, ngarai: { A: {}, B: {} } };
      EVENTS.forEach((ev) => {
        config[ev].buildings.forEach((b) => {
          TEAMS.forEach((team) => {
            const old = prev[ev]?.[team]?.[b.id] || [];
            next[ev][team][b.id] = resize(old, b.slots);
          });
        });
      });
      return next;
    });
  }, [config.gurun.buildings, config.ngarai.buildings]);

  // ─── Computed ────────────────────────────────────────
  const sortedByPower = useMemo(() => [...players].sort((a, b) => (b.power || 0) - (a.power || 0)), [players]);
  const powerRankMap = useMemo(() => {
    const m = new Map<string, number>();
    sortedByPower.forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }, [sortedByPower]);
  const playerById = useMemo(() => {
    const m = new Map<string, Player>();
    players.forEach((p) => m.set(p.id, p));
    return m;
  }, [players]);
  const rosters = useMemo(() => {
    const get = (ev: EventKey, team: Team) => sortedByPower.filter((p) => p[joinField(ev)] && p[teamField(ev)] === team);
    return {
      gurun: { A: get('gurun', 'A'), B: get('gurun', 'B') },
      ngarai: { A: get('ngarai', 'A'), B: get('ngarai', 'B') },
    } as Record<EventKey, Record<Team, Player[]>>;
  }, [sortedByPower]);
  const gurunVoteCount = sortedByPower.filter((p) => p.joinGurun).length;
  const ngaraiVoteCount = sortedByPower.filter((p) => p.joinNgarai).length;
  const noVoteCount = sortedByPower.filter((p) => !p.joinGurun && !p.joinNgarai).length;
  const displayedPlayers = useMemo(() => {
    if (filterMode === 'gurun') return sortedByPower.filter((p) => p.joinGurun);
    if (filterMode === 'ngarai') return sortedByPower.filter((p) => p.joinNgarai);
    if (filterMode === 'none') return sortedByPower.filter((p) => !p.joinGurun && !p.joinNgarai);
    return sortedByPower;
  }, [sortedByPower, filterMode]);

  const eventLabel = (ev: EventKey) => (ev === 'gurun' ? s.eventGurun : s.eventNgarai);
  const teamName = (ev: EventKey, team: Team) => (team === 'A' ? config[ev].teamAName : config[ev].teamBName);

  // ─── Player actions ────────────────────────────────────────
  const addPlayer = () => {
    const name = newPlayer.name.trim();
    if (!name) return;
    const player: Player = {
      id: 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name,
      power: parseFloat(newPlayer.power) || 0,
      joinGurun: false,
      joinNgarai: false,
      gurunTeam: null,
      ngaraiTeam: null,
    };
    setPlayers((prev) => [...prev, player]);
    setNewPlayer({ name: '', power: '' });
  };

  const removeFromPlacements = (id: string, events: EventKey[]) => {
    setPlacements((prev) => {
      const next = clonePlacements(prev);
      events.forEach((ev) => {
        TEAMS.forEach((team) => {
          Object.keys(next[ev][team]).forEach((bId) => {
            next[ev][team][bId] = next[ev][team][bId].map((x) => (x === id ? null : x));
          });
        });
      });
      return next;
    });
  };

  const deletePlayer = (id: string) => {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
    removeFromPlacements(id, EVENTS);
  };

  const updatePlayer = (id: string, field: keyof Player, value: string | boolean | Team | null) => {
    setPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p };
        if (field === 'name') next.name = String(value);
        else if (field === 'power') next.power = parseFloat(String(value)) || 0;
        else if (field === 'joinGurun') {
          next.joinGurun = Boolean(value);
          if (value && !next.gurunTeam) next.gurunTeam = 'A';
          if (!value) next.gurunTeam = null;
        } else if (field === 'joinNgarai') {
          next.joinNgarai = Boolean(value);
          if (value && !next.ngaraiTeam) next.ngaraiTeam = 'A';
          if (!value) next.ngaraiTeam = null;
        } else if (field === 'gurunTeam' || field === 'ngaraiTeam') {
          next[field] = value as Team | null;
        }
        return next;
      }),
    );
    if (field === 'gurunTeam' || field === 'joinGurun') removeFromPlacements(id, ['gurun']);
    if (field === 'ngaraiTeam' || field === 'joinNgarai') removeFromPlacements(id, ['ngarai']);
  };

  const setBuildingSlot = (eventKey: EventKey, team: Team, buildingId: string, slotIdx: number, value: string) => {
    const id = value === '' ? null : value;
    setPlacements((prev) => {
      const next = clonePlacements(prev);
      if (id) {
        Object.keys(next[eventKey][team]).forEach((bId) => {
          next[eventKey][team][bId] = next[eventKey][team][bId].map((x, i) => {
            if (bId === buildingId && i === slotIdx) return x;
            return x === id ? null : x;
          });
        });
      }
      if (!next[eventKey][team][buildingId]) next[eventKey][team][buildingId] = [];
      next[eventKey][team][buildingId][slotIdx] = id;
      return next;
    });
  };

  const autoAssignTeamBuildings = (eventKey: EventKey, team: Team) => {
    const roster = rosters[eventKey][team];
    const priority = AUTOFILL_PRIORITY[eventKey] || [];
    const rank = (id: string) => {
      const i = priority.indexOf(id);
      return i === -1 ? priority.length : i;
    };
    const orderedBuildings = config[eventKey].buildings
      .map((b, i) => ({ b, i }))
      .sort((x, y) => rank(x.b.id) - rank(y.b.id) || x.i - y.i)
      .map((x) => x.b);
    setPlacements((prev) => {
      const next = clonePlacements(prev);
      let idx = 0;
      orderedBuildings.forEach((b) => {
        const arr: (string | null)[] = Array(b.slots).fill(null);
        for (let i = 0; i < b.slots && idx < roster.length; i++) arr[i] = roster[idx++].id;
        next[eventKey][team][b.id] = arr;
      });
      return next;
    });
  };

  const autoSplitTeams = (eventKey: EventKey) => {
    const jf = joinField(eventKey);
    const tf = teamField(eventKey);
    const updates = new Map<string, Team>();
    sortedByPower.filter((p) => p[jf]).forEach((p, i) => updates.set(p.id, i % 2 === 0 ? 'A' : 'B'));
    setPlayers((prev) => prev.map((p) => (p[jf] ? { ...p, [tf]: updates.get(p.id) || 'A' } : p)));
  };

  const clearEventPlacements = (eventKey: EventKey) => {
    setPlacements((prev) => {
      const next = clonePlacements(prev);
      TEAMS.forEach((team) => {
        Object.keys(next[eventKey][team]).forEach((bId) => {
          next[eventKey][team][bId] = next[eventKey][team][bId].map(() => null);
        });
      });
      return next;
    });
  };

  const loadSample = () => {
    const stamp = Date.now();
    setPlayers(SAMPLE_PLAYERS.map((p, i) => ({ id: 'p_sample_' + i + '_' + stamp, ...p })));
  };

  const bulkVote = (events: EventKey[], value: boolean) => {
    setPlayers((prev) =>
      prev.map((p) => {
        const next = { ...p };
        events.forEach((ev) => {
          const jf = joinField(ev);
          const tf = teamField(ev);
          next[jf] = value;
          if (value && !next[tf]) next[tf] = 'A';
          if (!value) next[tf] = null;
        });
        return next;
      }),
    );
  };

  // ─── Building CRUD ────────────────────────────────────────
  const setBuildings = (eventKey: EventKey, fn: (b: Building[]) => Building[]) =>
    setConfig((prev) => ({ ...prev, [eventKey]: { ...prev[eventKey], buildings: fn(prev[eventKey].buildings) } }));

  const updateBuildingConfig = (eventKey: EventKey, idx: number, field: 'name' | 'slots', value: string) =>
    setBuildings(eventKey, (arr) =>
      arr.map((b, i) =>
        i === idx ? { ...b, [field]: field === 'slots' ? Math.max(0, parseInt(value) || 0) : value } : b,
      ),
    );

  const addBuilding = (eventKey: EventKey) =>
    setBuildings(eventKey, (arr) => [
      ...arr,
      { id: 'b_' + Date.now() + '_' + Math.floor(Math.random() * 1000), name: s.newBuildingName, slots: 4 },
    ]);

  const deleteBuilding = (eventKey: EventKey, idx: number) => {
    const building = config[eventKey].buildings[idx];
    if (!building) return;
    if (!window.confirm(s.confirmDeleteBuilding(building.name))) return;
    setBuildings(eventKey, (arr) => arr.filter((_, i) => i !== idx));
    setPlacements((prev) => {
      const next = clonePlacements(prev);
      TEAMS.forEach((team) => {
        delete next[eventKey][team][building.id];
      });
      return next;
    });
  };

  const moveBuilding = (eventKey: EventKey, idx: number, dir: number) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= config[eventKey].buildings.length) return;
    setBuildings(eventKey, (arr) => {
      const next = [...arr];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const updateTeamName = (eventKey: EventKey, team: Team, name: string) =>
    setConfig((prev) => ({
      ...prev,
      [eventKey]: { ...prev[eventKey], [team === 'A' ? 'teamAName' : 'teamBName']: name },
    }));

  const optionsForBuildingSlot = (eventKey: EventKey, team: Team, buildingId: string, slotIdx: number) => {
    const used = new Set<string>();
    const tp = placements[eventKey]?.[team] || {};
    Object.keys(tp).forEach((bId) => {
      tp[bId].forEach((id, i) => {
        if (id && !(bId === buildingId && i === slotIdx)) used.add(id);
      });
    });
    return rosters[eventKey][team].filter((p) => !used.has(p.id));
  };

  // ─── Import / Export ────────────────────────────────────────
  const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const rows = readRows(evt.target?.result as ArrayBuffer);
        if (rows.length === 0) {
          window.alert(s.fileEmpty);
          input.value = '';
          return;
        }
        if (players.length > 0 && !window.confirm(s.confirmReplace(players.length))) {
          input.value = '';
          return;
        }
        const newPlayers = rowsToPlayers(rows);
        if (newPlayers.length === 0) {
          window.alert(s.noValidRows);
        } else {
          setPlayers(newPlayers);
          setPlacements(emptyPlacements(config));
          window.alert(s.importOk(newPlayers.length));
        }
      } catch (err) {
        console.error(err);
        window.alert(s.importFail);
      }
      input.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  const exportData = () => {
    if (players.length === 0) {
      window.alert(s.nothingToExport);
      return;
    }
    void exportWorkbook({ sortedByPower, config, placements, playerById, rosters });
  };

  // ─── Renderers (plain functions, called inline — not component types) ──────

  const renderPemainTab = () => (
    <div className="bm-stack">
      <section className="bm-card">
        <div className="bm-between bm-mb-4">
          <div className="bm-row bm-gap-2">
            <Users size={18} className="bm-accent" />
            <h2 className="bm-h2">{s.playerListTitle}</h2>
          </div>
          <div className="bm-row bm-wrap bm-gap-1">
            <button type="button" className="bm-btn bm-btn-xs" onClick={downloadTemplate} title={s.templateTitle}>
              <FileText size={12} /> {s.template}
            </button>
            <button type="button" className="bm-btn bm-btn-xs" onClick={() => fileInputRef.current?.click()} title={s.importTitle}>
              <Upload size={12} /> {s.importBtn}
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} hidden />
            <button type="button" className="bm-btn bm-btn-xs" onClick={exportData} disabled={players.length === 0} title={s.exportTitle}>
              <Download size={12} /> {s.exportBtn}
            </button>
            {players.length === 0 && (
              <button type="button" className="bm-btn bm-btn-xs" onClick={loadSample}>
                <Database size={12} /> {s.sampleData}
              </button>
            )}
          </div>
        </div>

        <div className="bm-addrow">
          <input
            className="bm-input"
            placeholder={s.namePlaceholder}
            value={newPlayer.name}
            onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
          />
          <input
            className="bm-input"
            placeholder={s.powerPlaceholder}
            type="number"
            value={newPlayer.power}
            onChange={(e) => setNewPlayer({ ...newPlayer, power: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
          />
          <button type="button" className="bm-btn bm-btn-primary" onClick={addPlayer}>
            <Plus size={15} /> {s.add}
          </button>
        </div>

        {players.length > 0 && (
          <>
            <div className="bm-divider">
              <ListChecks size={11} /> {s.bulkLabel}
            </div>
            <div className="bm-row bm-wrap bm-gap-1 bm-mb-3">
              <button type="button" className="bm-btn bm-btn-xs bm-btn-ev ev-gurun" onClick={() => bulkVote(['gurun'], true)}>
                <Check size={11} strokeWidth={3} /> {s.allGurun}
              </button>
              <button type="button" className="bm-btn bm-btn-xs bm-btn-ev ev-ngarai" onClick={() => bulkVote(['ngarai'], true)}>
                <Check size={11} strokeWidth={3} /> {s.allNgarai}
              </button>
              <button type="button" className="bm-btn bm-btn-xs" onClick={() => bulkVote(EVENTS, false)}>
                <X size={11} strokeWidth={3} /> {s.resetVote}
              </button>
              <button type="button" className="bm-btn bm-btn-xs" onClick={() => autoSplitTeams('gurun')}>
                {s.autoSplitGurun}
              </button>
              <button type="button" className="bm-btn bm-btn-xs" onClick={() => autoSplitTeams('ngarai')}>
                {s.autoSplitNgarai}
              </button>
            </div>
            <div className="bm-filters" role="group">
              {(
                [
                  { k: 'all', l: `${s.filterAll} (${players.length})` },
                  { k: 'gurun', l: `${s.filterGurun} (${gurunVoteCount})` },
                  { k: 'ngarai', l: `${s.filterNgarai} (${ngaraiVoteCount})` },
                  { k: 'none', l: `${s.filterNone} (${noVoteCount})` },
                ] as { k: FilterMode; l: string }[]
              ).map(({ k, l }) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setFilterMode(k)}
                  className={`bm-filter${filterMode === k ? ' active' : ''}`}
                  aria-pressed={filterMode === k}
                >
                  {l}
                </button>
              ))}
            </div>
          </>
        )}

        {players.length === 0 ? (
          <div className="bm-empty">
            <AlertCircle size={28} />
            <div className="bm-empty-title">{s.emptyTitle}</div>
            <div className="bm-empty-hint">
              {s.emptyHintA}
              <b>{s.template}</b>
              {s.emptyHintB}
              <b>{s.importBtn}</b>
              {s.emptyHintC}
            </div>
          </div>
        ) : (
          <div className="bm-list">
            <div className="bm-prow bm-prow-head">
              <div className="bm-prow-rank">#</div>
              <div className="bm-prow-name">{s.colName}</div>
              <div className="bm-prow-power bm-right">{s.colPower}</div>
              <div className="bm-prow-votes">{s.colVote}</div>
              <div className="bm-prow-del" />
            </div>
            {displayedPlayers.map((p) => (
              <PlayerRow
                key={p.id}
                p={p}
                rank={powerRankMap.get(p.id)}
                s={s}
                onUpdate={updatePlayer}
                onDelete={deletePlayer}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );

  const renderTeamPanel = (eventKey: EventKey, team: Team) => {
    const roster = rosters[eventKey][team];
    const { coreSlots, reserveSlots } = config;
    const coreCount = Math.min(roster.length, coreSlots);
    const reserveCount = Math.max(0, Math.min(roster.length - coreSlots, reserveSlots));
    const overflow = Math.max(0, roster.length - coreSlots - reserveSlots);
    const buildings = config[eventKey].buildings;
    const teamPl = placements[eventKey]?.[team] || {};
    const totalSlots = buildings.reduce((sum, b) => sum + b.slots, 0);
    const totalFilled = buildings.reduce((sum, b) => sum + (teamPl[b.id]?.filter(Boolean).length || 0), 0);

    return (
      <section className={`bm-card bm-tint ev-${eventKey}`}>
        <div className="bm-between bm-mb-4 bm-items-start">
          <div className="bm-row bm-gap-3">
            <span className="bm-grad-badge">{team}</span>
            <div>
              <input
                className="bm-inline bm-team-name"
                value={teamName(eventKey, team)}
                aria-label={`${s.teamLabel} ${team}`}
                onChange={(e) => updateTeamName(eventKey, team, e.target.value)}
              />
              <div className="bm-meta bm-px-1">{s.teamStats(coreCount, reserveCount, totalFilled, totalSlots)}</div>
            </div>
          </div>
          <button
            type="button"
            className="bm-btn bm-btn-xs"
            onClick={() => autoAssignTeamBuildings(eventKey, team)}
            disabled={roster.length === 0}
          >
            <Wand2 size={11} /> {s.autoAssign}
          </button>
        </div>

        {overflow > 0 && (
          <div className="bm-note warn">
            <AlertCircle size={11} /> {s.overflow(overflow)}
          </div>
        )}
        {roster.length === 0 && (
          <div className="bm-note">
            <AlertCircle size={11} /> {s.emptyRoster}
          </div>
        )}

        {roster.length > 0 && (
          <div className="bm-mb-4">
            <div className="bm-label">
              <Shield size={10} /> {s.rosterLabel}
            </div>
            <div className="bm-row bm-wrap bm-gap-1">
              {roster.map((p, i) => {
                const isCore = i < coreSlots;
                const isOver = i >= coreSlots + reserveSlots;
                return (
                  <span key={p.id} className={`bm-chip${isCore ? ' core' : ''}${isOver ? ' over' : ''}`}>
                    <span className="bm-chip-no">{String(i + 1).padStart(2, '0')}</span>
                    <span className="bm-chip-name">{p.name}</span>
                    <span className="bm-chip-no">{p.power}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="bm-section-bar">
          <MapPin size={11} /> {s.placementLabel}
        </div>
        <div className="bm-building-grid">
          {buildings.map((b) => (
            <BuildingCard
              key={b.id}
              building={b}
              slots={teamPl[b.id] || []}
              options={(slotIdx) => optionsForBuildingSlot(eventKey, team, b.id, slotIdx)}
              playerById={playerById}
              powerRankMap={powerRankMap}
              s={s}
              onSet={(slotIdx, value) => setBuildingSlot(eventKey, team, b.id, slotIdx, value)}
            />
          ))}
        </div>
      </section>
    );
  };

  const renderEventTab = (eventKey: EventKey) => {
    const voteCount = eventKey === 'gurun' ? gurunVoteCount : ngaraiVoteCount;
    const activeSubTeam = activeTeam[eventKey];
    const isEditing = showSettings[eventKey];
    const buildings = config[eventKey].buildings;

    return (
      <div className="bm-stack">
        <section className={`bm-card bm-tint ev-${eventKey}`}>
          <div className="bm-between bm-mb-4 bm-items-start">
            <div className="bm-row bm-gap-3">
              <span className="bm-grad-icon">
                <EventIcon eventKey={eventKey} />
              </span>
              <div>
                <h2 className="bm-event-title">{eventLabel(eventKey)}</h2>
                <div className="bm-meta">
                  {s.eventStats(voteCount, rosters[eventKey].A.length, rosters[eventKey].B.length)}
                </div>
              </div>
            </div>
            <div className="bm-row bm-wrap bm-gap-2">
              <button
                type="button"
                className="bm-btn bm-btn-xs"
                aria-expanded={isEditing}
                onClick={() => setShowSettings((prev) => ({ ...prev, [eventKey]: !prev[eventKey] }))}
              >
                <Settings size={12} /> {isEditing ? s.closeBuildings : s.editBuildings}
              </button>
              <button type="button" className="bm-btn bm-btn-xs" onClick={() => clearEventPlacements(eventKey)}>
                <RotateCcw size={12} /> {s.resetPlacements}
              </button>
            </div>
          </div>

          {isEditing && (
            <div className="bm-editor bm-fade">
              <div className="bm-label bm-between">
                <span>{s.buildingConfig}</span>
                <span>{s.totalSlots(buildings.reduce((sum, b) => sum + b.slots, 0))}</span>
              </div>
              <div className="bm-stack-sm bm-mb-3">
                {buildings.map((b, i) => (
                  <div key={b.id} className="bm-editor-row">
                    <div className="bm-move">
                      <button type="button" onClick={() => moveBuilding(eventKey, i, -1)} disabled={i === 0} aria-label={s.moveUp} title={s.moveUp}>
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBuilding(eventKey, i, 1)}
                        disabled={i === buildings.length - 1}
                        aria-label={s.moveDown}
                        title={s.moveDown}
                      >
                        ▼
                      </button>
                    </div>
                    <input
                      className="bm-inline"
                      value={b.name}
                      onChange={(e) => updateBuildingConfig(eventKey, i, 'name', e.target.value)}
                    />
                    <input
                      type="number"
                      min={0}
                      max={50}
                      className="bm-inline bm-mono bm-right"
                      value={b.slots}
                      onChange={(e) => updateBuildingConfig(eventKey, i, 'slots', e.target.value)}
                    />
                    <span className="bm-meta bm-center">{s.slot}</span>
                    <button
                      type="button"
                      onClick={() => deleteBuilding(eventKey, i)}
                      className="bm-icon-btn danger"
                      title={s.deleteBuilding}
                      aria-label={s.deleteBuilding}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="bm-btn bm-btn-xs bm-btn-block" onClick={() => addBuilding(eventKey)}>
                <Plus size={12} /> {s.addBuilding}
              </button>
            </div>
          )}

          <div className="bm-subtabs" role="tablist">
            {TEAMS.map((t) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeSubTeam === t}
                key={t}
                className={`bm-subtab${activeSubTeam === t ? ' active' : ''}`}
                onClick={() => setActiveTeam((prev) => ({ ...prev, [eventKey]: t }))}
              >
                {s.teamLabel} {t} · {teamName(eventKey, t)}
                <span className="bm-subtab-count">({rosters[eventKey][t].length})</span>
              </button>
            ))}
          </div>
        </section>
        {renderTeamPanel(eventKey, activeSubTeam)}
      </div>
    );
  };

  const renderHasilTab = () => {
    const participants = sortedByPower.filter((p) => p.joinGurun || p.joinNgarai);
    const dash = <span className="bm-dim">—</span>;
    return (
      <div className="bm-stack bm-print-area">
        <section className="bm-card bm-between no-print">
          <div className="bm-row bm-gap-2">
            <ClipboardList size={18} className="bm-accent" />
            <h2 className="bm-h2">{s.resultsTitle}</h2>
          </div>
          <div className="bm-row bm-gap-2">
            <button type="button" className="bm-btn bm-btn-primary bm-btn-xs" onClick={exportData} disabled={players.length === 0}>
              <Download size={12} /> {s.exportExcel}
            </button>
            <button type="button" className="bm-btn bm-btn-xs" onClick={() => window.print()}>
              <Printer size={12} /> {s.printPdf}
            </button>
          </div>
        </section>

        <section className="bm-card">
          <div className="bm-row bm-gap-2 bm-mb-4">
            <Users size={16} className="bm-accent" />
            <h3 className="bm-h2">{s.participantsTitle}</h3>
            <span className="bm-meta">
              ({participants.length}/{players.length})
            </span>
          </div>
          {participants.length === 0 ? (
            <div className="bm-muted bm-italic">{s.noParticipants}</div>
          ) : (
            <div className="bm-table-wrap">
              <table className="bm-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{s.colName}</th>
                    <th className="bm-right">Power</th>
                    <th className="bm-center">{s.colGurun}</th>
                    <th className="bm-center">{s.colNgarai}</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p, i) => (
                    <tr key={p.id}>
                      <td className="bm-mono bm-muted">{i + 1}</td>
                      <td>{p.name}</td>
                      <td className="bm-right bm-mono">{p.power}</td>
                      <td className="bm-center ev-gurun">{p.joinGurun ? <TeamPill team={p.gurunTeam || 'A'} /> : dash}</td>
                      <td className="bm-center ev-ngarai">{p.joinNgarai ? <TeamPill team={p.ngaraiTeam || 'A'} /> : dash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {EVENTS.map((eventKey) => (
          <section key={eventKey} className={`bm-card bm-tint ev-${eventKey} bm-print-event`}>
            <div className="bm-row bm-gap-3 bm-mb-4">
              <span className="bm-grad-icon">
                <EventIcon eventKey={eventKey} />
              </span>
              <h3 className="bm-event-title bm-event-title-lg">{eventLabel(eventKey)}</h3>
            </div>
            <div className="bm-hasil-grid">
              {TEAMS.map((team) => {
                const roster = rosters[eventKey][team];
                const teamPl = placements[eventKey]?.[team] || {};
                return (
                  <div key={team} className={`bm-hasil-team team-${team.toLowerCase()}`}>
                    <div className="bm-hasil-team-head">
                      <div className="bm-row bm-gap-2 bm-hasil-team-name">
                        <span className="bm-grad-badge bm-grad-badge-sm">{team}</span>
                        <span>{teamName(eventKey, team)}</span>
                      </div>
                      <span className="bm-meta">{s.playersCount(roster.length)}</span>
                    </div>
                    <div className="bm-stack-sm">
                      {config[eventKey].buildings.map((b) => {
                        const slots = teamPl[b.id] || [];
                        const filled = slots.filter(Boolean).length;
                        return (
                          <div key={b.id} className="bm-hasil-building">
                            <div className="bm-between bm-hasil-building-head">
                              <span>◆ {b.name}</span>
                              <span className="bm-meta">
                                {filled}/{b.slots}
                              </span>
                            </div>
                            <ol className="bm-hasil-list">
                              {slots.map((id, i) => {
                                const p = id ? playerById.get(id) : undefined;
                                return (
                                  <li key={i}>
                                    <span className="bm-hasil-no">{i + 1}.</span>
                                    {p ? (
                                      <>
                                        <span className="bm-hasil-name">{p.name}</span>
                                        <span className="bm-meta">{p.power}</span>
                                      </>
                                    ) : (
                                      dash
                                    )}
                                  </li>
                                );
                              })}
                            </ol>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  };

  const tabs: { k: TabKey; label: string; icon: ReactNode; count?: number }[] = [
    { k: 'pemain', label: s.tabPlayers, icon: <Users size={14} />, count: players.length },
    { k: 'gurun', label: s.tabGurun, icon: <Wind size={14} /> },
    { k: 'ngarai', label: s.tabNgarai, icon: <Mountain size={14} /> },
    { k: 'hasil', label: s.tabResults, icon: <ClipboardList size={14} /> },
  ];

  // ─── Main render ────────────────────────────────────────
  return (
    <div className="bm">
      <header className="bm-header no-print">
        <div className="bm-header-top">
          <div className="bm-kicker">
            <Sparkles size={11} /> {s.kicker}
          </div>
          <div className="bm-stats">
            <div className="bm-stat">
              <div className="bm-stat-label">{s.statPlayers}</div>
              <div className="bm-stat-value">{players.length}</div>
            </div>
            <div className="bm-stat ev-gurun">
              <div className="bm-stat-label">{s.statVoteGurun}</div>
              <div className="bm-stat-value">{gurunVoteCount}</div>
            </div>
            <div className="bm-stat ev-ngarai">
              <div className="bm-stat-label">{s.statVoteNgarai}</div>
              <div className="bm-stat-value">{ngaraiVoteCount}</div>
            </div>
          </div>
        </div>
        <nav className="bm-tabs" role="tablist">
          {tabs.map(({ k, label, icon, count }) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === k}
              key={k}
              className={`bm-tab tab-${k}${tab === k ? ' active' : ''}`}
              onClick={() => setTab(k)}
            >
              {icon} {label}
              {count !== undefined && <span className="bm-tab-count">({count})</span>}
            </button>
          ))}
        </nav>
      </header>

      <div className="bm-fade" key={tab}>
        {tab === 'pemain' && renderPemainTab()}
        {tab === 'gurun' && renderEventTab('gurun')}
        {tab === 'ngarai' && renderEventTab('ngarai')}
        {tab === 'hasil' && renderHasilTab()}
      </div>

      <footer className="bm-footer no-print">{s.footer}</footer>
    </div>
  );
}
