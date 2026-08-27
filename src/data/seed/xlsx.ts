/**
 * Minimal .xlsx reader - just enough to load the Fish Inventory sheet.
 *
 * An .xlsx is a ZIP of XML. Rather than take a spreadsheet dependency for one
 * import screen, this unzips with the platform's own `DecompressionStream`
 * (Safari 16.4+, Chrome 80+, Node 18+) and reads the two parts that matter.
 *
 * The XML is scanned with a small tokenizer rather than DOMParser, so the same
 * code runs unchanged in the browser and in Node tests. That is only safe
 * because SpreadsheetML cells are machine-generated and rigidly shaped; do not
 * extend this into a general XML parser.
 *
 * Supports what Excel, Numbers and Google Sheets actually emit for a simple
 * sheet: stored and deflated entries, shared strings, and inline strings.
 */
import type { InventoryRow } from './inventory-import';

// --- ZIP ------------------------------------------------------------------

interface ZipEntry {
  name: string;
  compression: number;
  data: Uint8Array;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer: the entry is a subarray view over the whole
  // file, and Blob would otherwise be handed the entire backing buffer.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read the ZIP central directory.
 *
 * Scanning from the end for the End Of Central Directory signature is the
 * correct approach even for a well-formed archive, because the comment field
 * is variable length.
 */
function readZip(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65_557; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file (no ZIP directory found).');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const compression = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // The local header repeats the name/extra lengths, and its extra field
    // length can differ from the central directory's - always re-read it.
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;

    entries.push({ name, compression, data: bytes.subarray(start, start + compressedSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readPart(entries: ZipEntry[], name: string): Promise<string | undefined> {
  const entry = entries.find((e) => e.name === name);
  if (!entry) return undefined;
  const raw = entry.compression === 0 ? entry.data : await inflateRaw(entry.data);
  return new TextDecoder().decode(raw);
}

// --- SpreadsheetML --------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** All <t> text inside a fragment, concatenated. Handles rich-text runs. */
function textOf(fragment: string): string {
  const out: string[] = [];
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) out.push(decodeEntities(m[1] ?? ''));
  return out.join('');
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textOf(m[1] ?? ''));
  return out;
}

type Cells = Map<string, string>;

function parseSheet(xml: string, shared: string[]): Cells[] {
  const rows: Cells[] = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml))) {
    const cells: Cells = new Map();
    const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(rowMatch[1] ?? ''))) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];

      let value: string;
      if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v === undefined) value = '';
        else if (type === 's') value = shared[Number(v)] ?? '';
        else value = decodeEntities(v);
      }
      if (value !== '') cells.set(ref, value);
    }
    if (cells.size > 0) rows.push(cells);
  }
  return rows;
}

// --- Public API -----------------------------------------------------------

/**
 * Read the inventory rows out of an .xlsx workbook.
 *
 * Column letters are resolved from the header row by keyword, exactly as the
 * CSV path does, so a re-ordered or re-worded sheet still imports.
 */
export async function parseInventoryXlsx(buf: ArrayBuffer): Promise<InventoryRow[]> {
  const entries = readZip(buf);
  const shared = parseSharedStrings(await readPart(entries, 'xl/sharedStrings.xml'));

  // Prefer the first worksheet part; workbooks from every major editor put the
  // first sheet here.
  const sheetName = entries
    .map((e) => e.name)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetName) throw new Error('No worksheet found in that .xlsx file.');

  const sheetXml = await readPart(entries, sheetName);
  if (!sheetXml) throw new Error('Could not read the worksheet.');

  const rows = parseSheet(sheetXml, shared);
  if (rows.length === 0) return [];

  const header = rows[0]!;
  const columnFor = (...keywords: string[]): string | undefined => {
    for (const [col, text] of header) {
      const t = text.toLowerCase();
      if (keywords.some((k) => t.includes(k))) return col;
    }
    return undefined;
  };

  const cTank = columnFor('tank', 'enclosure');
  const cSpecies = columnFor('species', 'description');
  const cQty = columnFor('quantity', 'qty', 'count');
  const cCategory = columnFor('category', 'class');
  const cNotes = columnFor('note');

  return rows.slice(1).flatMap((cells) => {
    const tank = cTank ? cells.get(cTank) ?? '' : '';
    const speciesDescription = cSpecies ? cells.get(cSpecies) ?? '' : '';
    if (!tank && !speciesDescription) return [];
    const parsed = Number.parseInt(cQty ? cells.get(cQty) ?? '' : '', 10);
    return [{
      tank,
      speciesDescription,
      quantity: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
      category: cCategory ? cells.get(cCategory) || undefined : undefined,
      notes: cNotes ? cells.get(cNotes) || undefined : undefined,
    }];
  });
}
