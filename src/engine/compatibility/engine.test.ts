import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, evaluateAllTanks, evaluateCompatibility } from './engine';
import { aquarium, candidate, FIXTURE_NOW, profile, resident, species, tank } from './fixtures';
import type { FactorId, Verdict } from '@/domain/types';

const at = { now: FIXTURE_NOW, assessmentId: 'assess_test' };

function factor(
  result: ReturnType<typeof evaluateCompatibility>,
  id: FactorId,
): { verdict: Verdict; reason?: string; missingInputs: string[] } {
  const f = result.factors.find((x) => x.factor === id);
  if (!f) throw new Error(`factor ${id} not evaluated`);
  return f;
}

describe('identity gate (FR-I05)', () => {
  it('refuses any verdict for an unknown fish', () => {
    const r = evaluateCompatibility(candidate({ identityStatus: 'unknown' }), tank(), at);
    expect(r.verdict).toBe('insufficient-data');
    expect(r.factors).toHaveLength(0);
    expect(r.missingInputs).toContain('a confirmed species identity');
  });

  it('refuses a verdict while the identity is only provisional', () => {
    const r = evaluateCompatibility(candidate({ identityStatus: 'provisional' }), tank(), at);
    expect(r.verdict).toBe('insufficient-data');
  });
});

describe('minimum enclosure (PRD 5.1)', () => {
  it('returns extreme risk below the hard volume minimum', () => {
    const c = candidate({ profile: profile('sp_test', { minimumVolume: { value: 180, unit: 'gal' } }) });
    const r = evaluateCompatibility(c, tank(), at);
    expect(factor(r, 'minimum-enclosure').verdict).toBe('extreme-risk');
    expect(r.verdict).toBe('extreme-risk');
  });

  it('returns not enough data when the tank volume is unrecorded', () => {
    const t = tank({ aquarium: aquarium({ volume: undefined }) });
    const r = evaluateCompatibility(candidate(), t, at);
    expect(factor(r, 'minimum-enclosure').verdict).toBe('insufficient-data');
    expect(factor(r, 'minimum-enclosure').missingInputs).toContain('volume of 75G');
  });

  it('compares gallons against litres correctly', () => {
    // 200 litres ~ 52.8 gallons, so a 75G tank clears it.
    const c = candidate({ profile: profile('sp_test', { minimumVolume: { value: 200, unit: 'l' } }) });
    expect(factor(evaluateCompatibility(c, tank(), at), 'minimum-enclosure').verdict).toBe('suitable');
    // 400 litres ~ 105.7 gallons, so it does not.
    const c2 = candidate({ profile: profile('sp_test', { minimumVolume: { value: 400, unit: 'l' } }) });
    expect(factor(evaluateCompatibility(c2, tank(), at), 'minimum-enclosure').verdict).toBe('extreme-risk');
  });

  it('fails a tank that meets the volume but not the footprint', () => {
    const c = candidate({
      profile: profile('sp_test', {
        minimumVolume: { value: 40, unit: 'gal' },
        minimumFootprint: { length: { value: 72, unit: 'in' }, width: { value: 18, unit: 'in' } },
      }),
    });
    expect(factor(evaluateCompatibility(c, tank(), at), 'minimum-enclosure').verdict).toBe('extreme-risk');
  });
});

describe('adult size (FR-E03)', () => {
  it('treats a tank shorter than 4x adult body length as extreme risk', () => {
    // 16in adult needs 64in of length; the fixture tank is 48in.
    const c = candidate({ profile: profile('sp_test', { adultSize: { value: 16, unit: 'in' } }) });
    expect(factor(evaluateCompatibility(c, tank(), at), 'adult-size').verdict).toBe('extreme-risk');
  });

  it('flags a tank too narrow to turn in as high risk', () => {
    // 12in adult: needs 48in length (met exactly) and 18in width (met exactly),
    // so widen the fish slightly to break only the width rule.
    const c = candidate({ profile: profile('sp_test', { adultSize: { value: 12.5, unit: 'in' } }) });
    const t = tank({ aquarium: aquarium({ dimensions: {
      length: { value: 60, unit: 'in' }, width: { value: 18, unit: 'in' }, height: { value: 21, unit: 'in' },
    } }) });
    expect(factor(evaluateCompatibility(c, t, at), 'adult-size').verdict).toBe('high-risk');
  });

  it('calls a tight-but-workable fit conditional', () => {
    // 10in adult: 4x = 40in (met by 48in), 5x = 50in (not met) -> tight.
    const c = candidate({ profile: profile('sp_test', { adultSize: { value: 10, unit: 'in' } }) });
    expect(factor(evaluateCompatibility(c, tank(), at), 'adult-size').verdict).toBe('conditional');
  });

  it('returns not enough data when tank dimensions are missing (FR-E05)', () => {
    const t = tank({ aquarium: aquarium({ dimensions: undefined }) });
    const r = evaluateCompatibility(candidate(), t, at);
    expect(factor(r, 'adult-size').verdict).toBe('insufficient-data');
    expect(r.verdict).not.toBe('suitable');
  });
});

describe('aggression matrix', () => {
  it('escalates a highly-aggressive candidate against a peaceful resident to extreme risk', () => {
    const c = candidate({ profile: profile('sp_test', { aggression: 'highly-aggressive' }) });
    const t = tank({ residents: [resident({ profile: profile('sp_resident', { aggression: 'peaceful' }) })] });
    expect(factor(evaluateCompatibility(c, t, at), 'aggression').verdict).toBe('extreme-risk');
  });

  it('is symmetric: a peaceful candidate against a highly-aggressive resident is equally extreme', () => {
    const c = candidate({ profile: profile('sp_test', { aggression: 'peaceful' }) });
    const t = tank({ residents: [resident({ profile: profile('sp_resident', { aggression: 'highly-aggressive' }) })] });
    expect(factor(evaluateCompatibility(c, t, at), 'aggression').verdict).toBe('extreme-risk');
  });

  it('treats two robust fish as conditional rather than fatal', () => {
    const c = candidate({ profile: profile('sp_test', { aggression: 'aggressive' }) });
    const t = tank({ residents: [resident({ profile: profile('sp_resident', { aggression: 'aggressive' }) })] });
    expect(factor(evaluateCompatibility(c, t, at), 'aggression').verdict).toBe('conditional');
  });

  it('passes cleanly in an empty tank', () => {
    expect(factor(evaluateCompatibility(candidate(), tank(), at), 'aggression').verdict).toBe('suitable');
  });

  it('cannot assume a resident with no recorded rating is harmless', () => {
    const t = tank({ residents: [resident({ label: 'unclear ID', profile: undefined })] });
    const f = factor(evaluateCompatibility(candidate(), t, at), 'aggression');
    expect(f.verdict).toBe('insufficient-data');
    expect(f.missingInputs).toContain('aggression rating for unclear ID');
  });

  it('names every implicated resident so the user can inspect each pairing (FR-E04)', () => {
    const c = candidate({ profile: profile('sp_test', { aggression: 'highly-aggressive' }) });
    const t = tank({
      residents: [
        resident({ holdingId: 'h1', label: 'Tetra', profile: profile('sp_a', { aggression: 'peaceful' }) }),
        resident({ holdingId: 'h2', label: 'Pleco', profile: profile('sp_b', { aggression: 'peaceful' }) }),
      ],
    });
    const r = evaluateCompatibility(c, t, at);
    expect(r.factors.find((f) => f.factor === 'aggression')?.relatedHoldingIds).toEqual(['h1', 'h2']);
  });
});

describe('predation', () => {
  it('calls a resident inside the predator prey band extreme risk', () => {
    // 14in piscivore vs a 3in resident -> 21% ratio, inside the 40% band.
    const c = candidate({
      profile: profile('sp_test', { adultSize: { value: 14, unit: 'in' }, predationTags: ['piscivore'] }),
    });
    const t = tank({
      aquarium: aquarium({ dimensions: { length: { value: 96, unit: 'in' }, width: { value: 30, unit: 'in' }, height: { value: 24, unit: 'in' } } }),
      residents: [resident({ label: 'Tetra', profile: profile('sp_resident', { adultSize: { value: 3, unit: 'in' } }) })],
    });
    expect(factor(evaluateCompatibility(c, t, at), 'predation').verdict).toBe('extreme-risk');
  });

  it('calls a resident just outside the prey band high risk', () => {
    // 14in piscivore vs 7.5in resident -> 54%, past the 40% eat band but inside
    // the 60% harassment band.
    const c = candidate({
      profile: profile('sp_test', { adultSize: { value: 14, unit: 'in' }, predationTags: ['piscivore'] }),
    });
    const t = tank({
      aquarium: aquarium({ dimensions: { length: { value: 96, unit: 'in' }, width: { value: 30, unit: 'in' }, height: { value: 24, unit: 'in' } } }),
      residents: [resident({ label: 'Cichlid', profile: profile('sp_resident', { adultSize: { value: 7.5, unit: 'in' } }) })],
    });
    expect(factor(evaluateCompatibility(c, t, at), 'predation').verdict).toBe('high-risk');
  });

  it('applies the rule in reverse when the RESIDENT is the predator', () => {
    const c = candidate({ profile: profile('sp_test', { adultSize: { value: 3, unit: 'in' } }) });
    const t = tank({
      residents: [resident({
        label: 'Bichir',
        profile: profile('sp_resident', { adultSize: { value: 14, unit: 'in' }, predationTags: ['ambush-predator'] }),
      })],
    });
    expect(factor(evaluateCompatibility(c, t, at), 'predation').verdict).toBe('extreme-risk');
  });

  it('honours a species-specific prey ratio over the default', () => {
    // 20% ratio would normally be eaten, but this predator only takes 10%.
    const c = candidate({
      profile: profile('sp_test', {
        adultSize: { value: 15, unit: 'in' },
        predationTags: ['opportunistic'],
        preySizeRatio: 0.1,
      }),
    });
    const t = tank({
      aquarium: aquarium({ dimensions: { length: { value: 96, unit: 'in' }, width: { value: 30, unit: 'in' }, height: { value: 24, unit: 'in' } } }),
      residents: [resident({ profile: profile('sp_resident', { adultSize: { value: 3, unit: 'in' } }) })],
    });
    expect(factor(evaluateCompatibility(c, t, at), 'predation').verdict).toBe('suitable');
  });

  it('protects inverts from an invert predator regardless of size', () => {
    const c = candidate({ profile: profile('sp_test', { predationTags: ['invert-predator'] }) });
    const t = tank({ residents: [resident({ label: 'Amano shrimp', category: 'Invert', profile: undefined })] });
    expect(factor(evaluateCompatibility(c, t, at), 'predation').verdict).toBe('high-risk');
  });
});

describe('water overlap', () => {
  it('calls non-overlapping temperature ranges a hard conflict', () => {
    const c = candidate({ profile: profile('sp_test', { water: { temperatureC: { min: 10, max: 16 } } }) });
    expect(factor(evaluateCompatibility(c, tank(), at), 'water-overlap').verdict).toBe('extreme-risk');
  });

  it('calls a narrow shared band conditional', () => {
    // Candidate 26-30 vs tank 24-27 -> 1C of overlap, under the 2C threshold.
    const c = candidate({ profile: profile('sp_test', { water: { temperatureC: { min: 26, max: 30 } } }) });
    expect(factor(evaluateCompatibility(c, tank(), at), 'water-overlap').verdict).toBe('conditional');
  });

  it('does not block a green verdict when temperature data is simply absent (PRD 5.1)', () => {
    const c = candidate({ profile: profile('sp_test', { water: {} }) });
    const t = tank({ aquarium: aquarium({ stockingState: 'low', water: undefined }) });
    const r = evaluateCompatibility(c, t, at);
    expect(factor(r, 'water-overlap').verdict).toBe('insufficient-data');
    // Water is the one factor exempted from blocking sufficiency.
    expect(r.verdict).toBe('suitable');
  });
});

describe('social needs', () => {
  it('flags a schooling species kept below its group size as high risk', () => {
    const c = candidate({ quantity: 1, profile: profile('sp_test', { socialNeeds: ['schooling'] }) });
    expect(factor(evaluateCompatibility(c, tank(), at), 'social-needs').verdict).toBe('high-risk');
  });

  it('counts conspecifics already in the tank toward the group', () => {
    const sp = species('sp_test', 'Test Fish');
    const c = candidate({ species: sp, quantity: 2, profile: profile(sp.id, { socialNeeds: ['schooling'] }) });
    const t = tank({ residents: [resident({ speciesId: sp.id, quantity: 5, profile: profile(sp.id) })] });
    expect(factor(evaluateCompatibility(c, t, at), 'social-needs').verdict).toBe('suitable');
  });

  it('flags a territorial species joining a resident conspecific', () => {
    const sp = species('sp_test', 'Test Fish');
    const c = candidate({ species: sp, profile: profile(sp.id, { socialNeeds: ['territorial'] }) });
    const t = tank({ residents: [resident({ speciesId: sp.id, quantity: 1, profile: profile(sp.id) })] });
    expect(factor(evaluateCompatibility(c, t, at), 'social-needs').verdict).toBe('high-risk');
  });

  it('treats a shoaling shortfall as merely conditional', () => {
    const c = candidate({ quantity: 2, profile: profile('sp_test', { socialNeeds: ['shoaling'] }) });
    expect(factor(evaluateCompatibility(c, tank(), at), 'social-needs').verdict).toBe('conditional');
  });
});

describe('crowding', () => {
  it('raises risk for a tank the user marked crowded, without inventing a bioload figure', () => {
    const t = tank({ aquarium: aquarium({ stockingState: 'crowded' }) });
    const f = factor(evaluateCompatibility(candidate(), t, at), 'crowding');
    expect(f.verdict).toBe('conditional');
    expect(f.reason).toContain('Crowded');
    expect(f.reason).not.toMatch(/\d+\s*%\s*(stocked|bioload)/i);
  });

  it('does not block a green verdict when stocking state is unset', () => {
    const t = tank({ aquarium: aquarium({ stockingState: undefined }) });
    expect(evaluateCompatibility(candidate(), t, at).verdict).toBe('suitable');
  });
});

describe('verdict aggregation (PRD 5.2)', () => {
  it('returns suitable when every required factor passes', () => {
    const t = tank({ aquarium: aquarium({ stockingState: 'low' }) });
    expect(evaluateCompatibility(candidate(), t, at).verdict).toBe('suitable');
  });

  it('escalates several compounding warnings to high risk', () => {
    // Three conditionals: tight adult size, narrow temperature band, crowded tank.
    const c = candidate({
      profile: profile('sp_test', {
        adultSize: { value: 10, unit: 'in' },
        water: { temperatureC: { min: 26, max: 30 } },
      }),
    });
    const t = tank({ aquarium: aquarium({ stockingState: 'crowded' }) });
    const r = evaluateCompatibility(c, t, at);
    const conditionals = r.factors.filter((f) => f.verdict === 'conditional');
    expect(conditionals.length).toBeGreaterThanOrEqual(DEFAULT_RULES.compoundingWarningThreshold);
    expect(r.verdict).toBe('high-risk');
  });

  it('never returns suitable when a required input is missing (success measure 11.2)', () => {
    const stripped = [
      { adultSize: undefined },
      { minimumVolume: undefined },
      { aggression: undefined },
      { socialNeeds: undefined as never },
    ];
    for (const over of stripped) {
      const r = evaluateCompatibility(candidate({ profile: profile('sp_test', over) }), tank(), at);
      expect(r.verdict).not.toBe('suitable');
    }
  });

  it('reports a proven hard conflict ahead of unrelated missing data', () => {
    // Extreme predation conflict AND a missing aggression rating on a resident.
    const c = candidate({
      profile: profile('sp_test', { adultSize: { value: 14, unit: 'in' }, predationTags: ['piscivore'] }),
    });
    const t = tank({
      aquarium: aquarium({ dimensions: { length: { value: 96, unit: 'in' }, width: { value: 30, unit: 'in' }, height: { value: 24, unit: 'in' } } }),
      residents: [resident({ label: 'Tetra', profile: profile('sp_r', { adultSize: { value: 3, unit: 'in' }, aggression: undefined }) })],
    });
    const r = evaluateCompatibility(c, t, at);
    expect(r.verdict).toBe('extreme-risk');
    // The gap is still reported rather than swallowed.
    expect(r.missingInputs).toContain('aggression rating for Tetra');
  });

  it('always lists missing inputs alongside whatever the headline says (FR-E05)', () => {
    const t = tank({ aquarium: aquarium({ volume: undefined, dimensions: undefined }) });
    const r = evaluateCompatibility(candidate(), t, at);
    expect(r.missingInputs.length).toBeGreaterThan(0);
    expect(r.verdict).toBe('insufficient-data');
  });
});

describe('transparency and versioning (FR-E04, FR-E07, NFR-09)', () => {
  it('stamps the rules version onto every assessment', () => {
    expect(evaluateCompatibility(candidate(), tank(), at).rulesVersion).toBe(DEFAULT_RULES.version);
  });

  it('exposes the inputs behind each factor', () => {
    const r = evaluateCompatibility(candidate(), tank(), at);
    const minEnclosure = r.factors.find((f) => f.factor === 'minimum-enclosure')!;
    expect(minEnclosure.inputsUsed).toEqual(
      expect.arrayContaining([{ label: '75G volume', value: '75G' }]),
    );
  });

  it('is deterministic: identical inputs produce an identical verdict', () => {
    const a = evaluateCompatibility(candidate(), tank(), at);
    const b = evaluateCompatibility(candidate(), tank(), at);
    expect(b).toEqual(a);
  });

  it('lets a single rule be disabled by configuration (FR-E06)', () => {
    const c = candidate({ profile: profile('sp_test', { minimumVolume: { value: 500, unit: 'gal' } }) });
    const withRule = evaluateCompatibility(c, tank(), at);
    expect(withRule.verdict).toBe('extreme-risk');

    const withoutRule = evaluateCompatibility(c, tank(), {
      ...at,
      rules: { ...DEFAULT_RULES, minimumEnclosure: { enabled: false, blocksSufficiency: true } },
    });
    expect(withoutRule.factors.some((f) => f.factor === 'minimum-enclosure')).toBe(false);
    expect(withoutRule.verdict).not.toBe('extreme-risk');
  });
});

describe('juvenile fit is secondary and time-bounded (FR-E03)', () => {
  it('reports a temporary fit without softening the headline', () => {
    const c = candidate({
      observedSize: { value: 4, unit: 'in', estimate: true },
      profile: profile('sp_test', { adultSize: { value: 16, unit: 'in' } }),
    });
    const r = evaluateCompatibility(c, tank(), at);
    expect(r.verdict).toBe('extreme-risk');
    expect(r.temporaryJuvenileFit).toBeDefined();
    expect(r.temporaryJuvenileFit!.note).toContain('temporary window');
  });

  it('omits the juvenile view entirely when the long-term answer is already green', () => {
    const c = candidate({
      observedSize: { value: 1, unit: 'in' },
      profile: profile('sp_test', { adultSize: { value: 4, unit: 'in' } }),
    });
    const t = tank({ aquarium: aquarium({ stockingState: 'low' }) });
    const r = evaluateCompatibility(c, t, at);
    expect(r.verdict).toBe('suitable');
    expect(r.temporaryJuvenileFit).toBeUndefined();
  });
});

describe('evaluateAllTanks (FR-E02)', () => {
  it('screens every active aquarium and skips retired ones', () => {
    const tanks = [
      tank({ aquarium: aquarium({ id: 't1', name: '75G', status: 'active' }) }),
      tank({ aquarium: aquarium({ id: 't2', name: 'Mini Tank', status: 'active', volume: { value: 5, unit: 'gal' } }) }),
      tank({ aquarium: aquarium({ id: 't3', name: 'Old 20L', status: 'retired' }) }),
    ];
    const results = evaluateAllTanks(candidate(), tanks, at);
    expect(results.map((r) => r.aquariumId)).toEqual(['t1', 't2']);
    expect(results[1]!.verdict).toBe('extreme-risk');
  });
});

describe('a screening run is one event (FR-E07)', () => {
  it('stamps every tank in a run with the same assessedAt', () => {
    const tanks = Array.from({ length: 6 }, (_, i) =>
      tank({ aquarium: aquarium({ id: `t${i}`, name: `Tank ${i}` }) }),
    );
    // No `now` supplied, so the engine must generate exactly one itself.
    const results = evaluateAllTanks(candidate(), tanks);
    expect(new Set(results.map((r) => r.assessedAt)).size).toBe(1);
  });

  it('keeps assessment ids unique within that shared instant', () => {
    const tanks = [
      tank({ aquarium: aquarium({ id: 't1', name: 'A' }) }),
      tank({ aquarium: aquarium({ id: 't2', name: 'B' }) }),
    ];
    const results = evaluateAllTanks(candidate(), tanks);
    expect(new Set(results.map((r) => r.id)).size).toBe(2);
  });

  it('so grouping a run by its timestamp returns every tank', () => {
    const tanks = Array.from({ length: 6 }, (_, i) =>
      tank({ aquarium: aquarium({ id: `t${i}`, name: `Tank ${i}` }) }),
    );
    const results = evaluateAllTanks(candidate(), tanks);
    const newest = [...results].sort((a, b) => b.assessedAt.localeCompare(a.assessedAt))[0]!;
    expect(results.filter((r) => r.assessedAt === newest.assessedAt)).toHaveLength(6);
  });
});
