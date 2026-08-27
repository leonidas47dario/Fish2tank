import { describe, expect, it } from 'vitest';
import { enclosureKind, importInventory, matchSpeciesExact, parseInventoryCsv, type InventoryRow } from './inventory-import';
import { DELIBERATELY_UNRESOLVED, SPECIES_CATALOG } from './species-catalog';

const catalog = SPECIES_CATALOG.map((e) => e.species);

// The six enclosure labels named in PRD 6.2.
const SIX_LABELS = ['75G', 'Breeder Tote', 'Quarantine', 'Bass Tote', 'Mini Tank', 'Predator Tank'];

function rows(...over: Array<Partial<InventoryRow>>): InventoryRow[] {
  return over.map((o) => ({ tank: '75G', speciesDescription: 'Some Fish', quantity: 1, ...o }));
}

describe('enclosure kinds (PRD 6.2)', () => {
  it('keeps totes and quarantine as valid enclosure types', () => {
    expect(enclosureKind('Breeder Tote')).toBe('tote');
    expect(enclosureKind('Bass Tote')).toBe('tote');
    expect(enclosureKind('Quarantine')).toBe('quarantine');
    expect(enclosureKind('75G')).toBe('display');
    expect(enclosureKind('Mini Tank')).toBe('display');
  });
});

describe('species matching (FR-O05)', () => {
  it('matches an exact common name', () => {
    expect(matchSpeciesExact('Jaguar Cichlid', catalog)?.id).toBe('sp_jaguar_cichlid');
  });

  it('matches a scientific name and a store alias', () => {
    expect(matchSpeciesExact('Parachromis managuensis', catalog)?.id).toBe('sp_jaguar_cichlid');
    expect(matchSpeciesExact('Managuense', catalog)?.id).toBe('sp_jaguar_cichlid');
  });

  it('refuses to guess at an unclear label', () => {
    expect(matchSpeciesExact('unclear ID - some kind of pleco', catalog)).toBeUndefined();
    expect(matchSpeciesExact('jaguar cichlid?', catalog)).toBeUndefined();
  });
});

describe('import guardrails (PRD 6.2)', () => {
  it('creates one holding per row and never merges the same species across tanks', () => {
    const result = importInventory(
      rows(
        { tank: '75G', speciesDescription: 'Jaguar Cichlid', quantity: 1 },
        { tank: 'Predator Tank', speciesDescription: 'Jaguar Cichlid', quantity: 1 },
      ),
      catalog,
    );
    expect(result.holdings).toHaveLength(2);
    expect(result.holdings[0]!.id).not.toBe(result.holdings[1]!.id);
    expect(new Set(result.residencies.map((r) => r.aquariumId)).size).toBe(2);
  });

  it('preserves the raw label verbatim even when a species is matched', () => {
    const result = importInventory(rows({ speciesDescription: 'Managuense' }), catalog);
    expect(result.holdings[0]!.rawLabel).toBe('Managuense');
    expect(result.holdings[0]!.speciesId).toBe('sp_jaguar_cichlid');
  });

  it('leaves an unclear ID unresolved rather than forcing a species', () => {
    const result = importInventory(rows({ speciesDescription: 'unclear ID' }), catalog);
    expect(result.holdings[0]!.speciesId).toBeUndefined();
    expect(result.holdings[0]!.rawLabel).toBe('unclear ID');
    expect(result.report[0]!.identity).toBe('unresolved');
  });

  it('invents no acquisition history', () => {
    const result = importInventory(rows({}), catalog);
    // No life events are produced at all; the opening quantity IS the balance.
    expect(result).not.toHaveProperty('lifeEvents');
    expect(result.holdings[0]!.openingBalance).toBe(true);
    expect(result.residencies[0]!.note).toMatch(/not inferred/i);
  });

  it('preserves quantity, category and notes', () => {
    const result = importInventory(
      rows({ quantity: 7, category: 'Invert', notes: 'added after the 2025 crash' }),
      catalog,
    );
    const h = result.holdings[0]!;
    expect(h.openingQuantity).toBe(7);
    expect(h.category).toBe('Invert');
    expect(h.notes).toBe('added after the 2025 crash');
  });

  it('classifies a multi-count row as a group and a single as an individual', () => {
    const result = importInventory(rows({ quantity: 6 }, { quantity: 1 }), catalog);
    expect(result.holdings[0]!.kind).toBe('group');
    expect(result.holdings[1]!.kind).toBe('individual');
  });

  it('creates each distinct enclosure exactly once', () => {
    const result = importInventory(
      rows(...SIX_LABELS.map((tank) => ({ tank })), { tank: '75G' }, { tank: 'Quarantine' }),
      catalog,
    );
    expect(result.aquariums).toHaveLength(6);
    expect(result.aquariums.map((a) => a.name).sort()).toEqual([...SIX_LABELS].sort());
  });

  it('leaves imported tanks without dimensions so screening honestly returns Not enough data', () => {
    const result = importInventory(rows({}), catalog);
    expect(result.aquariums[0]!.volume).toBeUndefined();
    expect(result.aquariums[0]!.dimensions).toBeUndefined();
    expect(result.aquariums[0]!.notes).toMatch(/add volume and dimensions/i);
  });

  it('reports every row so nothing is silently dropped (FR-O03)', () => {
    const input = rows({}, {}, {});
    const result = importInventory(input, catalog);
    expect(result.report).toHaveLength(3);
    expect(result.report.map((r) => r.row)).toEqual([1, 2, 3]);
  });

  it('round-trips a 61-row sheet without losing a single row', () => {
    const sixtyOne = Array.from({ length: 61 }, (_, i) => ({
      tank: SIX_LABELS[i % SIX_LABELS.length]!,
      speciesDescription: `Row ${i + 1} fish`,
      quantity: (i % 4) + 1,
    }));
    const result = importInventory(sixtyOne, catalog);
    expect(result.holdings).toHaveLength(61);
    expect(result.residencies).toHaveLength(61);
    expect(result.report).toHaveLength(61);
    const totalFish = result.holdings.reduce((n, h) => n + h.openingQuantity, 0);
    expect(totalFish).toBe(sixtyOne.reduce((n, r) => n + r.quantity, 0));
  });
});

describe('CSV parsing', () => {
  it('reads the documented columns in any order', () => {
    const csv = [
      'Notes,Quantity,Tank,Category,Species / Description',
      'doing well,3,Breeder Tote,Fish,Bumblebee Goby',
    ].join('\n');
    expect(parseInventoryCsv(csv)).toEqual([
      { tank: 'Breeder Tote', speciesDescription: 'Bumblebee Goby', quantity: 3, category: 'Fish', notes: 'doing well' },
    ]);
  });

  it('handles quoted fields containing commas', () => {
    const csv = ['Tank,Species / Description,Quantity', '75G,"Pleco, unclear ID",1'].join('\n');
    expect(parseInventoryCsv(csv)[0]!.speciesDescription).toBe('Pleco, unclear ID');
  });

  it('handles escaped quotes inside a field', () => {
    const csv = ['Tank,Species / Description,Quantity', '75G,"the ""Panther""",1'].join('\n');
    expect(parseInventoryCsv(csv)[0]!.speciesDescription).toBe('the "Panther"');
  });

  it('defaults an unreadable quantity to 1 rather than emptying the row', () => {
    const csv = ['Tank,Species / Description,Quantity', '75G,Jaguar Cichlid,'].join('\n');
    expect(parseInventoryCsv(csv)[0]!.quantity).toBe(1);
  });

  it('skips blank lines', () => {
    const csv = ['Tank,Species / Description,Quantity', '75G,A,1', '', '75G,B,2', ''].join('\n');
    expect(parseInventoryCsv(csv)).toHaveLength(2);
  });
});

describe('catalog coverage of the real inventory', () => {
  it('resolves the species it claims to know', () => {
    const rows: InventoryRow[] = [
      { tank: '75G', speciesDescription: 'Wolf fish', quantity: 1 },
      { tank: '75G', speciesDescription: 'Jack Dempsey', quantity: 1 },
      { tank: '75G', speciesDescription: 'Rocket gar', quantity: 2 },
      { tank: 'Breeder Tote', speciesDescription: 'Feeder guppy', quantity: 50 },
      { tank: 'Predator Tank', speciesDescription: 'Congo puffer', quantity: 1 },
    ];
    const result = importInventory(rows, catalog);
    expect(result.report.every((r) => r.identity === 'matched')).toBe(true);
  });

  it('leaves every deliberately-unresolved label unresolved', () => {
    // If someone later adds a guess for one of these, this fails loudly.
    for (const label of DELIBERATELY_UNRESOLVED) {
      expect(matchSpeciesExact(label, catalog)).toBeUndefined();
    }
  });

  it('gives every catalog profile a source', () => {
    for (const e of SPECIES_CATALOG) {
      expect(e.profile.sources.length).toBeGreaterThan(0);
      expect(e.profile.sources[0]!.note).toBeTruthy();
    }
  });

  it('marks hybrids as having no taxonomic source rather than inventing one', () => {
    const flowerhorn = SPECIES_CATALOG.find((e) => e.species.id === 'sp_flowerhorn')!;
    expect(flowerhorn.species.scientificName).toBeUndefined();
    expect(flowerhorn.profile.sources[0]!.url).toBeUndefined();
    expect(flowerhorn.profile.sources[0]!.label).toMatch(/hybrid/i);
  });
});
