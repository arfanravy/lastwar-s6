// Season 6 calendar: turns "week X, day Y, HH:MM server time" from
// src/data/calendar.json into real timestamps. Used at build time (page, .ics)
// and in the browser (countdowns, "now" highlighting).
import season from '../data/season.json';
import data from '../data/calendar.json';
import type { Lang } from '../config';

export type Cat = 'war' | 'altar' | 'hero' | 'event' | 'season';
export type Phase = 'pre' | 'season' | 'celebration';
export type Precision = 'time' | 'day' | 'week';
type L10n = { id: string; en: string };

interface RawEvent {
  id: string;
  cat: Cat;
  phase?: Phase;
  week?: number;
  weeks?: number[];
  day?: number;
  days?: number[];
  time?: string;
  hours?: number;
  durDays?: number;
  tbc?: boolean;
  /** Reminder N minutes before the start (in the .ics). Timed events default to 15. */
  alarmMin?: number;
  title: L10n;
  desc?: L10n;
  weekNote?: Record<string, L10n>;
}

export interface Occurrence {
  key: string;
  id: string;
  cat: Cat;
  phase: Phase;
  week: number;
  day?: number;
  title: string;
  note?: string;
  desc?: string;
  start: number;
  end: number;
  precision: Precision;
  tbc: boolean;
  alarmMin?: number;
}

export interface WeekDef {
  key: string;
  phase: Phase;
  week: number;
  label: string;
  start: number;
  end: number;
}

export const CATS: Cat[] = ['war', 'altar', 'hero', 'event', 'season'];
export const CAT_LABEL: Record<Lang, Record<Cat, string>> = {
  id: { war: 'Perang', altar: 'Altar', hero: 'Hero', event: 'Event', season: 'Season' },
  en: { war: 'War', altar: 'Altar', hero: 'Hero', event: 'Event', season: 'Season' },
};

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
/** Last War server time is UTC-2 (the IANA "Etc/GMT+2" zone has the inverted sign). */
export const SERVER_TZ = 'Etc/GMT+2';
/** Week 1 day 1 of the season = the end of the pre-season countdown (00:00 server time). */
export const SEASON_START = Date.parse(season.preseason.endsAt);
export const PRE_START = SEASON_START - 14 * DAY;
export const CELEBRATION_START = SEASON_START + 8 * 7 * DAY;
export const CELEBRATION_END = CELEBRATION_START + 4 * 7 * DAY;
export const START_ESTIMATED = season.preseason.endsAtEstimated;
export const LAST_VERIFIED = data.lastVerified;

const LOCALE: Record<Lang, string> = { id: 'id-ID', en: 'en-GB' };
const SEASON_WEEKS = 8;
// On a tie (e.g. 00:00), exact-time events come first, then all-day, then week-long ones.
const PRECISION_ORDER: Record<Precision, number> = { time: 0, day: 1, week: 2 };

export function phaseStart(p: Phase) {
  return p === 'pre' ? PRE_START : p === 'season' ? SEASON_START : CELEBRATION_START;
}

/** 00:00 server time of the given day (day 1 = Monday). */
export function dayStart(p: Phase, week: number, day = 1) {
  return phaseStart(p) + ((week - 1) * 7 + (day - 1)) * DAY;
}

export function weeks(lang: Lang): WeekDef[] {
  const pre = lang === 'id' ? 'Pra-musim' : 'Pre-season';
  const wk = lang === 'id' ? 'Minggu' : 'Week';
  const out: WeekDef[] = [];
  for (const w of [1, 2]) out.push({ key: `pre-${w}`, phase: 'pre', week: w, label: `${pre} ${w}`, start: dayStart('pre', w), end: dayStart('pre', w) + 7 * DAY });
  for (let w = 1; w <= SEASON_WEEKS; w++)
    out.push({ key: `w-${w}`, phase: 'season', week: w, label: `${wk} ${w}`, start: dayStart('season', w), end: dayStart('season', w) + 7 * DAY });
  out.push({ key: 'celebration', phase: 'celebration', week: 1, label: 'Celebration', start: CELEBRATION_START, end: CELEBRATION_END });
  return out;
}

export function expand(lang: Lang): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of data.events as RawEvent[]) {
    const phase = ev.phase ?? 'season';
    const weekList = ev.weeks ?? (ev.week ? [ev.week] : []);
    const dayList: (number | undefined)[] = ev.days ?? (ev.day ? [ev.day] : [undefined]);
    for (const w of weekList) {
      for (const d of dayList) {
        let start: number;
        let end: number;
        let precision: Precision;
        if (d === undefined) {
          precision = 'week';
          start = dayStart(phase, w);
          end = start + 7 * DAY;
        } else if (ev.time) {
          precision = 'time';
          const [h, m] = ev.time.split(':').map(Number);
          start = dayStart(phase, w, d) + h * HOUR + m * 60_000;
          end = start + (ev.hours ?? 0) * HOUR;
        } else {
          precision = 'day';
          start = dayStart(phase, w, d);
          end = start + (ev.durDays ?? 1) * DAY;
        }
        out.push({
          key: `${ev.id}-${phase}-${w}${d ? '-' + d : ''}`,
          id: ev.id,
          cat: ev.cat,
          phase,
          week: w,
          day: d,
          title: ev.title[lang],
          note: ev.weekNote?.[String(w)]?.[lang],
          desc: ev.desc?.[lang],
          start,
          end,
          precision,
          tbc: !!ev.tbc,
          alarmMin: ev.alarmMin ?? (precision === 'time' ? 15 : undefined),
        });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || PRECISION_ORDER[a.precision] - PRECISION_ORDER[b.precision]);
}

/** Where we are in the season right now. */
export function position(now: number) {
  const dayOf = (start: number) => {
    const days = Math.floor((now - start) / DAY);
    return { week: Math.floor(days / 7) + 1, day: (days % 7) + 1 };
  };
  if (now < PRE_START) return { phase: 'before' as const };
  if (now < SEASON_START) return { phase: 'pre' as const, ...dayOf(PRE_START) };
  if (now < CELEBRATION_START) return { phase: 'season' as const, ...dayOf(SEASON_START) };
  if (now < CELEBRATION_END) return { phase: 'celebration' as const, ...dayOf(CELEBRATION_START) };
  return { phase: 'after' as const };
}

/** Next daily reset (00:00 server time). */
export function nextReset(now: number) {
  const sinceAnchor = now - SEASON_START;
  return SEASON_START + (Math.floor(sinceAnchor / DAY) + 1) * DAY;
}

// ---------- formatting ----------
const fmt = (lang: Lang, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE[lang], o);

export const fmtServerDay = (ts: number, lang: Lang) =>
  fmt(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: SERVER_TZ }).format(ts);
export const fmtServerDate = (ts: number, lang: Lang) =>
  fmt(lang, { day: 'numeric', month: 'short', timeZone: SERVER_TZ }).format(ts);
export const fmtServerTime = (ts: number, lang: Lang) =>
  fmt(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: SERVER_TZ }).format(ts);
/** Visitor's own time zone, e.g. "Jum, 27 Nov 21.00 WIB". */
export const fmtLocal = (ts: number, lang: Lang) =>
  fmt(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(ts);
export const fmtLocalTime = (ts: number, lang: Lang) =>
  fmt(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(ts);

export function fmtRange(w: WeekDef, lang: Lang) {
  return `${fmtServerDate(w.start, lang)} – ${fmtServerDate(w.end - DAY, lang)}`;
}

export function fmtCountdown(ms: number, lang: Lang) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayUnit = lang === 'id' ? 'h' : 'd';
  return (d ? `${d}${dayUnit} ` : '') + `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ---------- iCalendar (.ics) ----------
const icsDate = (ts: number) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold lines at 75 octets as RFC 5545 requires (UTF-8 aware). */
function fold(line: string) {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function buildIcs(lang: Lang, siteUrl: string) {
  const stamp = icsDate(Date.parse(LAST_VERIFIED + 'T00:00:00Z'));
  const tbcNote = lang === 'id' ? '(perkiraan, cek in-game)' : '(estimated, check in game)';
  const calName = lang === 'id' ? 'Last War Season 6 · Lost Rainforest' : 'Last War Season 6 · Lost Rainforest';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//1196-MAAX//Last War S6//' + lang.toUpperCase(),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(calName)}`,
    'X-WR-TIMEZONE:UTC',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ];
  for (const o of expand(lang)) {
    if (o.precision === 'week') continue; // no exact day known
    const end = o.end > o.start ? o.end : o.start + 30 * 60_000;
    const summary = `[S6] ${o.title}${o.note ? ` · ${o.note}` : ''}${o.tbc ? ' (?)' : ''}`;
    const desc = [o.desc, o.tbc ? tbcNote : '', siteUrl].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${o.key}@lastwar-s6`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(o.start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(desc)}`,
      `CATEGORIES:${CAT_LABEL[lang][o.cat].toUpperCase()}`,
      'TRANSP:TRANSPARENT',
    );
    if (o.alarmMin !== undefined) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(o.title)}`, `TRIGGER:-PT${o.alarmMin}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
