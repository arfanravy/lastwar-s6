// Subscribable / downloadable calendar: /id/s6-calendar.ics and /en/s6-calendar.ics
import type { APIRoute } from 'astro';
import type { Lang } from '../../config';
import { langPaths, localePath } from '../../i18n/ui';
import { buildIcs } from '../../lib/calendar';

export const getStaticPaths = langPaths;

export const GET: APIRoute = ({ params, site }) => {
  const lang = params.lang as Lang;
  const pageUrl = new URL(localePath(lang, 'calendar/'), site).href;
  return new Response(buildIcs(lang, pageUrl), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};
