# Rimba S6

Situs fan info **Last War: Survival — Season 6 (Lost Rainforest)**, dwibahasa Indonesia/Inggris.
Dibangun dengan [Astro](https://astro.build) sebagai situs statis.

> Situs fan tidak resmi. Tidak berafiliasi dengan FirstFun maupun Last War: Survival.

## Menjalankan

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # hasil di dist/
npm run preview   # sajikan dist/ secara lokal
npm run check     # cek tipe TypeScript/Astro
```

## Struktur

```
src/
  config.ts                 nama situs, server default (#1196), offset waktu server (UTC-2)
  data/
    season.json             timer pra-musim + daftar event
    faction-reveal.json     grup server, angka server No.1, layout grid 3×3
  content/guides/{id,en}/   panduan dalam Markdown (satu file per bahasa)
  i18n/ui.ts                teks UI bersama (ID & EN)
  lib/faction.ts            aturan ganjil/genap Faction Reveal
  lib/timers.ts             countdown & jam server
  components/FactionTracker.astro
  layouts/Base.astro
  pages/[lang]/             halaman: beranda, faction-reveal, season
```

## Memperbarui data

| Mau ubah apa | Edit file |
| --- | --- |
| Angka Faction Reveal / anggota grup | `src/data/faction-reveal.json` (perbarui juga `updatedAt`) |
| Timer pra-musim, event | `src/data/season.json` |
| Isi panduan | `src/content/guides/id/*.md` **dan** `src/content/guides/en/*.md` |
| Teks menu/footer | `src/i18n/ui.ts` |

Semua waktu disimpan dalam **UTC** (ISO 8601, akhiran `Z`). Waktu server Last War = UTC-2, jadi reset harian 00:00 server = 02:00 UTC = 09:00 WIB.

Data yang belum pasti selalu ditandai sebagai *perkiraan* / *belum terkonfirmasi* di halaman.

## Deploy

Live: **https://lastwar-s6.vercel.app** (Vercel, auto-deploy setiap push ke `main`).

- **Publik:** Vercel atau Cloudflare Pages. Hubungkan repo GitHub, build command `npm run build`, output `dist`. Lalu ganti `site` di `astro.config.mjs` dengan domain final.
- **Tailscale (preview/privat):** `npm run build && npx astro preview --host`, lalu `tailscale serve 4321` (hanya tailnet) atau `tailscale funnel 4321` (publik, mesin harus menyala).

## Roadmap

- [x] Fase 1: beranda + countdown, Faction Reveal Tracker + simulator, panduan season, ID/EN
- [ ] Fase 2: peta interaktif, kalkulator Spore/totem & War Merit, panduan hero
- [ ] Fase 3: halaman khusus server/aliansi/faksi
