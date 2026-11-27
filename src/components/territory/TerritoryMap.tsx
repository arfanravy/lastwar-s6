import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as RPointerEvent } from 'react';
import { Copy, Download, Eraser, Eye, Minus, Pencil, Plus, Trash2, Upload, Users } from 'lucide-react';
import type { Lang } from '../../config';
import topAlliances from '../../data/top-alliances.json';
import { AREAS, AREA_TYPES, BUFFS, SIZE, assignable, components } from '../../lib/territory/layout';
import type { AreaType, Buff } from '../../lib/territory/layout';
import { buffNames, strings, typeNames } from './i18n';
import './territory.css';

// ─── Data model ──────────────────────────────────────────────────────────────

interface Alliance {
  id: string;
  name: string;
  color: string;
}

interface Plan {
  id: string;
  name: string;
  alliances: Alliance[];
  /** area idx → alliance id */
  owner: Record<number, string>;
  /** alliance id → ordered area idx list */
  paths: Record<string, number[]>;
}

interface Settings {
  labels: boolean;
  buffs: boolean;
  colorBlind: boolean;
  buffTotals: boolean;
  pathMode: boolean;
  zoom: number;
}

interface Store {
  v: 1;
  plans: Plan[];
  activeId: string;
  settings: Settings;
}

// v2: real warzone layout (area indexes differ from the v1 estimate)
const STORAGE_KEY = 'rimba.territory.v2';
const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#ffe119'];
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'star', 'ring', 'bar'] as const;
const ABBR: Record<AreaType, string> = { WS: 'WS', WA: 'WA', WB: 'WB', WV: 'WV', TP: 'TP', CON: 'CON', WO: 'WO', FG: 'FG' };
const ZOOMS = [1, 1.5, 2, 3];
/** Fishing Grounds and the Sanctuary first, cities on top. */
const DRAW_ORDER = [...AREAS.filter((a) => !a.city), ...AREAS.filter((a) => a.city)];

const uid = () => Math.random().toString(36).slice(2, 10);

const DEFAULT_SETTINGS: Settings = { labels: true, buffs: false, colorBlind: false, buffTotals: true, pathMode: false, zoom: 1 };

function newPlan(name: string): Plan {
  return { id: uid(), name, alliances: [], owner: {}, paths: {} };
}

function sanitizePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<Plan>;
  if (!Array.isArray(p.alliances)) return null;
  const alliances = p.alliances
    .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string')
    .map((a) => ({ id: a.id, name: a.name.slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : PALETTE[0] }));
  const ids = new Set(alliances.map((a) => a.id));
  const owner: Record<number, string> = {};
  for (const [k, v] of Object.entries(p.owner ?? {})) {
    const i = Number(k);
    if (AREAS[i] && assignable(AREAS[i]) && ids.has(v as string)) owner[i] = v as string;
  }
  const paths: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(p.paths ?? {}))
    if (ids.has(k) && Array.isArray(v)) paths[k] = v.filter((i) => Number.isInteger(i) && AREAS[i]);
  return { id: typeof p.id === 'string' ? p.id : uid(), name: String(p.name ?? 'Plan').slice(0, 60), alliances, owner, paths };
}

function loadStore(defaultName: string): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw && Array.isArray(raw.plans)) {
      const plans = raw.plans.map(sanitizePlan).filter(Boolean) as Plan[];
      if (plans.length) {
        const activeId = plans.some((p) => p.id === raw.activeId) ? raw.activeId : plans[0].id;
        return { v: 1, plans, activeId, settings: { ...DEFAULT_SETTINGS, ...raw.settings } };
      }
    }
  } catch {
    /* storage unavailable or corrupt → start fresh */
  }
  const p = newPlan(defaultName);
  return { v: 1, plans: [p], activeId: p.id, settings: DEFAULT_SETTINGS };
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────

function Shape({ kind, x, y, s, color }: { kind: (typeof SHAPES)[number]; x: number; y: number; s: number; color: string }) {
  const common = { fill: color, stroke: '#000', strokeWidth: 0.04 };
  switch (kind) {
    case 'circle':
      return <circle cx={x} cy={y} r={s / 2} {...common} />;
    case 'square':
      return <rect x={x - s / 2} y={y - s / 2} width={s} height={s} {...common} />;
    case 'triangle':
      return <polygon points={`${x},${y - s / 2} ${x + s / 2},${y + s / 2} ${x - s / 2},${y + s / 2}`} {...common} />;
    case 'diamond':
      return <polygon points={`${x},${y - s / 2} ${x + s / 2},${y} ${x},${y + s / 2} ${x - s / 2},${y}`} {...common} />;
    case 'cross':
      return (
        <path
          d={`M${x - s / 2} ${y - s / 2}L${x + s / 2} ${y + s / 2}M${x + s / 2} ${y - s / 2}L${x - s / 2} ${y + s / 2}`}
          stroke={color}
          strokeWidth={0.12}
        />
      );
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? s / 4.5 : s / 2;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`;
      }).join(' ');
      return <polygon points={pts} {...common} />;
    }
    case 'ring':
      return <circle cx={x} cy={y} r={s / 2.4} fill="none" stroke={color} strokeWidth={0.1} />;
    case 'bar':
      return <rect x={x - s / 2} y={y - s / 7} width={s} height={s / 3.5} {...common} />;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TerritoryMap({ lang }: { lang: Lang }) {
  const t = strings[lang];
  const tn = typeNames[lang];
  const bn = buffNames[lang];

  const [store, setStore] = useState<Store>(() => loadStore(t.defaultPlan));
  const [selAlliance, setSelAlliance] = useState<string | null>(null);
  const [selArea, setSelArea] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: 'paint' | 'erase'; seen: Set<number> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* ignore quota/private mode */
    }
  }, [store]);

  const plan = store.plans.find((p) => p.id === store.activeId) ?? store.plans[0];
  const s = store.settings;
  const allianceById = useMemo(() => new Map(plan.alliances.map((a, i) => [a.id, { ...a, i }])), [plan.alliances]);

  useEffect(() => {
    if (selAlliance && !allianceById.has(selAlliance)) setSelAlliance(null);
  }, [allianceById, selAlliance]);

  const updatePlan = (fn: (p: Plan) => Plan) =>
    setStore((st) => ({ ...st, plans: st.plans.map((p) => (p.id === st.activeId ? fn(p) : p)) }));
  const setSetting = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setStore((st) => ({ ...st, settings: { ...st.settings, [k]: v } }));

  // ── Stats ──
  const stats = useMemo(() => {
    const per = new Map<
      string,
      { cells: number[]; types: Partial<Record<AreaType, number>>; buffs: Partial<Record<Buff, number>>; influence: number }
    >();
    for (const a of plan.alliances) per.set(a.id, { cells: [], types: {}, buffs: {}, influence: 0 });
    const ownedByType: Partial<Record<AreaType, number>> = {};
    for (const [k, aid] of Object.entries(plan.owner)) {
      const area = AREAS[Number(k)];
      const st = per.get(aid);
      if (!st) continue;
      st.cells.push(area.idx);
      st.types[area.type] = (st.types[area.type] ?? 0) + 1;
      if (area.buff) st.buffs[area.buff] = (st.buffs[area.buff] ?? 0) + (area.pct ?? 0);
      st.influence += area.influence ?? 0;
      ownedByType[area.type] = (ownedByType[area.type] ?? 0) + 1;
    }
    return { per, ownedByType };
  }, [plan]);

  const typeCounts = useMemo(() => {
    const c: Partial<Record<AreaType, number>> = {};
    for (const a of AREAS) c[a.type] = (c[a.type] ?? 0) + 1;
    return c;
  }, []);

  // ── Map interaction ──
  const idxFromEvent = (e: RPointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
    const v = el?.closest('[data-idx]')?.getAttribute('data-idx');
    return v == null ? null : Number(v);
  };

  const applyPaint = (idx: number, mode: 'paint' | 'erase') => {
    if (!selAlliance || !assignable(AREAS[idx])) return;
    updatePlan((p) => {
      const owner = { ...p.owner };
      if (mode === 'paint') owner[idx] = selAlliance;
      else if (owner[idx] === selAlliance) delete owner[idx];
      return { ...p, owner };
    });
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const idx = idxFromEvent(e);
    if (idx == null) return;
    setSelArea(idx);
    if (!selAlliance) return;
    if (s.pathMode) {
      updatePlan((p) => {
        const path = [...(p.paths[selAlliance] ?? [])];
        if (path[path.length - 1] === idx) path.pop();
        else path.push(idx);
        return { ...p, paths: { ...p.paths, [selAlliance]: path } };
      });
      return;
    }
    if (!assignable(AREAS[idx])) return;
    const mode = plan.owner[idx] === selAlliance ? 'erase' : 'paint';
    drag.current = { mode, seen: new Set([idx]) };
    svgRef.current?.setPointerCapture(e.pointerId);
    applyPaint(idx, mode);
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const idx = idxFromEvent(e);
    if (idx == null || d.seen.has(idx)) return;
    d.seen.add(idx);
    applyPaint(idx, d.mode);
  };

  const endDrag = () => {
    drag.current = null;
  };

  // ── Alliances ──
  const addAlliance = (name: string, color?: string) => {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    const a: Alliance = { id: uid(), name: n, color: color ?? PALETTE[plan.alliances.length % PALETTE.length] };
    updatePlan((p) => ({ ...p, alliances: [...p.alliances, a] }));
    setSelAlliance(a.id);
  };

  const importTop5 = () => {
    const list = (topAlliances.servers as Record<string, { tag: string }[]>)['1196'] ?? [];
    updatePlan((p) => {
      const have = new Set(p.alliances.map((a) => a.name.toLowerCase()));
      const add = list
        .filter((x) => !have.has(x.tag.toLowerCase()))
        .map((x, i) => ({ id: uid(), name: x.tag, color: PALETTE[(p.alliances.length + i) % PALETTE.length] }));
      return { ...p, alliances: [...p.alliances, ...add] };
    });
  };

  const removeAlliance = (id: string) => {
    updatePlan((p) => {
      const owner = Object.fromEntries(Object.entries(p.owner).filter(([, v]) => v !== id));
      const paths = { ...p.paths };
      delete paths[id];
      return { ...p, alliances: p.alliances.filter((a) => a.id !== id), owner, paths };
    });
  };

  const clearAlliance = (id: string) => {
    if (!confirm(t.confirmClear)) return;
    updatePlan((p) => {
      const owner = Object.fromEntries(Object.entries(p.owner).filter(([, v]) => v !== id));
      const paths = { ...p.paths };
      delete paths[id];
      return { ...p, owner, paths };
    });
  };

  const editAlliance = (id: string, patch: Partial<Alliance>) =>
    updatePlan((p) => ({ ...p, alliances: p.alliances.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));

  // ── Plans ──
  const addPlan = (copy: boolean) => {
    const base = copy ? { ...structuredClone(plan), id: uid(), name: `${plan.name} (2)` } : newPlan(`${t.defaultPlan} ${store.plans.length + 1}`);
    setStore((st) => ({ ...st, plans: [...st.plans, base], activeId: base.id }));
  };
  const renamePlan = () => {
    const n = prompt(t.planName, plan.name);
    if (n?.trim()) updatePlan((p) => ({ ...p, name: n.trim().slice(0, 60) }));
  };
  const deletePlan = () => {
    if (!confirm(t.confirmDeletePlan)) return;
    setStore((st) => {
      const plans = st.plans.filter((p) => p.id !== st.activeId);
      if (!plans.length) plans.push(newPlan(t.defaultPlan));
      return { ...st, plans, activeId: plans[0].id };
    });
  };
  const exportPlan = () => {
    const blob = new Blob([JSON.stringify({ kind: 'rimba-territory', size: SIZE, plan }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wilayah-1196-${plan.name.replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importPlan = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const raw = JSON.parse(await f.text());
      const p = sanitizePlan(raw?.plan ?? raw);
      if (!p) throw new Error();
      p.id = uid();
      setStore((st) => ({ ...st, plans: [...st.plans, p], activeId: p.id }));
    } catch {
      alert(t.importFailed);
    }
  };

  // ── Render ──
  const hint = !selAlliance ? t.hintView : s.pathMode ? t.hintPath : t.hintPaint;
  const sel = selArea != null ? AREAS[selArea] : null;
  const selOwner = sel ? allianceById.get(plan.owner[sel.idx]) : undefined;

  return (
    <div className="tm">
      <p className="tm-note">{t.estimateNote}</p>

      <div className="tm-bar card">
        <label className="tm-field">
          <span>{t.plans}</span>
          <select value={plan.id} onChange={(e) => setStore((st) => ({ ...st, activeId: e.target.value }))}>
            {store.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="tm-btns">
          <button type="button" className="tm-btn" onClick={() => addPlan(false)}>
            <Plus size={15} /> {t.newPlan}
          </button>
          <button type="button" className="tm-btn" onClick={() => addPlan(true)}>
            <Copy size={15} /> {t.duplicate}
          </button>
          <button type="button" className="tm-btn" onClick={renamePlan}>
            <Pencil size={15} /> {t.rename}
          </button>
          <button type="button" className="tm-btn" onClick={exportPlan}>
            <Download size={15} /> {t.exportJson}
          </button>
          <button type="button" className="tm-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {t.importJson}
          </button>
          <button type="button" className="tm-btn tm-danger" onClick={deletePlan}>
            <Trash2 size={15} /> {t.remove}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importPlan} />
        </div>
      </div>

      <div className="tm-layout">
        <section className="tm-mapcol">
          <div className="tm-maptools">
            <span className="tm-hint">{hint}</span>
            <div className="tm-zoom" role="group" aria-label={t.zoom}>
              <button
                type="button"
                className="tm-icon"
                aria-label="-"
                disabled={s.zoom <= ZOOMS[0]}
                onClick={() => setSetting('zoom', ZOOMS[Math.max(0, ZOOMS.indexOf(s.zoom) - 1)])}
              >
                <Minus size={15} />
              </button>
              <span>{s.zoom}×</span>
              <button
                type="button"
                className="tm-icon"
                aria-label="+"
                disabled={s.zoom >= ZOOMS[ZOOMS.length - 1]}
                onClick={() => setSetting('zoom', ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(s.zoom) + 1)])}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
          <div className="tm-scroll">
            <svg
              ref={svgRef}
              className={`tm-svg${selAlliance ? ' tm-painting' : ''}`}
              style={{ width: `${s.zoom * 100}%` }}
              viewBox={`-4 -4 ${SIZE + 8} ${SIZE + 8}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="img"
              aria-label="Territory map #1196"
            >
              <rect x={0} y={0} width={SIZE} height={SIZE} className="tm-bg" />
              {DRAW_ORDER.map((a) => {
                const own = allianceById.get(plan.owner[a.idx]);
                const fillCls = s.buffs && a.buff && !own ? ` tm-b-${a.buff}` : '';
                const title = `${tn[a.type]} · Lv. ${a.level}${a.buff ? ` · ${bn[a.buff]} +${a.pct}%` : ''}${own ? ` · ${own.name}` : ''}`;
                const ownStyle = own ? { fill: own.color, fillOpacity: a.city ? 0.95 : 0.62 } : undefined;
                const shape = own && s.colorBlind && (
                  <Shape
                    kind={SHAPES[own.i % SHAPES.length]}
                    x={a.city ? a.cx + 15 : a.cx}
                    y={a.city ? a.cy - 15 : a.cy}
                    s={a.city ? 14 : 22}
                    color={a.city ? '#fff' : own.color}
                  />
                );
                if (!a.city)
                  return (
                    <g key={a.idx} data-idx={a.idx}>
                      <title>{title}</title>
                      <rect
                        x={a.x}
                        y={a.y}
                        width={a.w}
                        height={a.h}
                        className={`tm-fg tm-fg-${a.type === 'WS' ? 'ws' : a.level}${fillCls}${selArea === a.idx ? ' tm-sel' : ''}`}
                        style={ownStyle}
                      />
                      {a.type === 'WS' && (
                        <text x={a.cx} y={a.cy} className="tm-lbl tm-lbl-ws">
                          <tspan x={a.cx} dy={-2}>
                            WS
                          </tspan>
                          <tspan x={a.cx} dy={12} className="tm-lv">
                            Lv. {a.level}
                          </tspan>
                        </text>
                      )}
                      {shape}
                    </g>
                  );
                return (
                  <g key={a.idx} data-idx={a.idx}>
                    <title>{title}</title>
                    <rect
                      x={a.cx - 18}
                      y={a.cy - 18}
                      width={36}
                      height={36}
                      className={`tm-city${fillCls}${selArea === a.idx ? ' tm-sel' : ''}`}
                      style={ownStyle}
                    />
                    {s.labels && (
                      <text x={a.cx} y={a.cy} className={`tm-lbl${own ? ' tm-lbl-own' : ''}`}>
                        <tspan x={a.cx} dy={-2}>
                          {ABBR[a.type]}
                        </tspan>
                        <tspan x={a.cx} dy={11} className="tm-lv">
                          Lv. {a.level}
                        </tspan>
                      </text>
                    )}
                    {shape}
                  </g>
                );
              })}
              {plan.alliances.map((al) => {
                const path = plan.paths[al.id];
                if (!path?.length) return null;
                const pts = path.map((i) => `${AREAS[i].cx},${AREAS[i].cy}`).join(' ');
                return (
                  <g key={al.id} className="tm-path" pointerEvents="none">
                    <polyline points={pts} fill="none" stroke={al.color} strokeWidth={6} strokeLinejoin="round" />
                    {path.map((i, n) => (
                      <g key={n}>
                        <circle cx={AREAS[i].cx} cy={AREAS[i].cy} r={13} fill={al.color} stroke="#000" strokeWidth={2} />
                        <text x={AREAS[i].cx} y={AREAS[i].cy + 5} className="tm-pathnum">
                          {n + 1}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="tm-info card">
            <strong>{t.selected}:</strong>{' '}
            {sel ? (
              <>
                {tn[sel.type]} · Lv. {sel.level}
                {sel.buff ? ` · ${bn[sel.buff]} +${sel.pct}%` : ''}
                {sel.influence ? ` · ${t.influence} ${sel.influence.toLocaleString(lang)}` : ''} · {t.owner}:{' '}
                {selOwner ? selOwner.name : t.none}
                {!assignable(sel) && <em> · {t.notAssignable}</em>}
              </>
            ) : (
              '—'
            )}
          </div>
        </section>

        <aside className="tm-side">
          <div className="card">
            <h3>
              <Users size={17} /> {t.alliances}
            </h3>
            <form
              className="tm-add"
              onSubmit={(e) => {
                e.preventDefault();
                addAlliance(newName);
                setNewName('');
              }}
            >
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t.allianceName} maxLength={40} />
              <button type="submit" className="tm-btn">
                <Plus size={15} /> {t.addAlliance}
              </button>
            </form>
            <button type="button" className="tm-btn tm-wide" onClick={importTop5}>
              {t.importTop5}
            </button>
            <ul className="tm-alist">
              <li>
                <label className={`tm-aitem${selAlliance === null ? ' on' : ''}`}>
                  <input type="radio" name="tm-al" checked={selAlliance === null} onChange={() => setSelAlliance(null)} />
                  <Eye size={15} /> {t.viewMode}
                </label>
              </li>
              {plan.alliances.map((a, i) => (
                <li key={a.id} className={`tm-aitem${selAlliance === a.id ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="tm-al"
                    aria-label={a.name}
                    checked={selAlliance === a.id}
                    onChange={() => setSelAlliance(a.id)}
                  />
                  <input
                    type="color"
                    value={a.color}
                    aria-label={`${a.name} color`}
                    onChange={(e) => editAlliance(a.id, { color: e.target.value })}
                  />
                  {s.colorBlind && (
                    <svg width="16" height="16" viewBox="0 0 1 1" aria-hidden="true">
                      <Shape kind={SHAPES[i % SHAPES.length]} x={0.5} y={0.5} s={0.8} color={a.color} />
                    </svg>
                  )}
                  <input
                    className="tm-aname"
                    value={a.name}
                    maxLength={40}
                    onFocus={() => setSelAlliance(a.id)}
                    onChange={(e) => editAlliance(a.id, { name: e.target.value })}
                  />
                  <span className="tm-count">{stats.per.get(a.id)?.cells.length ?? 0}</span>
                  <button type="button" className="tm-icon" title={t.clearAlliance} onClick={() => clearAlliance(a.id)}>
                    <Eraser size={14} />
                  </button>
                  <button type="button" className="tm-icon tm-danger" title={t.remove} onClick={() => removeAlliance(a.id)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3>{t.settings}</h3>
            {(
              [
                ['labels', t.showLabels],
                ['buffs', t.buffColors],
                ['colorBlind', t.colorBlind],
                ['buffTotals', t.buffTotals],
                ['pathMode', t.pathMode],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="tm-toggle">
                <input type="checkbox" checked={s[k]} onChange={(e) => setSetting(k, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>

          <div className="card">
            <h3>{t.legend}</h3>
            <table className="tm-legend">
              <thead>
                <tr>
                  <th />
                  <th>{t.areas}</th>
                  <th>{t.owned}</th>
                </tr>
              </thead>
              <tbody>
                {AREA_TYPES.map((ty) => (
                  <tr key={ty}>
                    <td>
                      <span className={`tm-swatch tm-c-${ty}`} />
                      <b>{ABBR[ty]}</b> {tn[ty]}
                    </td>
                    <td>{typeCounts[ty] ?? 0}</td>
                    <td>{stats.ownedByType[ty] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.buffs && (
              <div className="tm-bufflegend">
                {BUFFS.map((b) => (
                  <span key={b}>
                    <span className={`tm-swatch tm-b-${b}`} /> {bn[b]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {plan.alliances.length > 0 && (
        <div className="card tm-summary">
          <h3>{t.summary}</h3>
          <div className="tm-tablewrap">
            <table>
              <thead>
                <tr>
                  <th>{t.alliances}</th>
                  <th>{t.total}</th>
                  {AREA_TYPES.filter((ty) => ty !== 'WS').map((ty) => (
                    <th key={ty} title={tn[ty]}>
                      {ABBR[ty]}
                    </th>
                  ))}
                  {s.buffTotals && BUFFS.map((b) => <th key={b}>{bn[b]}</th>)}
                  <th>{t.influence}</th>
                  <th>{t.blocks}</th>
                  <th>{t.pathLen}</th>
                </tr>
              </thead>
              <tbody>
                {plan.alliances.map((a) => {
                  const st = stats.per.get(a.id)!;
                  const blocks = components(st.cells);
                  return (
                    <tr key={a.id}>
                      <td>
                        <span className="tm-swatch" style={{ background: a.color }} /> {a.name}
                      </td>
                      <td>
                        <b>{st.cells.length}</b>
                      </td>
                      {AREA_TYPES.filter((ty) => ty !== 'WS').map((ty) => (
                        <td key={ty}>{st.types[ty] ?? 0}</td>
                      ))}
                      {s.buffTotals && BUFFS.map((b) => <td key={b}>{st.buffs[b] ? `+${+st.buffs[b]!.toFixed(1)}%` : '–'}</td>)}
                      <td>{st.influence.toLocaleString(lang)}</td>
                      <td className={blocks > 1 ? 'tm-warn' : ''} title={blocks > 1 ? t.blocksWarn : undefined}>
                        {blocks}
                        {blocks > 1 ? ' ⚠' : ''}
                      </td>
                      <td>{plan.paths[a.id]?.length ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {[...stats.per.values()].some((st) => components(st.cells) > 1) && <p className="tm-warnline">⚠ {t.blocksWarn}</p>}
        </div>
      )}
    </div>
  );
}
