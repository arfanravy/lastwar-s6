// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

export default defineConfig({
  // Ganti jika nanti memakai custom domain
  site: 'https://lastwar-s6.vercel.app',

  i18n: {
    defaultLocale: 'id',
    locales: ['id', 'en'],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },

  integrations: [react()],
});