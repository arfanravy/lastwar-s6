import { LANGS, type Lang } from '../config';

export const ui = {
  id: {
    'site.tagline': 'Info Last War Season 6 · Lost Rainforest',
    'nav.home': 'Beranda',
    'nav.calendar': 'Kalender',
    'nav.faction': 'Faction Reveal',
    'nav.season': 'Panduan Season',
    'nav.planner': 'Planner Peta',
    'nav.territory': 'Peta Wilayah',
    'nav.badai': 'Badai Manager',
    'lang.label': 'Bahasa',
    'time.dayUnit': 'h',
    'time.ended': 'Selesai',
    'time.server': 'Waktu server (UTC-2)',
    'time.local': 'Waktu kamu',
    'common.estimated': 'perkiraan',
    'common.updated': 'Data diperbarui',
    'common.unverified': 'Belum terkonfirmasi',
    'faction.deepwood': 'Deepwood',
    'faction.wetland': 'Wetland',
    'faction.deepwood.animal': 'Rusa',
    'faction.wetland.animal': 'Buaya',
    'footer.disclaimer':
      'Situs fan tidak resmi. Tidak berafiliasi dengan FirstFun maupun Last War: Survival. Semua merek dagang milik pemiliknya masing-masing.',
    'footer.contribute': 'Ada data yang salah atau baru? Kabari kami.',
  },
  en: {
    'site.tagline': 'Last War Season 6 info · Lost Rainforest',
    'nav.home': 'Home',
    'nav.calendar': 'Calendar',
    'nav.faction': 'Faction Reveal',
    'nav.season': 'Season Guide',
    'nav.planner': 'Map Planner',
    'nav.territory': 'Territory Map',
    'nav.badai': 'Storm Manager',
    'lang.label': 'Language',
    'time.dayUnit': 'd',
    'time.ended': 'Ended',
    'time.server': 'Server time (UTC-2)',
    'time.local': 'Your time',
    'common.estimated': 'estimated',
    'common.updated': 'Data updated',
    'common.unverified': 'Unverified',
    'faction.deepwood': 'Deepwood',
    'faction.wetland': 'Wetland',
    'faction.deepwood.animal': 'Deer',
    'faction.wetland.animal': 'Crocodile',
    'footer.disclaimer':
      'Unofficial fan site. Not affiliated with FirstFun or Last War: Survival. All trademarks belong to their respective owners.',
    'footer.contribute': 'Spotted wrong or new data? Let us know.',
  },
} as const;

export type UiKey = keyof (typeof ui)['id'];

export function useTranslations(lang: Lang) {
  return (key: UiKey) => ui[lang][key] ?? ui.id[key];
}

export function langPaths() {
  return LANGS.map((lang) => ({ params: { lang } }));
}

export function localePath(lang: Lang, path = '') {
  return `/${lang}/${path}`;
}

export function formatDate(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso)) + ' UTC';
}
