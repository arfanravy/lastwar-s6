/**
 * Alliance map planner — client logic.
 * Ported from the standalone "LASTWAR // MAP COMMAND" planner (vanilla JS).
 * All DOM lookups are scoped to the planner root; ids are prefixed with `pl-`.
 */
import { fmt, SQUAD_COLORS, SQUADS, type PlannerStrings, type Squad } from './i18n';
// Type-only: the 3D modules (and `three`) are loaded with a dynamic import() on first use.
import type { Planner3DHandle, Planner3DModel } from './scene3d';
import { ALLIANCE_PRESETS, normName, type AlliancePreset } from '../alliances';

type Player = { id: number; name: string; squad: Squad };
type PObject = { id: number; name: string; color: string; symbol: string; size?: number };
type Placement = { type: 'player' | 'object'; id: number };

type Snapshot = {
  players: Player[];
  objects: PObject[];
  placements: Record<string, Placement>;
  gridCols: number;
  gridRows: number;
  coordStartX: number;
  coordStartY: number;
  cellSize: number;
  nextPid: number;
  nextOid: number;
  savedAt: number;
  gridSize?: number; // legacy square saves
};

const BASE_SIZE = 3; // player base footprint is always 3x3
const MIN_OBJECT_SIZE = 1;
const MAX_OBJECT_SIZE = 20;
const MAX_GRID_DIM = 120; // keep the DOM grid light enough for the browser
const MAX_COORD = 999; // world coordinates max out at X 999 / Y 999
const DEFAULT_COLOR = '#d8a040';
const LOADOUTS_KEY = 'lastwar:loadouts';
const AUTOSAVE_KEY = 'lastwar:autosave:v999';
const MOBILE_MAX = 860;

export function escapeHtml(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function safeColor(c: unknown): string {
  return typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c) ? c : DEFAULT_COLOR;
}
function squadColor(s: unknown): string {
  return SQUAD_COLORS[s as Squad] ?? SQUAD_COLORS.R5;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function getInitials(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const LS = {
  available: (() => {
    try {
      const k = '__lw_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  })(),
  get(key: string): string | null {
    if (!this.available) return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, val: string): boolean {
    if (!this.available) return false;
    try {
      window.localStorage.setItem(key, val);
      return true;
    } catch {
      return false;
    }
  },
};

export function initPlanner(root: HTMLElement, T: PlannerStrings): void {
  const $ = <E extends HTMLElement = HTMLElement>(id: string) => root.querySelector<E>('#pl-' + id)!;
  const $$ = <E extends HTMLElement = HTMLElement>(sel: string) => Array.from(root.querySelectorAll<E>(sel));

  const state = {
    players: [] as Player[],
    objects: [] as PObject[],
    placements: {} as Record<string, Placement>,
    gridCols: 10,
    gridRows: 10,
    coordStartX: 0,
    coordStartY: 0,
    cellSize: 18,
    selectedSquad: 'R5' as Squad,
    selectedColor: DEFAULT_COLOR,
    selectedSymbol: '♛',
    selected: null as Placement | null,
    activeTab: 'players' as 'players' | 'objects',
  };
  let nextPid = 1;
  let nextOid = 1;
  let hasAutosave = false;
  let onItemSelected: (() => void) | null = null;

  // 2D / 3D view. 2D is the default; the 3D scene is created lazily.
  let viewMode: '2d' | '3d' = '2d';
  let view3d: Planner3DHandle | null = null;
  let loading3d = false;
  let grid2dStale = false; // the DOM grid is not re-rendered while the 3D view is showing
  const is3d = () => viewMode === '3d';

  const grid = $('grid');

  // ---------- coordinate helpers (origin bottom-left) ----------
  const gridToWorldX = (x: number) => state.coordStartX + x;
  const gridToWorldY = (y: number) => state.coordStartY + (state.gridRows - 1 - y);
  const worldToGridX = (x: number) => x - state.coordStartX;
  const worldToGridY = (y: number) => state.gridRows - 1 - (y - state.coordStartY);
  const displayCoordLabel = (x: number, y: number) => 'X:' + gridToWorldX(x) + ' / Y:' + gridToWorldY(y);

  // ---------- map centre ----------
  // Users set the map by its CENTRE coordinate. For an even size the centre is
  // the lower-left of the two middle cells. Storage still keeps coordStartX/Y
  // (bottom-left) so saved layouts and exports stay compatible.
  const centerOffset = (n: number) => Math.floor((n - 1) / 2);
  const centerWorldX = () => state.coordStartX + centerOffset(state.gridCols);
  const centerWorldY = () => state.coordStartY + centerOffset(state.gridRows);
  const centerGridX = (cols = state.gridCols) => centerOffset(cols);
  const centerGridY = (rows = state.gridRows) => rows - 1 - centerOffset(rows); // grid row 0 = top

  /** Move placements so they keep the same offset from the map centre after a resize. */
  function remapPlacements(cols: number, rows: number) {
    const dx = centerGridX(cols) - centerGridX();
    const dy = centerGridY(rows) - centerGridY();
    const kept: Record<string, Placement> = {};
    let dropped = 0;
    for (const k of Object.keys(state.placements)) {
      const [x, y] = k.split(',').map(Number);
      const nx = x + dx;
      const ny = y + dy;
      const sz = placementSize(state.placements[k]);
      if (nx < 0 || ny < 0 || nx + sz > cols || ny + sz > rows) dropped++;
      else kept[`${nx},${ny}`] = state.placements[k];
    }
    return { kept, dropped };
  }

  function clampObjectSize(v: unknown): number {
    let n = parseInt(String(v), 10);
    if (!Number.isInteger(n)) n = BASE_SIZE;
    return Math.min(MAX_OBJECT_SIZE, Math.max(MIN_OBJECT_SIZE, n));
  }
  function objectSize(o: PObject | undefined): number {
    return o && Number.isInteger(o.size) ? Math.max(MIN_OBJECT_SIZE, o.size as number) : BASE_SIZE;
  }
  function placementSize(p: Placement | null | undefined): number {
    if (p && p.type === 'object') return objectSize(state.objects.find((o) => o.id === p.id));
    return BASE_SIZE;
  }
  function displayCenterCoordText(x: number, y: number, size = BASE_SIZE): string {
    const off = Math.floor(size / 2);
    return 'X:' + gridToWorldX(x + off) + ' / Y:' + gridToWorldY(y + off);
  }
  const displayCenterCoordLabel = (x: number, y: number, size = BASE_SIZE) =>
    T.centerPrefix + ' ' + displayCenterCoordText(x, y, size);

  function excelCoordToGrid(x: number, y: number, size = BASE_SIZE): { x: number; y: number } {
    // Excel coordinates are the CENTRE of the base (as shown in game/app).
    const off = Math.floor(size / 2);
    const cgx = worldToGridX(x);
    const cgy = worldToGridY(y);
    if (cgx >= 0 && cgy >= 0 && cgx < state.gridCols && cgy < state.gridRows) {
      return { x: cgx - off, y: cgy - off };
    }
    // Fallback: legacy files that stored local 0-based anchor coordinates.
    return { x, y };
  }

  // ---------- tabs ----------
  function switchTab(name: 'players' | 'objects') {
    state.activeTab = name;
    $$('.pl-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('.pl-tab-pane').forEach((p) => p.classList.toggle('active', p.id === 'pl-pane-' + name));
    $('badge-mode').textContent = name === 'players' ? T.tabPlayers : T.tabObjects;
  }

  // ---------- grid ----------
  function renderGrid() {
    const cols = state.gridCols;
    const rows = state.gridRows;
    const cs = state.cellSize;
    const gap = 1;

    grid.style.setProperty('--cs', cs + 'px');
    grid.style.gridTemplateColumns = `repeat(${cols}, ${cs}px)`;
    grid.style.gridTemplateRows = `repeat(${rows}, ${cs}px)`;
    grid.innerHTML = '';

    const cgx = centerGridX();
    const cgy = centerGridY();
    for (let x = 0; x < cols; x++) {
      const lbl = document.createElement('div');
      lbl.className = 'pl-coord-x' + (x % 3 === 0 ? ' major' : '') + (x === cgx ? ' center' : '');
      lbl.textContent = String(state.coordStartX + x);
      lbl.style.left = x * (cs + gap) + cs / 2 + 'px';
      grid.appendChild(lbl);
    }
    for (let y = 0; y < rows; y++) {
      const dispY = gridToWorldY(y);
      const lbl = document.createElement('div');
      lbl.className =
        'pl-coord-y' + ((dispY - state.coordStartY) % 3 === 0 ? ' major' : '') + (y === cgy ? ' center' : '');
      lbl.textContent = String(dispY);
      lbl.style.top = y * (cs + gap) + cs / 2 + 'px';
      grid.appendChild(lbl);
    }

    const frag = document.createDocumentFragment();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cell = document.createElement('div');
        cell.className = 'pl-cell' + (x === cgx && y === cgy ? ' pl-cell-center' : '');
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        cell.title = displayCoordLabel(x, y);
        frag.appendChild(cell);
      }
    }
    grid.appendChild(frag);

    Object.entries(state.placements).forEach(([key, p]) => {
      const [x, y] = key.split(',').map(Number);
      const marker = buildMarker(p, x, y);
      if (!marker) return;
      const sz = placementSize(p);
      marker.style.setProperty('--cells', String(sz));
      marker.title = displayCenterCoordLabel(x, y, sz);
      marker.style.left = x * (cs + gap) + 'px';
      marker.style.top = y * (cs + gap) + 'px';
      marker.style.width = sz * cs + (sz - 1) * gap + 'px';
      marker.style.height = sz * cs + (sz - 1) * gap + 'px';
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        removePlacement(key);
      });
      grid.appendChild(marker);
    });
  }

  /** Withdraw a deployed unit (click on a 2D marker or on a 3D building). */
  function removePlacement(key: string) {
    if (!(key in state.placements)) return;
    delete state.placements[key];
    renderAll();
  }

  // Delegated cell events (one listener instead of one per cell).
  const cellFromEvent = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return t && t.classList.contains('pl-cell') ? t : null;
  };
  grid.addEventListener('mouseover', (e) => {
    const c = cellFromEvent(e);
    if (c) onCellHover(Number(c.dataset.x), Number(c.dataset.y));
  });
  grid.addEventListener('mouseleave', clearPreview);
  grid.addEventListener('mouseout', (e) => {
    if (cellFromEvent(e)) clearPreview();
  });
  grid.addEventListener('click', (e) => {
    const c = cellFromEvent(e);
    if (c) onCellClick(Number(c.dataset.x), Number(c.dataset.y));
  });

  function buildMarker(placement: Placement, ax = 0, ay = 0): HTMLElement | null {
    const m = document.createElement('div');
    m.className = 'pl-marker';
    const centerCoord = escapeHtml(displayCenterCoordText(ax, ay, placementSize(placement)));

    if (placement.type === 'player') {
      const player = state.players.find((p) => p.id === placement.id);
      if (!player) return null;
      const color = squadColor(player.squad);
      m.style.color = color;
      m.style.setProperty('--base-color', color);
      m.innerHTML = `
        <div class="dome"></div>
        <div class="footprint"></div>
        <div class="tier-badge">${escapeHtml(player.squad)}</div>
        <div class="center-content"><div class="initials">${escapeHtml(getInitials(player.name))}</div></div>
        <div class="name-banner">
          <div class="banner-name">${escapeHtml(player.name)}</div>
          <div class="coord-center">${centerCoord}</div>
        </div>`;
    } else {
      const obj = state.objects.find((o) => o.id === placement.id);
      if (!obj) return null;
      const color = safeColor(obj.color);
      m.classList.add('is-object');
      m.style.color = color;
      m.style.setProperty('--base-color', color);
      m.innerHTML = `
        <div class="dome"></div>
        <div class="footprint"></div>
        <div class="obj-tag">${escapeHtml(T.objTag)}</div>
        <div class="center-content"><div class="symbol-glyph">${escapeHtml(obj.symbol)}</div></div>
        <div class="name-banner">
          <div class="banner-name">${escapeHtml(obj.name)}</div>
          <div class="coord-center">${centerCoord}</div>
        </div>`;
    }
    return m;
  }

  function getOccupiedCells(): Set<string> {
    const occ = new Set<string>();
    Object.entries(state.placements).forEach(([k, p]) => {
      const [x, y] = k.split(',').map(Number);
      const sz = placementSize(p);
      for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) occ.add(`${x + dx},${y + dy}`);
    });
    return occ;
  }

  function canPlace(ax: number, ay: number, occupied: Set<string>, size = BASE_SIZE): boolean {
    if (ax < 0 || ay < 0) return false;
    if (ax + size > state.gridCols) return false;
    if (ay + size > state.gridRows) return false;
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) if (occupied.has(`${ax + dx},${ay + dy}`)) return false;
    return true;
  }

  const cellAt = (x: number, y: number) => grid.querySelector<HTMLElement>(`.pl-cell[data-x="${x}"][data-y="${y}"]`);

  function clearPreview() {
    grid.querySelectorAll('.pl-cell.preview-ok, .pl-cell.preview-bad').forEach((c) => {
      c.classList.remove('preview-ok', 'preview-bad');
    });
  }

  function onCellHover(x: number, y: number) {
    clearPreview();
    if (!state.selected) return;
    const sz = placementSize(state.selected);
    const ok = canPlace(x, y, getOccupiedCells(), sz);
    for (let dy = 0; dy < sz; dy++) {
      for (let dx = 0; dx < sz; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx >= state.gridCols || cy >= state.gridRows) continue;
        cellAt(cx, cy)?.classList.add(ok ? 'preview-ok' : 'preview-bad');
      }
    }
  }

  function onCellClick(x: number, y: number) {
    if (!state.selected) return;
    const sz = placementSize(state.selected);
    if (!canPlace(x, y, getOccupiedCells(), sz)) {
      for (let dy = 0; dy < sz; dy++) {
        for (let dx = 0; dx < sz; dx++) {
          const cell = cellAt(x + dx, y + dy);
          if (cell) {
            cell.classList.add('preview-bad');
            setTimeout(() => cell.classList.remove('preview-bad'), 400);
          }
        }
      }
      return;
    }
    state.placements[`${x},${y}`] = { ...state.selected };
    state.selected = null;
    renderAll();
    updatePlacementIndicator();
    clearPreview();
  }

  // ---------- roster ----------
  function addPlayer() {
    const input = $<HTMLInputElement>('inp-pname');
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    state.players.push({ id: nextPid++, name, squad: state.selectedSquad });
    input.value = '';
    input.focus();
    renderLists();
    updateStats();
    autosave();
  }

  function addObject() {
    const input = $<HTMLInputElement>('inp-oname');
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    const size = clampObjectSize($<HTMLInputElement>('inp-osize').value);
    state.objects.push({ id: nextOid++, name, color: state.selectedColor, symbol: state.selectedSymbol, size });
    input.value = '';
    input.focus();
    renderLists();
    updateStats();
    autosave();
  }

  const isPlaced = (type: Placement['type'], id: number) =>
    Object.values(state.placements).some((p) => p.type === type && p.id === id);

  function renderLists() {
    renderPlayerList();
    renderObjectList();
  }

  function removeEntity(type: Placement['type'], id: number) {
    if (type === 'player') state.players = state.players.filter((x) => x.id !== id);
    else state.objects = state.objects.filter((x) => x.id !== id);
    Object.keys(state.placements).forEach((k) => {
      if (state.placements[k].type === type && state.placements[k].id === id) delete state.placements[k];
    });
    if (state.selected && state.selected.type === type && state.selected.id === id) state.selected = null;
    renderAll();
    updatePlacementIndicator();
  }

  function makeCard(type: Placement['type'], id: number, badgeHtml: string, name: string, meta: string) {
    const placed = isPlaced(type, id);
    const sel = !!state.selected && state.selected.type === type && state.selected.id === id;
    const card = document.createElement('div');
    card.className = 'pl-card' + (placed ? ' placed' : '') + (sel ? ' selected' : '');
    card.innerHTML = `
      ${badgeHtml}
      <div class="pl-card-info">
        <div class="pl-card-name">${escapeHtml(name)}</div>
        <div class="pl-card-meta">${escapeHtml(meta)}</div>
      </div>
      ${placed ? `<span class="pl-card-tag">${escapeHtml(T.deployedTag)}</span>` : ''}
      <button type="button" class="pl-card-del" title="${escapeHtml(T.remove)}" aria-label="${escapeHtml(T.remove)}">×</button>`;
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.pl-card-del')) return;
      if (placed) return;
      state.selected = sel ? null : { type, id };
      renderLists();
      updatePlacementIndicator();
      view3d?.selectionChanged();
      if (state.selected && onItemSelected) onItemSelected();
    });
    card.querySelector('.pl-card-del')!.addEventListener('click', (e) => {
      e.stopPropagation();
      removeEntity(type, id);
    });
    return card;
  }

  function renderPlayerList() {
    const wrap = $('list-players');
    if (state.players.length === 0) {
      wrap.innerHTML = `<div class="pl-empty"><div class="arrow">⬆</div>${T.emptyPlayers}</div>`;
      return;
    }
    const rankOrder: Record<string, number> = { R5: 0, R4: 1, R3: 2, R2: 3, R1: 4 };
    const sorted = [...state.players].sort((a, b) => {
      const pa = isPlaced('player', a.id) ? 1 : 0;
      const pb = isPlaced('player', b.id) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return (rankOrder[a.squad] ?? 9) - (rankOrder[b.squad] ?? 9);
    });
    wrap.innerHTML = '';
    sorted.forEach((p) => {
      const badge = `<div class="pl-ebadge" style="color:${squadColor(p.squad)}"><span>${escapeHtml(getInitials(p.name))}</span></div>`;
      const meta = `${p.squad} • PID-${String(p.id).padStart(3, '0')}`;
      wrap.appendChild(makeCard('player', p.id, badge, p.name, meta));
    });
  }

  function renderObjectList() {
    const wrap = $('list-objects');
    if (state.objects.length === 0) {
      wrap.innerHTML = `<div class="pl-empty"><div class="arrow">⬆</div>${T.emptyObjects}</div>`;
      return;
    }
    const sorted = [...state.objects].sort(
      (a, b) => (isPlaced('object', a.id) ? 1 : 0) - (isPlaced('object', b.id) ? 1 : 0),
    );
    wrap.innerHTML = '';
    sorted.forEach((o) => {
      const sz = objectSize(o);
      const badge = `<div class="pl-ebadge obj" style="color:${safeColor(o.color)}"><span>${escapeHtml(o.symbol)}</span></div>`;
      const meta = `${T.objectMeta} • ${sz}×${sz} • OID-${String(o.id).padStart(3, '0')}`;
      wrap.appendChild(makeCard('object', o.id, badge, o.name, meta));
    });
  }

  // ---------- indicator / stats ----------
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  function updatePlacementIndicator() {
    const ind = $('placement');
    if (flashTimer) return; // a flash message is showing; it restores the indicator itself
    if (!state.selected) {
      ind.classList.remove('show');
      return;
    }
    let label = '';
    if (state.selected.type === 'player') {
      const sid = state.selected.id;
      const p = state.players.find((x) => x.id === sid);
      if (!p) return void ind.classList.remove('show');
      label = p.name + ' [' + p.squad + ']';
    } else {
      const sid = state.selected.id;
      const o = state.objects.find((x) => x.id === sid);
      if (!o) return void ind.classList.remove('show');
      label = o.symbol + ' ' + o.name + ' [' + objectSize(o) + '×' + objectSize(o) + ']';
    }
    $('placement-prefix').hidden = false;
    $('placement-name').textContent = label; // textContent: no HTML injection
    ind.classList.add('show');
  }

  function flashMsg(text: string) {
    const ind = $('placement');
    $('placement-prefix').hidden = true;
    $('placement-name').textContent = text;
    ind.classList.add('show');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      if (!state.selected) ind.classList.remove('show');
      else updatePlacementIndicator();
    }, 1500);
  }

  function updateStats() {
    const players = state.players.length;
    const objects = state.objects.length;
    const deployed = Object.keys(state.placements).length;
    $('stat-players').textContent = String(players);
    $('stat-objects').textContent = String(objects);
    $('stat-deployed').textContent = deployed + ' / ' + (players + objects);
    $('stat-grid').textContent = state.gridCols + '×' + state.gridRows;
    $('tab-ct-p').textContent = '(' + players + ')';
    $('tab-ct-o').textContent = '(' + objects + ')';
    SQUADS.forEach((s) => {
      $('count-' + s).textContent = String(state.players.filter((p) => p.squad === s).length);
    });
  }

  function renderAll() {
    if (viewMode === '2d') renderGrid();
    else grid2dStale = true; // rebuilt when the user switches back to 2D
    renderLists();
    updateStats();
    updateCoordInfo();
    autosave();
    sync3d();
  }

  // ---------- 3D view (lazy) ----------
  function build3dModel(): Planner3DModel {
    const items: Planner3DModel['items'] = [];
    Object.entries(state.placements).forEach(([key, p]) => {
      const [x, y] = key.split(',').map(Number);
      const size = placementSize(p);
      const coord = displayCenterCoordText(x, y, size); // same text as the 2D banner
      if (p.type === 'player') {
        const player = state.players.find((pl) => pl.id === p.id);
        if (!player) return;
        const squad: Squad = SQUADS.includes(player.squad) ? player.squad : 'R5';
        items.push({ key, x, y, size, kind: 'player', name: player.name, coord, color: squadColor(squad), squad });
      } else {
        const obj = state.objects.find((o) => o.id === p.id);
        if (!obj) return;
        items.push({ key, x, y, size, kind: 'object', name: obj.name, coord, color: safeColor(obj.color), symbol: String(obj.symbol ?? '') });
      }
    });
    return {
      cols: state.gridCols,
      rows: state.gridRows,
      startX: state.coordStartX,
      startY: state.coordStartY,
      items,
    };
  }

  /** Push the current state into the 3D scene (no-op while 2D is showing). */
  function sync3d() {
    if (view3d && viewMode === '3d') view3d.update(build3dModel());
  }

  function applyViewMode(mode: '2d' | '3d') {
    viewMode = mode;
    root.dataset.view = mode;
    $$('.pl-view-btn').forEach((b) => {
      const on = b.dataset.view === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('btn-cam-reset').hidden = mode !== '3d';
    if (mode === '2d') {
      view3d?.setActive(false);
      if (grid2dStale) {
        grid2dStale = false;
        renderGrid();
      }
    }
  }

  function show3dNotice(text: string) {
    $('3d-notice-text').textContent = text;
    $('3d-notice').hidden = false;
  }

  async function enter3d() {
    if (viewMode === '3d' || loading3d) return;
    const btn3d = root.querySelector<HTMLElement>('.pl-view-btn[data-view="3d"]');
    if (!hasWebGL()) {
      // No WebGL: explain why and stay in 2D.
      btn3d?.setAttribute('aria-disabled', 'true');
      show3dNotice(T.v3dNoWebgl);
      return;
    }
    $('3d-notice').hidden = true;
    applyViewMode('3d');
    if (!view3d) {
      loading3d = true;
      $('3d-loading').hidden = false;
      try {
        const { createPlannerScene } = await import('./scene3d');
        view3d = createPlannerScene({
          canvasRoot: $('3d-canvas'),
          labelRoot: $('3d-labels'),
          host: {
            selectionSize: () => (state.selected ? placementSize(state.selected) : null),
            canPlace: (ax, ay, size) => canPlace(ax, ay, getOccupiedCells(), size),
            place: (ax, ay) => onCellClick(ax, ay),
            remove: (key) => removePlacement(key),
          },
        });
      } catch (err) {
        console.error(err);
        applyViewMode('2d');
        show3dNotice(T.v3dFailed);
        return;
      } finally {
        loading3d = false;
        $('3d-loading').hidden = true;
      }
    }
    if (!is3d()) return; // switched back to 2D while the modules were loading
    view3d.update(build3dModel());
    view3d.setActive(true);
  }

  // ---------- persistence ----------
  function snapshotState(): Snapshot {
    return {
      players: state.players,
      objects: state.objects,
      placements: state.placements,
      gridCols: state.gridCols,
      gridRows: state.gridRows,
      coordStartX: state.coordStartX,
      coordStartY: state.coordStartY,
      cellSize: state.cellSize,
      nextPid,
      nextOid,
      savedAt: Date.now(),
    };
  }

  function applySnapshot(data: Partial<Snapshot> | null | undefined): boolean {
    if (!data || typeof data !== 'object') return false;
    state.players = Array.isArray(data.players) ? data.players : [];
    state.objects = Array.isArray(data.objects) ? data.objects : [];
    state.placements = data.placements && typeof data.placements === 'object' ? data.placements : {};
    const legacySize = data.gridSize || 10;
    state.gridCols = Math.min(MAX_GRID_DIM, Math.max(3, data.gridCols || legacySize));
    state.gridRows = Math.min(MAX_GRID_DIM, Math.max(3, data.gridRows || legacySize));
    state.coordStartX = Math.min(MAX_COORD, Math.max(0, data.coordStartX || 0));
    state.coordStartY = Math.min(MAX_COORD, Math.max(0, data.coordStartY || 0));
    if (state.coordStartX + state.gridCols - 1 > MAX_COORD) state.gridCols = Math.max(3, MAX_COORD - state.coordStartX + 1);
    if (state.coordStartY + state.gridRows - 1 > MAX_COORD) state.gridRows = Math.max(3, MAX_COORD - state.coordStartY + 1);
    if (state.coordStartX + state.gridCols - 1 > MAX_COORD) state.coordStartX = Math.max(0, MAX_COORD - state.gridCols + 1);
    if (state.coordStartY + state.gridRows - 1 > MAX_COORD) state.coordStartY = Math.max(0, MAX_COORD - state.gridRows + 1);
    state.cellSize = data.cellSize || 18;
    nextPid = data.nextPid || Math.max(0, ...state.players.map((p) => p.id)) + 1;
    nextOid = data.nextOid || Math.max(0, ...state.objects.map((o) => o.id)) + 1;
    state.selected = null;
    $<HTMLSelectElement>('sel-cell').value = String(state.cellSize);
    renderAll();
    updatePlacementIndicator();
    return true;
  }

  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  function autosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      LS.set(AUTOSAVE_KEY, JSON.stringify(snapshotState()));
    }, 400);
  }
  function restoreAutosave(): boolean {
    const raw = LS.get(AUTOSAVE_KEY);
    if (!raw) return false;
    try {
      return applySnapshot(JSON.parse(raw));
    } catch {
      return false;
    }
  }

  function getLoadouts(): Record<string, Snapshot> {
    const raw = LS.get(LOADOUTS_KEY);
    if (!raw) return {};
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  const persistLoadouts = (obj: Record<string, Snapshot>) => LS.set(LOADOUTS_KEY, JSON.stringify(obj));
  function saveLoadout(name: string): boolean {
    name = (name || '').trim();
    if (!name) return false;
    const all = getLoadouts();
    all[name] = snapshotState();
    return persistLoadouts(all);
  }
  function loadLoadout(name: string): boolean {
    const all = getLoadouts();
    if (!all[name]) return false;
    return applySnapshot(all[name]);
  }
  function deleteLoadout(name: string) {
    const all = getLoadouts();
    delete all[name];
    persistLoadouts(all);
  }

  function exportLoadoutFile() {
    const blob = new Blob([JSON.stringify(snapshotState(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lastwar-layout-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashMsg(T.fFileDownloaded);
  }
  function importLoadoutFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (applySnapshot(data)) {
          autosave();
          closeLoadoutModal();
          flashMsg(T.fLayoutFromFile);
        } else flashMsg(T.fFileInvalid);
      } catch (err) {
        console.error(err);
        flashMsg(T.fFileCorrupt);
      }
    };
    reader.onerror = () => flashMsg(T.fReadFailed);
    reader.readAsText(file);
  }

  // ---------- layout modal ----------
  function openLoadoutModal() {
    renderLoadoutList();
    $<HTMLInputElement>('loadout-name').value = '';
    $('loadout-warn').style.display = LS.available ? 'none' : 'block';
    $('loadout-modal').classList.add('show');
  }
  function closeLoadoutModal() {
    $('loadout-modal').classList.remove('show');
  }
  function fmtDate(ts?: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function renderLoadoutList() {
    const list = $('loadout-list');
    const all = getLoadouts();
    const names = Object.keys(all).sort((a, b) => (all[b].savedAt || 0) - (all[a].savedAt || 0));
    if (names.length === 0) {
      list.innerHTML = `<div class="pl-loadout-empty">${T.layoutEmpty}</div>`;
      return;
    }
    list.innerHTML = '';
    names.forEach((name) => {
      const d = all[name];
      const meta = fmt(T.layoutMeta, {
        p: (d.players || []).length,
        o: (d.objects || []).length,
        d: Object.keys(d.placements || {}).length,
        date: fmtDate(d.savedAt),
      });
      const row = document.createElement('div');
      row.className = 'pl-loadout-row';
      row.innerHTML = `
        <div class="pl-loadout-info">
          <div class="pl-loadout-name">${escapeHtml(name)}</div>
          <div class="pl-loadout-meta">${escapeHtml(meta)}</div>
        </div>
        <button type="button" class="pl-loadout-load">${escapeHtml(T.load)}</button>
        <button type="button" class="pl-loadout-del" title="${escapeHtml(T.remove)}" aria-label="${escapeHtml(T.remove)}">🗑</button>`;
      row.querySelector('.pl-loadout-load')!.addEventListener('click', () => {
        if (loadLoadout(name)) {
          autosave();
          closeLoadoutModal();
          flashMsg(fmt(T.fLayoutLoaded, { name: name.toUpperCase() }));
        }
      });
      row.querySelector('.pl-loadout-del')!.addEventListener('click', () => {
        openModal(T.deleteLayoutTitle, fmt(T.deleteLayoutMsg, { name }), () => {
          deleteLoadout(name);
          renderLoadoutList();
          flashMsg(T.fLayoutDeleted);
        });
      });
      list.appendChild(row);
    });
  }

  // ---------- coordinate modal ----------
  function updateCoordInfo() {
    const ex = state.coordStartX + state.gridCols - 1;
    const ey = state.coordStartY + state.gridRows - 1;
    $('info-size').textContent = fmt(T.infoSizeVal, {
      c: state.gridCols,
      r: state.gridRows,
      t: state.gridCols * state.gridRows,
    });
    $('info-c').textContent = 'X:' + centerWorldX() + ' / Y:' + centerWorldY();
    $('info-x').textContent = state.coordStartX + ' – ' + ex;
    $('info-y').textContent = state.coordStartY + ' – ' + ey;
  }

  function openCoordModal() {
    $<HTMLInputElement>('coord-cols').value = String(state.gridCols);
    $<HTMLInputElement>('coord-rows').value = String(state.gridRows);
    $<HTMLInputElement>('coord-cx').value = String(centerWorldX());
    $<HTMLInputElement>('coord-cy').value = String(centerWorldY());
    updateCoordPreview();
    $('coord-modal').classList.add('show');
    $('coord-cols').focus();
  }
  const closeCoordModal = () => $('coord-modal').classList.remove('show');

  function getNormalizedCoordSettings() {
    const num = (id: string) => parseInt($<HTMLInputElement>(id).value, 10);
    const cols = Math.min(MAX_GRID_DIM, Math.max(3, num('coord-cols') || 10));
    const rows = Math.min(MAX_GRID_DIM, Math.max(3, num('coord-rows') || 10));
    const inX = num('coord-cx');
    const inY = num('coord-cy');
    const wantX = Number.isFinite(inX) ? inX : centerWorldX();
    const wantY = Number.isFinite(inY) ? inY : centerWorldY();
    // Spread the map evenly around the centre, but keep every edge inside 0–999.
    const sx = Math.min(MAX_COORD - cols + 1, Math.max(0, wantX - centerOffset(cols)));
    const sy = Math.min(MAX_COORD - rows + 1, Math.max(0, wantY - centerOffset(rows)));
    const cx = sx + centerOffset(cols);
    const cy = sy + centerOffset(rows);
    return { cols, rows, sx, sy, cx, cy, ex: sx + cols - 1, ey: sy + rows - 1, adjusted: cx !== wantX || cy !== wantY };
  }

  function updateCoordPreview() {
    const { cols, rows, sx, sy, ex, ey, cx, cy, adjusted } = getNormalizedCoordSettings();
    $('cp-size').textContent = fmt(T.cpSize, { c: cols, r: rows, t: cols * rows });
    const center = $('cp-center');
    center.textContent = fmt(adjusted ? T.cpCenterAdjusted : T.cpCenter, { x: cx, y: cy });
    center.classList.toggle('warn', adjusted);
    $('cp-x').textContent = fmt(T.cpX, { a: sx, b: ex });
    $('cp-y').textContent = fmt(T.cpY, { a: sy, b: ey });
    $('cp-anchor').textContent = T.cpAnchor;
    const willPrune = remapPlacements(cols, rows).dropped;
    const warn = $('cp-warn');
    if (willPrune > 0) {
      warn.textContent = fmt(T.cpWarn, { n: willPrune });
      warn.style.display = '';
    } else warn.style.display = 'none';
  }

  function applyCoordSettings() {
    const { cols, rows, sx, sy, cx, cy } = getNormalizedCoordSettings();
    state.placements = remapPlacements(cols, rows).kept;
    state.gridCols = cols;
    state.gridRows = rows;
    state.coordStartX = sx;
    state.coordStartY = sy;
    closeCoordModal();
    renderAll();
    flashMsg(fmt(T.fCoord, { c: cols, r: rows, x: cx, y: cy }));
  }

  // ---------- XLSX (lazy-loaded) ----------
  async function loadXlsx() {
    try {
      return await import('xlsx');
    } catch (err) {
      console.error(err);
      flashMsg(T.fXlsxFailed);
      return null;
    }
  }

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    if (!XLSX) return;
    const half = Math.floor(BASE_SIZE / 2);
    const rangeVars = {
      x1: state.coordStartX + half,
      x2: state.coordStartX + state.gridCols - BASE_SIZE + half,
      y1: state.coordStartY + BASE_SIZE - 1 - half,
      y2: state.coordStartY + state.gridRows - 1 - half,
    };
    const wb = XLSX.utils.book_new();
    const wsHelp = XLSX.utils.aoa_to_sheet(T.xlsxHelp.map((line) => [fmt(line, rangeVars)]));
    wsHelp['!cols'] = [{ wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsHelp, 'PETUNJUK');

    const sx = state.coordStartX;
    const sy = state.coordStartY;
    const wsP = XLSX.utils.aoa_to_sheet([
      ['Nama', 'Squad', 'X', 'Y'],
      ['ZEROKINGZ', 'R5', sx + 13, sy + 13],
      ['IRON-WOLF', 'R4', sx + 10, sy + 13],
      ['PHANTOM', 'R4', sx + 16, sy + 13],
      ['ARJUNA', 'R3', sx + 13, sy + 10],
      ['KING-RAJA', 'R3', sx + 13, sy + 16],
      ['SILVERBACK', 'R2', '', ''],
      ['MAVERICK', 'R2', '', ''],
      ['ROOKIE-77', 'R1', '', ''],
    ]);
    wsP['!cols'] = [{ wch: 18 }, { wch: 8 }, { wch: 6 }, { wch: 6 }];
    XLSX.utils.book_append_sheet(wb, wsP, 'PEMAIN');

    const wsO = XLSX.utils.aoa_to_sheet([
      ['Nama', 'Ikon', 'Warna', 'Skala', 'X', 'Y'],
      ['MARSEKAL', '♛', '#d8a040', 3, '', ''],
      ['SANDWORM', '◈', '#a484c8', 5, '', ''],
      ['BOSS', '☠', '#c06860', 3, '', ''],
      ['TELEPORT', '⟲', '#7ab4c2', 1, '', ''],
      ['TAMBANG', '⛏', '#f59e0b', 1, '', ''],
      ['MENARA', '⌂', '#10b981', 2, '', ''],
      ['ARENA', '⚔', '#cc8ea0', 3, '', ''],
      ['BENTENG', '▲', '#cbd5e1', 4, '', ''],
    ]);
    wsO['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 10 }, { wch: 7 }, { wch: 6 }, { wch: 6 }];
    XLSX.utils.book_append_sheet(wb, wsO, 'OBJEK');

    XLSX.writeFile(wb, 'lastwar-template.xlsx');
    flashMsg(T.fTemplateDownloaded);
  }

  async function importExcel(file: File) {
    const XLSX = await loadXlsx();
    if (!XLSX) return;
    const reader = new FileReader();
    reader.onerror = () => flashMsg(T.fReadFailed);
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result as ArrayBuffer), { type: 'array' });
        const stats = { p: 0, o: 0, placed: 0, skipped: 0, conflict: 0 };
        type Row = Record<string, unknown>;

        const findSheet = (names: string[]) => {
          for (const name of names)
            for (const sn of wb.SheetNames) if (sn.toUpperCase().trim() === name) return wb.Sheets[sn];
          return null;
        };
        const getField = (row: Row, keys: string[]): unknown => {
          for (const k of keys) {
            if (row[k] !== undefined && row[k] !== '') return row[k];
            const lk = k.toLowerCase();
            if (row[lk] !== undefined && row[lk] !== '') return row[lk];
          }
          return '';
        };
        const tryPlace = (r: Row, type: Placement['type'], id: number, size: number) => {
          const xv = getField(r, ['X']);
          const yv = getField(r, ['Y']);
          if (xv === '' || yv === '') return;
          const wx = parseInt(String(xv), 10);
          const wy = parseInt(String(yv), 10);
          if (!Number.isInteger(wx) || !Number.isInteger(wy)) return;
          const { x, y } = excelCoordToGrid(wx, wy, size);
          if (canPlace(x, y, getOccupiedCells(), size)) {
            state.placements[`${x},${y}`] = { type, id };
            stats.placed++;
          } else stats.conflict++;
        };

        const sheetP = findSheet(['PEMAIN', 'PLAYERS', 'PLAYER']);
        if (sheetP) {
          XLSX.utils.sheet_to_json<Row>(sheetP, { defval: '' }).forEach((r) => {
            const name = String(getField(r, ['Nama', 'Name'])).trim();
            if (!name) return void stats.skipped++;
            let squad = String(getField(r, ['Squad', 'Tier'])).toUpperCase().trim() || 'R5';
            if (!SQUADS.includes(squad as Squad)) squad = 'R5';
            const player: Player = { id: nextPid++, name, squad: squad as Squad };
            state.players.push(player);
            stats.p++;
            tryPlace(r, 'player', player.id, BASE_SIZE);
          });
        }

        const sheetO = findSheet(['OBJEK', 'OBJECTS', 'OBJECT']);
        if (sheetO) {
          XLSX.utils.sheet_to_json<Row>(sheetO, { defval: '' }).forEach((r) => {
            const name = String(getField(r, ['Nama', 'Name'])).trim();
            if (!name) return void stats.skipped++;
            let symbol = String(getField(r, ['Ikon', 'Icon', 'Symbol'])).trim() || '♛';
            if (symbol.length > 2) symbol = symbol.charAt(0);
            let color = String(getField(r, ['Warna', 'Color'])).trim() || DEFAULT_COLOR;
            if (!/^#[0-9A-Fa-f]{6}$/.test(color)) color = DEFAULT_COLOR;
            const sizeRaw = getField(r, ['Skala', 'Ukuran', 'Size', 'Scale']);
            const size = clampObjectSize(sizeRaw === '' ? BASE_SIZE : sizeRaw);
            const obj: PObject = { id: nextOid++, name, symbol, color, size };
            state.objects.push(obj);
            stats.o++;
            tryPlace(r, 'object', obj.id, size);
          });
        }

        if (stats.p === 0 && stats.o === 0) {
          flashMsg(T.fNoValidData);
          return;
        }
        renderAll();
        flashMsg(
          fmt(T.fImportResult, { p: stats.p, o: stats.o, d: stats.placed }) +
            (stats.conflict ? fmt(T.fImportConflict, { n: stats.conflict }) : ''),
        );
      } catch (err) {
        console.error(err);
        flashMsg(T.fXlsxInvalid);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ---------- confirm modal ----------
  let modalCb: (() => void) | null = null;
  function openModal(title: string, msg: string, cb: () => void) {
    $('modal-title').textContent = title;
    $('modal-msg').textContent = msg;
    modalCb = cb;
    $('modal').classList.add('show');
  }
  const closeModal = () => $('modal').classList.remove('show');

  // ---------- built-in alliance rosters (e.g. MAAX) ----------
  // Merge by name: existing players keep their id and placement, only the squad
  // is refreshed; new names are appended. Safe to run again after an update.
  function importPreset(preset: AlliancePreset) {
    const byName = new Map(state.players.map((p) => [normName(p.name), p]));
    let added = 0;
    let updated = 0;
    for (const ap of preset.players) {
      const existing = byName.get(normName(ap.name));
      if (existing) {
        if (ap.rank && existing.squad !== ap.rank) {
          existing.squad = ap.rank;
          updated++;
        }
        continue;
      }
      const player: Player = { id: nextPid++, name: ap.name, squad: ap.rank ?? 'R1' };
      state.players.push(player);
      byName.set(normName(ap.name), player);
      added++;
    }
    switchTab('players');
    renderAll();
    flashMsg(fmt(T.fPresetResult, { tag: preset.tag, a: added, u: updated }));
  }

  // ---------- demo seed ----------
  function maybeSeed() {
    if (hasAutosave) return;
    if (Object.keys(getLoadouts()).length > 0) return;
    state.objects.push({ id: nextOid++, name: 'MARSEKAL', color: '#d8a040', symbol: '♛', size: 3 });
    state.objects.push({ id: nextOid++, name: 'SANDWORM', color: '#a484c8', symbol: '⌬', size: 5 });
    state.objects.push({ id: nextOid++, name: 'DRILLER', color: '#d68458', symbol: '⚒', size: 1 });
    state.objects.push({ id: nextOid++, name: 'RESOURCE', color: '#7fc498', symbol: '◈', size: 1 });
    const seed: { name: string; squad: Squad }[] = [
      { name: 'ZEROKINGZ', squad: 'R5' },
      { name: 'IRON-WOLF', squad: 'R4' },
      { name: 'PHANTOM', squad: 'R4' },
      { name: 'ARJUNA', squad: 'R3' },
      { name: 'KING-RAJA', squad: 'R3' },
      { name: 'SILVERBACK', squad: 'R2' },
      { name: 'NIGHTHAWK', squad: 'R2' },
      { name: 'SHOGUN', squad: 'R1' },
    ];
    seed.forEach((s) => state.players.push({ id: nextPid++, ...s }));
    // Put the demo object's centre exactly on the map centre (⊙).
    const half = Math.floor(BASE_SIZE / 2);
    const cx = centerGridX() - half;
    const cy = centerGridY() - half;
    state.placements[`${cx},${cy}`] = { type: 'object', id: 1 };
    renderAll();
  }

  // ---------- mobile drawers ----------
  function setupDrawers() {
    const navBtns = $$('.pl-nav-btn');
    const backdrop = $('drawer-backdrop');
    const roster = $('aside-roster');
    const intel = $('aside-intel');
    const isMobile = () => window.innerWidth <= MOBILE_MAX;

    function closeAll() {
      roster.classList.remove('drawer-open');
      intel.classList.remove('drawer-open');
      backdrop.classList.remove('show');
      navBtns.forEach((b) => b.classList.toggle('active', b.dataset.drawer === 'map'));
    }
    function openDrawer(name: string) {
      closeAll();
      if (name === 'roster') roster.classList.add('drawer-open');
      else if (name === 'intel') intel.classList.add('drawer-open');
      if (name !== 'map') backdrop.classList.add('show');
      navBtns.forEach((b) => b.classList.toggle('active', b.dataset.drawer === name));
    }
    navBtns.forEach((btn) => btn.addEventListener('click', () => openDrawer(btn.dataset.drawer || 'map')));
    backdrop.addEventListener('click', closeAll);
    $$('.pl-drawer-handle').forEach((h) => h.addEventListener('click', closeAll));

    // Swipe down on the handle to close.
    [roster, intel].forEach((drawer) => {
      const handle = drawer.querySelector<HTMLElement>('.pl-drawer-handle');
      if (!handle) return;
      let startY = 0;
      let currentY = 0;
      let dragging = false;
      handle.addEventListener(
        'touchstart',
        (e) => {
          startY = currentY = e.touches[0].clientY;
          dragging = true;
          drawer.style.transition = 'none';
        },
        { passive: true },
      );
      handle.addEventListener(
        'touchmove',
        (e) => {
          if (!dragging) return;
          currentY = e.touches[0].clientY;
          drawer.style.transform = `translateY(${Math.max(0, currentY - startY)}px)`;
        },
        { passive: true },
      );
      handle.addEventListener('touchend', () => {
        drawer.style.transition = '';
        drawer.style.transform = '';
        if (currentY - startY > 80) closeAll();
        dragging = false;
        startY = currentY = 0;
      });
    });

    window.addEventListener('resize', () => {
      if (!isMobile()) closeAll();
    });
    // Close drawers when an item is selected so the map is visible.
    onItemSelected = () => {
      if (isMobile()) closeAll();
    };
  }

  // ---------- wire up ----------
  $$('.pl-tab').forEach((btn) =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab === 'objects' ? 'objects' : 'players')),
  );
  const pickGroup = (sel: string, apply: (b: HTMLElement) => void) => {
    const btns = $$(sel);
    btns.forEach((btn) =>
      btn.addEventListener('click', () => {
        btns.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        apply(btn);
      }),
    );
  };
  pickGroup('.pl-squad-btn', (b) => (state.selectedSquad = (b.dataset.squad as Squad) || 'R5'));
  pickGroup('.pl-color-btn', (b) => (state.selectedColor = safeColor(b.dataset.color)));
  pickGroup('.pl-symbol-btn', (b) => (state.selectedSymbol = b.dataset.sym || '♛'));

  $('btn-add-player').addEventListener('click', addPlayer);
  $('inp-pname').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPlayer();
  });
  $('btn-add-object').addEventListener('click', addObject);
  $('inp-oname').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addObject();
  });

  const osizeInput = $<HTMLInputElement>('inp-osize');
  const syncOsizeUI = () => {
    const n = clampObjectSize(osizeInput.value);
    $('osize-hint').textContent = fmt(T.footprintHint, { n });
    $$('.pl-osize-chip').forEach((c) => c.classList.toggle('active', parseInt(c.dataset.size || '', 10) === n));
  };
  $$('.pl-osize-chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      osizeInput.value = chip.dataset.size || '3';
      syncOsizeUI();
    }),
  );
  osizeInput.addEventListener('input', syncOsizeUI);
  osizeInput.addEventListener('change', () => {
    osizeInput.value = String(clampObjectSize(osizeInput.value));
    syncOsizeUI();
  });

  $$('.pl-view-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      if (btn.dataset.view === '3d') void enter3d();
      else applyViewMode('2d');
    }),
  );
  $('btn-cam-reset').addEventListener('click', () => view3d?.resetView());
  $('3d-notice-close').addEventListener('click', () => ($('3d-notice').hidden = true));
  // Free the WebGL context and GPU resources when the page is really going away (not bfcache).
  window.addEventListener('pagehide', (e) => {
    if (e.persisted || !view3d) return;
    view3d.dispose();
    view3d = null;
  });

  $('btn-coord').addEventListener('click', openCoordModal);
  $('btn-coord-intel').addEventListener('click', openCoordModal);
  ['coord-cols', 'coord-rows', 'coord-cx', 'coord-cy'].forEach((id) =>
    $(id).addEventListener('input', updateCoordPreview),
  );
  $('coord-apply').addEventListener('click', applyCoordSettings);
  $('coord-cancel').addEventListener('click', closeCoordModal);
  $('coord-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCoordModal();
  });

  $<HTMLSelectElement>('sel-cell').addEventListener('change', (e) => {
    state.cellSize = parseInt((e.target as HTMLSelectElement).value, 10) || 18;
    renderAll();
  });

  $('btn-save').addEventListener('click', openLoadoutModal);
  const nameInput = $<HTMLInputElement>('loadout-name');
  const doSave = (name: string) => {
    if (saveLoadout(name)) {
      renderLoadoutList();
      nameInput.value = '';
      flashMsg(fmt(T.fLayoutSaved, { name: name.toUpperCase() }));
      return true;
    }
    return false;
  };
  $('loadout-save').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return void nameInput.focus();
    if (getLoadouts()[name]) {
      openModal(T.overwriteTitle, fmt(T.overwriteMsg, { name }), () => {
        if (!doSave(name)) flashMsg(T.fSaveFailed);
      });
    } else if (!doSave(name)) flashMsg(T.fSaveNoStorage);
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('loadout-save').click();
  });
  $('loadout-close').addEventListener('click', closeLoadoutModal);
  $('loadout-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLoadoutModal();
  });
  $('loadout-export').addEventListener('click', exportLoadoutFile);
  $('loadout-import').addEventListener('click', () => $('loadout-file').click());
  $<HTMLInputElement>('loadout-file').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) importLoadoutFile(file);
    input.value = '';
  });

  $$<HTMLButtonElement>('[data-preset]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const preset = ALLIANCE_PRESETS.find((p) => p.tag === btn.dataset.preset);
      if (!preset || preset.players.length === 0) return;
      openModal(
        fmt(T.presetConfirmTitle, { tag: preset.tag }),
        fmt(T.presetConfirmMsg, { tag: preset.tag, n: preset.players.length }),
        () => importPreset(preset),
      );
    }),
  );
  $('btn-template').addEventListener('click', () => void downloadTemplate());
  $('btn-import').addEventListener('click', () => $('file-input').click());
  $<HTMLInputElement>('file-input').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void importExcel(file);
    input.value = '';
  });

  $('btn-clear-deploy').addEventListener('click', () => {
    openModal(T.clearDeployTitle, T.clearDeployMsg, () => {
      state.placements = {};
      state.selected = null;
      renderAll();
      updatePlacementIndicator();
    });
  });
  $('btn-reset-all').addEventListener('click', () => {
    openModal(T.resetTitle, T.resetMsg, () => {
      state.players = [];
      state.objects = [];
      state.placements = {};
      state.selected = null;
      nextPid = 1;
      nextOid = 1;
      renderAll();
      updatePlacementIndicator();
    });
  });

  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-ok').addEventListener('click', () => {
    closeModal();
    const cb = modalCb;
    modalCb = null;
    if (cb) cb();
  });
  $('modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.selected = null;
      renderLists();
      updatePlacementIndicator();
      clearPreview();
      view3d?.selectionChanged();
    }
  });

  syncOsizeUI();
  renderAll();
  hasAutosave = restoreAutosave();
  setupDrawers();
  maybeSeed();
  root.dataset.ready = '1';
}
