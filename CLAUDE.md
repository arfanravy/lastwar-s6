# 1196-MAAX — Last War Season 6 fan site

Bilingual (ID/EN) Astro 7 static site for Last War: Survival Season 6 "Lost Rainforest", built for alliance **MAAX** on server **#1196** (Wetland faction). Live: https://lastwar-s6.vercel.app (Vercel auto-deploys every push to `main`). Repo: `arfanravy/lastwar-s6` (public).

## Working with the user
- The user writes Indonesian; reply in Indonesian, short and to the point. They want to save tokens: avoid multi-agent workflows, long explanations and extra screenshots unless asked.
- Workflow per change: edit → `npm run build` (must pass) → commit → `git push origin main` → confirm it is live with curl.
- Large/risky features: work on a branch first so the live site never shows half-done work.

## Commands
```bash
npm run build    # static build to dist/
npm run check    # astro check (types)
npx astro preview --port 4321 --host 127.0.0.1   # serve dist for testing
```
Playwright + Chromium are preinstalled (use `--use-angle=swiftshader` for WebGL pages).

## Structure
- `src/pages/[lang]/` — `index` (home), `calendar`, `faction-reveal` (3D map + Top 5/THP popup), `season` (guide), `planner` (map planner), `badai` (Storm Manager, React), `map` (redirect), `s6-calendar.ics.ts` (iCal feed).
- `src/content/guides/{id,en}/season-overview.md` — Season guide; always update **both** languages.
- `src/components/` — `RainforestMap` (three.js faction map), `SiteBackdrop` (3D background), `PrepChecklist`, `WarTimeRules`, `NextEvents`, `planner/`, `badai/`.
- `src/lib/` — `calendar.ts` (dates/ICS), `theme.ts` (light/dark), `alliances.ts` (roster import + rename matching), `map3d/`, `backdrop/`, `planner/`.
- `src/config.ts` — site name, home server, nav routes. `src/i18n/ui.ts` — shared UI strings.

## Data files (most frequent edits)
| What | File | Source |
|---|---|---|
| MAAX roster (Planner/Badai "Data MAAX" button) | `src/data/alliances/maax.json` | Google Sheet below |
| Top 5 alliances per server | `src/data/top-alliances.json` | in-game ranking screenshots |
| Top 10 THP per server | `src/data/top-players.json` | in-game Total Hero Power videos/screenshots |
| Calendar events | `src/data/calendar.json` (week/day/server time) | in-game Rules + lastwartutorial.com |
| Pre-season timer, prep checklist | `src/data/season.json` | in-game |
| Faction groups/grid | `src/data/faction-reveal.json` | in-game |
| Checklist icons | `public/icons/prep/*.webp` (96px) | cropped from user screenshots |

### Updating the MAAX roster ("update data maax")
- Sheet: `https://docs.google.com/spreadsheets/d/1XbWHpMLdEGjrRPXrZkBMp2-5T7AaimfW8isBGMBbZW4`, tab **"Data Power Sq1"** (gid 1997094973). Public; download with `.../export?format=xlsx` and read with openpyxl.
- Columns: `NO` (stable member id — match renames by NO), `Nama`, `Type Squad`, `Power SQ1` (millions, comma decimals). **Rank comes from the fill colour of the name cell**: `FFFFD966`=R5, `FFF6B26B`=R4, `FF93C47D`=R3, `FF9FC5E8`=R2, `FFD9D9D9`=R1. Check counts against the "KETERANGAN WARNA" legend. `ぴあはぴあだ` has no colour → treat as R3.
- JSON entry: `{name, rank, power?, type?, was?}`. When a member renames, add the old name(s) to `was` so imports rename instead of duplicating. Keep existing `was` entries. Set `updatedAt`.
- Report to the user: new members, renames, leavers, rank changes, power changes, missing data.

## Theme (light/dark)
- `<html data-theme>` set before paint (Base.astro inline script); toggle in header; stored in localStorage `rimba.theme`.
- Use tokens from `src/styles/global.css`, never raw colours: `--text`, `--muted`, `--text-strong`, `--surface`, `--surface-2`, `--border`, `--overlay-bg`, `--merah` (+ `--on-accent` for text on red), `--flag-white`, faction/warn/cat tokens. `--forest-*` and `--putih` are inverted in light.
- Component-specific colours: scoped custom property with dark default + `:global(:root[data-theme='light'])` override.
- three.js scenes take a palette per theme and subscribe with `onThemeChange` from `src/lib/theme.ts`.
- Dark theme must stay unchanged when editing.

## Conventions
- Times stored in UTC; Last War server time is **UTC-2** (daily reset 00:00 server = 09:00 WIB). Season week 1 day 1 = `season.json` `preseason.endsAt`.
- Mark uncertain info as "perkiraan"/"belum terkonfirmasi" in the UI.
- Fan site disclaimer stays in the footer. Commit messages in English.
