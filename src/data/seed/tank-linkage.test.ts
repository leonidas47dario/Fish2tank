/**
 * The seeded tank names are a join key.
 *
 * fish_inventory.csv addresses its enclosures by name, and applyInventoryImport
 * matches an imported label to an existing aquarium by name. If a name in
 * STARTER_TANKS drifts from the CSV, the import silently stops matching: it
 * adds a second, empty tank alongside the seeded one and files the fish there.
 * Nothing throws, and the tanks screen just quietly shows eight tanks instead
 * of six. This test is the thing that notices.
 *
 * The owner-facing names ("Deep Sea Collector", "Peaceful Garden", "Dune") are
 * applied by updateSeededTanks() after the import has run, so renaming a tank
 * for display is still free - it just has to happen there, not here.
 */
import { describe, expect, it } from 'vitest';
import { STARTER_TANKS } from '../bootstrap';
import { parseInventoryCsv } from './inventory-import';
import inventoryCsv from './fish_inventory.csv?raw';

describe('seeded tank / inventory linkage', () => {
  const normalise = (s: string) => s.trim().toLowerCase();
  const csvTanks = [...new Set(parseInventoryCsv(inventoryCsv).map((r) => normalise(r.tank)))];
  const seeded = new Set(STARTER_TANKS.map((t) => normalise(t.name)));

  it('reads enclosure labels out of the seed CSV', () => {
    // Guards the test itself: an empty list would make the next case vacuous.
    expect(csvTanks.length).toBeGreaterThan(0);
  });

  it('has a seeded tank for every enclosure the CSV names', () => {
    expect(csvTanks.filter((t) => !seeded.has(t))).toEqual([]);
  });

  it('seeds no two tanks under the same name', () => {
    // Name is the match key, so a duplicate makes the winner arbitrary.
    expect(seeded.size).toBe(STARTER_TANKS.length);
  });
});
