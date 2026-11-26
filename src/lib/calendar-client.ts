// Browser-side helpers for the calendar: a self-updating "live now / up next"
// list with countdowns. Used by the calendar page and the homepage card.
import type { Lang } from '../config';
import { DAY, expand, fmtCountdown, fmtLocal, fmtServerDay, fmtServerTime, type Occurrence } from './calendar';

export interface UpcomingLabels {
  live: string;
  next: string;
  startsIn: string;
  endsIn: string;
  allDay: string;
  server: string;
  empty: string;
  tbc: string;
}

interface Row {
  o: Occurrence;
  live: boolean;
  cd: HTMLElement;
}

/** Long-running events (e.g. a 48-day mini-game) would crowd the "live" list. */
const MAX_LIVE_SPAN = 14 * DAY;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function whenText(o: Occurrence, lang: Lang, L: UpcomingLabels) {
  if (o.precision === 'time') return `${fmtLocal(o.start, lang)} · ${fmtServerTime(o.start, lang)} ${L.server}`;
  if (o.end - o.start > DAY) return `${fmtServerDay(o.start, lang)} – ${fmtServerDay(o.end - DAY, lang)} (${L.server})`;
  return `${fmtServerDay(o.start, lang)} · ${L.allDay}`;
}

export function mountUpcoming(list: HTMLElement, lang: Lang, opts: { next: number; live: number; labels: UpcomingLabels }) {
  const L = opts.labels;
  const all = expand(lang).filter((o) => o.precision !== 'week');
  let signature = '';
  let rows: Row[] = [];

  const pick = (now: number) => ({
    live: all
      .filter((o) => o.start <= now && now < o.end && o.end - o.start <= MAX_LIVE_SPAN)
      .sort((a, b) => a.end - b.end)
      .slice(0, opts.live),
    next: all.filter((o) => o.start > now).slice(0, opts.next),
  });

  const row = (o: Occurrence, live: boolean) => {
    const li = el('li', 'up-row');
    li.dataset.cat = o.cat;
    li.append(el('span', 'cat-dot'));
    const main = el('div', 'up-main');
    const title = el('div', 'up-title', o.title);
    if (o.note) title.append(el('span', 'up-note', ` · ${o.note}`));
    if (o.tbc) title.append(' ', el('span', 'badge warn up-tbc', L.tbc));
    main.append(title, el('div', 'up-when', whenText(o, lang, L)));
    const cdBox = el('div', 'up-cd');
    const cd = el('span', 'up-cd-val mono');
    cdBox.append(el('span', 'up-cd-label', live ? L.endsIn : L.startsIn), cd);
    li.append(main, cdBox);
    rows.push({ o, live, cd });
    return li;
  };

  const build = (live: Occurrence[], next: Occurrence[]) => {
    rows = [];
    list.replaceChildren();
    if (live.length) {
      list.append(el('li', 'up-head up-head-live', L.live));
      live.forEach((o) => list.append(row(o, true)));
    }
    if (next.length) {
      list.append(el('li', 'up-head', L.next));
      next.forEach((o) => list.append(row(o, false)));
    }
    if (!live.length && !next.length) list.append(el('li', 'up-empty muted', L.empty));
  };

  const tick = () => {
    const now = Date.now();
    const { live, next } = pick(now);
    const sig = live.map((o) => 'L' + o.key).concat(next.map((o) => 'N' + o.key)).join(',');
    if (sig !== signature) {
      signature = sig;
      build(live, next);
    }
    for (const r of rows) r.cd.textContent = fmtCountdown((r.live ? r.o.end : r.o.start) - now, lang);
  };

  tick();
  return window.setInterval(tick, 1000);
}
