// Excel template / import / export for the Badai Manager.
// Sheet names and headers stay Indonesian (they mirror the alliance's master sheet).
import * as XLSX from 'xlsx';
import type { CellStyle } from 'xlsx-js-style';
import type { Config, EventKey, Placements, Player, Team } from './data';

type Rosters = Record<EventKey, Record<Team, Player[]>>;

export const downloadTemplate = () => {
  const data: (string | number)[][] = [
    ['Nama', 'Power', 'Ikut Gurun', 'Tim Gurun', 'Ikut Ngarai', 'Tim Ngarai'],
    ['# Petunjuk:', '', 'Y/N', 'A/B', 'Y/N', 'A/B'],
    ['# Hapus baris ini', '', '', '', '', ''],
    ['Raja Naga', 850, 'Y', 'A', 'Y', 'A'],
    ['Pendekar Surya', 920, 'Y', 'A', 'N', ''],
    ['Petir Hitam', 780, 'N', '', 'Y', 'B'],
    ['Bayangan Malam', 690, 'Y', 'B', 'Y', 'A'],
    ['Cakra Buana', 940, 'Y', 'A', 'Y', 'A'],
  ];
  for (let i = 0; i < 30; i++) data.push(['', '', '', '', '', '']);
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 13 }, { wch: 11 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pemain');
  XLSX.writeFile(wb, 'template-badai-manager.xlsx');
};

type Row = Record<string, unknown>;

/** Reads the first sheet of an .xlsx/.xls/.csv buffer into raw row objects. */
export const readRows = (buffer: ArrayBuffer): Row[] => {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: '' });
};

const findKey = (row: Row, candidates: string[]): unknown => {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
  for (const k of Object.keys(row)) {
    const nk = norm(k.toString());
    for (const c of candidates) {
      if (nk === norm(c)) return row[k];
    }
  }
  return '';
};
const parseBool = (v: unknown) => /^(y|yes|true|1|✓|ikut)$/i.test(String(v).trim());
const parseTeam = (v: unknown): Team | null => {
  const s = String(v).trim().toUpperCase();
  return s === 'A' || s === 'B' ? s : null;
};

/** Converts imported rows to players (same column aliases as the standalone app). */
export const rowsToPlayers = (rows: Row[]): Player[] =>
  rows
    .map((row, i): Player | null => {
      const name = String(findKey(row, ['Nama', 'Name'])).trim();
      if (!name || name.startsWith('#')) return null;
      const power = parseFloat(String(findKey(row, ['Power', 'Kekuatan']))) || 0;
      const joinGurun = parseBool(findKey(row, ['Ikut Gurun', 'JoinGurun', 'Gurun']));
      const joinNgarai = parseBool(findKey(row, ['Ikut Ngarai', 'JoinNgarai', 'Ngarai']));
      const gurunTeam = joinGurun ? parseTeam(findKey(row, ['Tim Gurun', 'TeamGurun', 'GurunTeam'])) || 'A' : null;
      const ngaraiTeam = joinNgarai ? parseTeam(findKey(row, ['Tim Ngarai', 'TeamNgarai', 'NgaraiTeam'])) || 'A' : null;
      return {
        id: 'p_imp_' + Date.now() + '_' + i + '_' + Math.floor(Math.random() * 1000),
        name,
        power,
        joinGurun,
        joinNgarai,
        gurunTeam,
        ngaraiTeam,
      };
    })
    .filter((p): p is Player => p !== null);

// One attendance sheet (follows the "ABSENSI NGARAI / BADRUN" template):
// per team [Nama | Power | Ceklis], both teams side by side (A | B),
// with PARTISIPAN (core) and PENGGANTI (reserve) sections.
const buildBattleSheet = (eventKey: EventKey, config: Config, rosters: Rosters): XLSX.WorkSheet => {
  const ec = config[eventKey];
  const rA = rosters[eventKey].A;
  const rB = rosters[eventKey].B;
  // 7 columns: nameA(0) powerA(1) checkA(2) gap(3) nameB(4) powerB(5) checkB(6)
  const NAME_A = 0, POW_A = 1, CHK_A = 2, NAME_B = 4, POW_B = 5, CHK_B = 6;
  const totalCols = 7, lastCol = 6;
  const P = config.coreSlots;
  const Q = Math.max(config.reserveSlots, rA.length - P, rB.length - P, 0);
  const isGurun = eventKey === 'gurun';
  const title = isGurun ? 'MEDAN PERANG BADAI GURUN' : 'BADAI NGARAI';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  const timeStr = isGurun ? '18.00 - 18.30 WIB' : '21.00 - 21.30 WIB';

  const FONT = 'Montserrat', INK = '000000';
  // 'double' is valid in Excel and written by xlsx-js-style, but missing from its BorderType union.
  const dbl = { style: 'double', color: { rgb: INK } };
  const allBorder = { top: dbl, bottom: dbl, left: dbl, right: dbl } as unknown as CellStyle['border'];
  const titleStyle: CellStyle = { font: { name: FONT, sz: 20, bold: true, color: { rgb: INK } }, alignment: { horizontal: 'center', vertical: 'center' } };
  const hariStyle: CellStyle = { font: { name: FONT, sz: 10, bold: true, color: { rgb: INK } }, alignment: { horizontal: 'center', vertical: 'center' } };
  const timeStyle: CellStyle = { font: { name: FONT, sz: 10, bold: true, color: { rgb: INK } }, alignment: { horizontal: 'right', vertical: 'center' } };
  const teamStyle: CellStyle = { font: { name: FONT, sz: 33, bold: true, color: { rgb: INK } }, alignment: { horizontal: 'center', vertical: 'center' }, border: allBorder };
  const bandStyleA: CellStyle = { font: { name: FONT, sz: 11, bold: true, color: { rgb: INK } }, alignment: { horizontal: 'center', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'D9EAD3' } }, border: allBorder };
  const bandStyleB: CellStyle = { font: { name: FONT, sz: 11, bold: true, color: { rgb: INK } }, alignment: { horizontal: 'center', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'F4CCCC' } }, border: allBorder };
  const nameStyle: CellStyle = { font: { name: FONT, sz: 11, color: { rgb: INK } }, alignment: { vertical: 'center' }, border: allBorder };
  const powStyle: CellStyle = { font: { name: FONT, sz: 11, color: { rgb: INK } }, alignment: { horizontal: 'center', vertical: 'center' }, border: allBorder };
  const chkStyle: CellStyle = { font: { name: FONT, sz: 11, color: { rgb: INK } }, alignment: { vertical: 'center' }, border: allBorder };

  const aoa: (string | number)[][] = [];
  const styles: { r: number; c: number; s: CellStyle }[] = [];
  const blank = (): (string | number)[] => Array(totalCols).fill('');
  const setS = (r: number, c: number, s: CellStyle) => styles.push({ r, c, s });
  const band = (r: number, s: CellStyle, isA: boolean) => [0, 1, 2].forEach((o) => setS(r, (isA ? 0 : 4) + o, s));
  const playerRow = (rr: number, pA?: Player, pB?: Player) => {
    const row = blank();
    // Check column left empty (not FALSE) so it can be formatted as a checkbox in Sheets/Excel.
    row[NAME_A] = pA ? pA.name : ''; row[POW_A] = pA && pA.power ? pA.power : ''; row[CHK_A] = '';
    row[NAME_B] = pB ? pB.name : ''; row[POW_B] = pB && pB.power ? pB.power : ''; row[CHK_B] = '';
    aoa.push(row);
    setS(rr, NAME_A, nameStyle); setS(rr, POW_A, powStyle); setS(rr, CHK_A, chkStyle);
    setS(rr, NAME_B, nameStyle); setS(rr, POW_B, powStyle); setS(rr, CHK_B, chkStyle);
  };

  let row = blank(); row[NAME_A] = title; aoa.push(row); setS(0, NAME_A, titleStyle);
  row = blank(); row[NAME_A] = `Hari Pertempuran : ${dateStr}`; row[NAME_B] = timeStr; aoa.push(row); setS(1, NAME_A, hariStyle); setS(1, NAME_B, timeStyle);
  row = blank(); row[NAME_A] = ec.teamAName; row[NAME_B] = ec.teamBName; aoa.push(row); band(2, teamStyle, true); band(2, teamStyle, false);
  row = blank(); row[NAME_A] = 'PARTISIPAN'; row[NAME_B] = 'PARTISIPAN'; aoa.push(row); band(3, bandStyleA, true); band(3, bandStyleB, false);
  for (let i = 0; i < P; i++) playerRow(4 + i, rA[i], rB[i]);
  const rP = 4 + P;
  row = blank(); row[NAME_A] = 'PENGGANTI'; row[NAME_B] = 'PENGGANTI'; aoa.push(row); band(rP, bandStyleA, true); band(rP, bandStyleB, false);
  for (let i = 0; i < Q; i++) playerRow(rP + 1 + i, rA[P + i], rB[P + i]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }, { s: { r: 1, c: 4 }, e: { r: 1, c: 6 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } }, { s: { r: 2, c: 4 }, e: { r: 2, c: 6 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } }, { s: { r: 3, c: 4 }, e: { r: 3, c: 6 } },
    { s: { r: rP, c: 0 }, e: { r: rP, c: 2 } }, { s: { r: rP, c: 4 }, e: { r: rP, c: 6 } },
  ];
  ws['!cols'] = [{ wch: 20 }, { wch: 6.56 }, { wch: 13 }, { wch: 0.89 }, { wch: 20 }, { wch: 6.56 }, { wch: 13 }];
  const rows: XLSX.RowInfo[] = [];
  rows[0] = { hpt: 26 };
  rows[2] = { hpt: 44 };
  ws['!rows'] = rows;
  styles.forEach(({ r, c, s }) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
    (ws[addr] as XLSX.CellObject & { s?: CellStyle }).s = s;
  });
  return ws;
};

interface ExportArgs {
  sortedByPower: Player[];
  config: Config;
  placements: Placements;
  playerById: Map<string, Player>;
  rosters: Rosters;
}

export const exportWorkbook = async ({ sortedByPower, config, placements, playerById, rosters }: ExportArgs) => {
  const wb = XLSX.utils.book_new();

  // Sheet 1: all players
  const playerRows: (string | number)[][] = [
    ['#', 'Nama', 'Power', 'Ikut Gurun', 'Tim Gurun', 'Ikut Ngarai', 'Tim Ngarai'],
    ...sortedByPower.map((p, i) => [
      i + 1, p.name, p.power,
      p.joinGurun ? 'Y' : 'N', p.gurunTeam || '',
      p.joinNgarai ? 'Y' : 'N', p.ngaraiTeam || '',
    ]),
  ];
  const wsPlayers = XLSX.utils.aoa_to_sheet(playerRows);
  wsPlayers['!cols'] = [{ wch: 4 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 13 }, { wch: 11 }];
  XLSX.utils.book_append_sheet(wb, wsPlayers, 'Daftar Pemain');

  // Sheet 2: participants
  const participantRows: (string | number)[][] = [['#', 'Nama', 'Power', 'Gurun (Tim)', 'Ngarai (Tim)']];
  sortedByPower
    .filter((p) => p.joinGurun || p.joinNgarai)
    .forEach((p, i) => {
      participantRows.push([
        i + 1, p.name, p.power,
        p.joinGurun ? p.gurunTeam || '' : '',
        p.joinNgarai ? p.ngaraiTeam || '' : '',
      ]);
    });
  const wsPart = XLSX.utils.aoa_to_sheet(participantRows);
  wsPart['!cols'] = [{ wch: 4 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsPart, 'Berpartisipasi');

  // One sheet per event
  (['gurun', 'ngarai'] as EventKey[]).forEach((eventKey) => {
    const ec = config[eventKey];
    const rows: (string | number)[][] = [['Bangunan', 'Slot', `${ec.teamAName} (A)`, 'Power A', `${ec.teamBName} (B)`, 'Power B']];
    ec.buildings.forEach((b) => {
      for (let i = 0; i < b.slots; i++) {
        const aId = placements[eventKey].A[b.id]?.[i];
        const bId = placements[eventKey].B[b.id]?.[i];
        const aP = aId ? playerById.get(aId) : undefined;
        const bP = bId ? playerById.get(bId) : undefined;
        rows.push([b.name, i + 1, aP?.name || '', aP?.power || '', bP?.name || '', bP?.power || '']);
      }
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 20 }, { wch: 6 }, { wch: 22 }, { wch: 10 }, { wch: 22 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, eventKey === 'gurun' ? 'Badai Gurun' : 'Badai Ngarai');
  });

  // Print-ready attendance sheets
  XLSX.utils.book_append_sheet(wb, buildBattleSheet('gurun', config, rosters), 'Absensi Gurun');
  XLSX.utils.book_append_sheet(wb, buildBattleSheet('ngarai', config, rosters), 'Absensi Ngarai');

  const fileName = `badai-manager-${new Date().toISOString().slice(0, 10)}.xlsx`;
  // Write with xlsx-js-style so cell styles survive; fall back to the plain writer.
  try {
    const mod = await import('xlsx-js-style');
    const XLSXStyle = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
    XLSXStyle.writeFile(wb as Parameters<typeof XLSXStyle.writeFile>[0], fileName);
  } catch (err) {
    console.error('Styled export failed, using plain writer:', err);
    XLSX.writeFile(wb, fileName);
  }
};
