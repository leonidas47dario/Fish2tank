import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseInventoryXlsx } from './xlsx';
import { importInventory } from './inventory-import';
import { SPECIES_CATALOG } from './species-catalog';

/**
 * Read against the REAL workbook committed at docs/fish_inventory.xlsx, not a
 * synthetic fixture. The point of this reader is that Ryan's actual file loads
 * without being converted by hand first.
 */
function workbook(): ArrayBuffer {
  const buf = readFileSync('docs/fish_inventory.xlsx');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('parseInventoryXlsx against the real workbook', () => {
  it('reads exactly the 61 rows the PRD describes', async () => {
    const rows = await parseInventoryXlsx(workbook());
    expect(rows).toHaveLength(61);
  });

  it('finds the six enclosure labels from PRD 6.2', async () => {
    const rows = await parseInventoryXlsx(workbook());
    expect([...new Set(rows.map((r) => r.tank))].sort()).toEqual(
      ['75G', 'Bass Tote', 'Breeder Tote', 'Mini Tank', 'Predator Tank', 'Quarantine'],
    );
  });

  it('reads quantities as numbers, including the 50 feeder guppies', async () => {
    const rows = await parseInventoryXlsx(workbook());
    const guppies = rows.find((r) => r.speciesDescription === 'Feeder guppy');
    expect(guppies?.quantity).toBe(50);
    expect(rows.reduce((n, r) => n + r.quantity, 0)).toBe(136);
  });

  it('preserves the three categories', async () => {
    const rows = await parseInventoryXlsx(workbook());
    const categories = rows.reduce<Record<string, number>>((acc, r) => {
      if (r.category) acc[r.category] = (acc[r.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(categories).toEqual({ Fish: 54, Invert: 6, Amphibian: 1 });
  });

  it('keeps the Verify species notes attached to their rows', async () => {
    const rows = await parseInventoryXlsx(workbook());
    const flagged = rows.filter((r) => r.notes === 'Verify species');
    expect(flagged.map((r) => r.speciesDescription).sort()).toEqual([
      'Deinoi (unclear ID)', 'Neobasher (unclear ID)', 'Rare cory (unknown)',
    ]);
  });

  it('feeds straight into the importer without losing a row', async () => {
    const rows = await parseInventoryXlsx(workbook());
    const result = importInventory(rows, SPECIES_CATALOG.map((e) => e.species));
    expect(result.holdings).toHaveLength(61);
    expect(result.aquariums).toHaveLength(6);
    // The unclear IDs must survive the round trip unresolved (FR-O05).
    const deinoi = result.holdings.find((h) => h.rawLabel === 'Deinoi (unclear ID)');
    expect(deinoi?.speciesId).toBeUndefined();
    expect(deinoi?.notes).toBe('Verify species');
  });

  it('rejects a file that is not a zip archive at all', async () => {
    const notAZip = new TextEncoder().encode('Tank,Species,Quantity\n75G,Betta,1').buffer;
    await expect(parseInventoryXlsx(notAZip as ArrayBuffer)).rejects.toThrow(/not a valid \.xlsx/i);
  });
});
