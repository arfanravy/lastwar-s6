// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  // TODO: ganti dengan domain final (Vercel/Cloudflare Pages) saat deploy
  site: 'https://rimba-s6.example.com',
  i18n: {
    defaultLocale: 'id',
    locales: ['id', 'en'],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
});
