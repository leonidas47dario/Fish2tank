/**
 * Opening-balance inventory import - PRD 6.2 / FR-O03.
 *
 * The source workbook (`fish_inventory.xlsx`, 61 rows across six enclosure
 * labels: 75G, Breeder Tote, Quarantine, Bass Tote, Mini Tank, Predator Tank)
 * is NOT in this repository. This module implements the documented column
 * contract and the migration guardrails so the real file can be dropped in
 * unchanged; see docs/INVENTORY_IMPORT.md.
 *
 * Migration guardrail, quoted from PRD 6.2: "Never merge the same species
 * across tanks, invent acquisition dates, or treat the spreadsheet row as a
 * canonical species record. Each row becomes a current holding snapshot."
 *
 * The three ways this could go wrong, and how each is prevented:
 *   - Merging duplicates: every row produces its own Holding, keyed by row
 *     order, never grouped by species text.
 *   - Invented history: no `acquired` life event is written. The opening
 *     quantity is the balance; there is no claim about when it arrived.
 *   - Canonical species: `rawLabel` holds the source text verbatim and
 *     `speciesId` stays undefined unless the label matches the catalog
 *     exactly. "Unclear ID" rows stay unclear (FR-O05).
 */
import type { Aquarium, AquariumKind, CalendarDate, Holding, Residency, Species } from '@/domain/types';
import { newId, nowIso } from '../db';

/** One row of the source workbook's Fish Inventory sheet. */
export interface InventoryRow {
  /** "Tank" column - the enclosure label, e.g. "75G", "Breeder Tote". */
  tank: string;
  /** "Species / Description" column - preserved verbatim, never parsed away. */
  speciesDescription: string;
  /** "Quantity" column. */
  quantity: number;
  /** "Category" column - Fish, Invert, Amphibian. Preserved as a tag. */
  category?: string;
  /** "Notes" column - preserved verbatim. */
  notes?: string;
}

export interface ImportResult {
  aquariums: Aquarium[];
  holdings: Holding[];
  residencies: Residency[];
  /** Row-by-row report so nothing is silently dropped. */
  report: Array<{
    row: number;
    tank: string;
    label: string;
    quantity: number;
    holdingId: string;
    matchedSpeciesId?: string;
    identity: 'matched' | 'unresolved';
  }>;
}

/**
 * Totes and quarantine bins are valid enclosures, not malformed tanks
 * (PRD 6.2: "totes and quarantine remain valid enclosure types").
 */
export function enclosureKind(label: string): AquariumKind {
  const l = label.toLowerCase();
  if (l.includes('tote')) return 'tote';
  if (l.includes('quarantine') || /\bqt\b/.test(l)) return 'quarantine';
  if (l.includes('grow')) return 'grow-out';
  if (l.includes('pond')) return 'pond';
  return 'display';
}

/**
 * Exact-match only, deliberately.
 *
 * A fuzzy match would quietly turn "jaguar cichlid?" or "unclear ID - some
 * kind of pleco" into a confident species assignment, which is precisely what
 * FR-O05 forbids. Anything not matched stays raw and unresolved for the user
 * to confirm later.
 */
export function matchSpeciesExact(label: string, catalog: Species[]): Species | undefined {
  const l = label.trim().toLowerCase();
  return catalog.find(
    (s) =>
      s.commonName.toLowerCase() === l ||
      s.scientificName?.toLowerCase() === l ||
      s.aliases.some((a) => a.toLowerCase() === l),
  );
}

export function importInventory(
  rows: InventoryRow[],
  catalog: Species[] = [],
  options: { openingDate?: CalendarDate } = {},
): ImportResult {
  const openingDate = options.openingDate ?? nowIso().slice(0, 10);
  const createdAt = nowIso();

  const aquariumsByLabel = new Map<string, Aquarium>();
  const holdings: Holding[] = [];
  const residencies: Residency[] = [];
  const report: ImportResult['report'] = [];

  rows.forEach((row, index) => {
    const label = row.tank.trim();
    let aquarium = aquariumsByLabel.get(label);
    if (!aquarium) {
      aquarium = {
        id: newId('tank'),
        name: label,
        kind: enclosureKind(label),
        status: 'active',
        // Volume and dimensions are NOT in the source columns. Leaving them
        // undefined is what makes screening return "Not enough data" for this
        // tank until the user fills them in, rather than guessing (FR-E05).
        notes: 'Imported from inventory. Add volume and dimensions to enable compatibility screening.',
        createdAt,
      };
      aquariumsByLabel.set(label, aquarium);
    }

    const matched = matchSpeciesExact(row.speciesDescription, catalog);
    const holding: Holding = {
      id: newId('hold'),
      // No specimen: an opening balance has no encounter behind it (FR-T02).
      speciesId: matched?.id,
      rawLabel: row.speciesDescription,
      kind: row.quantity > 1 ? 'group' : 'individual',
      openingQuantity: row.quantity,
      category: row.category,
      openingBalance: true,
      notes: row.notes,
      createdAt,
    };
    holdings.push(holding);

    residencies.push({
      id: newId('res'),
      holdingId: holding.id,
      aquariumId: aquarium.id,
      startDate: openingDate,
      note: 'Opening balance - actual arrival date unknown and not inferred',
    });

    report.push({
      row: index + 1,
      tank: label,
      label: row.speciesDescription,
      quantity: row.quantity,
      holdingId: holding.id,
      matchedSpeciesId: matched?.id,
      identity: matched ? 'matched' : 'unresolved',
    });
  });

  return { aquariums: [...aquariumsByLabel.values()], holdings, residencies, report };
}

/**
 * Parse a CSV export of the Fish Inventory sheet.
 *
 * Kept separate from importInventory so the migration rules can be tested
 * without a parser in the way, and so a future .xlsx reader can feed the same
 * function.
 */
export function parseInventoryCsv(csv: string): InventoryRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const cells = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const header = cells(lines[0]!).map((h) => h.toLowerCase());
  const col = (...names: string[]): number =>
    header.findIndex((h) => names.some((n) => h === n || h.includes(n)));

  const iTank = col('tank', 'enclosure');
  const iSpecies = col('species', 'description');
  const iQty = col('quantity', 'qty', 'count');
  const iCategory = col('category', 'class');
  const iNotes = col('notes', 'note');

  return lines.slice(1).flatMap((line) => {
    const c = cells(line);
    const tank = iTank >= 0 ? c[iTank] ?? '' : '';
    const speciesDescription = iSpecies >= 0 ? c[iSpecies] ?? '' : '';
    if (!tank && !speciesDescription) return [];
    const rawQty = iQty >= 0 ? c[iQty] ?? '' : '';
    const parsed = Number.parseInt(rawQty, 10);
    return [{
      tank,
      speciesDescription,
      // A blank or unreadable quantity becomes 1 rather than 0, so the row is
      // never silently emptied of its animal.
      quantity: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
      category: iCategory >= 0 ? c[iCategory] || undefined : undefined,
      notes: iNotes >= 0 ? c[iNotes] || undefined : undefined,
    }];
  });
}
