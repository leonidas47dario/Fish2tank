/**
 * Deterministic compatibility screening - PRD 5.1 / 5.2.
 *
 * The engine answers one narrow question (PRD 5.1): "based on the data
 * currently stored, is this aquarium a plausible long-term home?" It is not a
 * guarantee, and it is conservative when inputs are incomplete.
 *
 * Principle P5 - "Rules before AI": nothing here consults a model. Every
 * verdict is a pure function of stored inputs plus a versioned rule config, so
 * the same inputs always produce the same output and every factor is
 * inspectable (FR-E04).
 */
import type {
  AggressionRating,
  Aquarium,
  CompatibilityAssessment,
  FactorId,
  FactorResult,
  Id,
  IdentityStatus,
  Instant,
  LengthMeasurement,
  Species,
  SpeciesProfile,
  SpecimenKind,
  Verdict,
  WaterRange,
} from '@/domain/types';
import { formatLength, formatVolume, toCm, toLitres } from '@/domain/units';
import { AGGRESSION_LEVEL, DEFAULT_RULES, type CompatibilityRuleConfig } from './rules';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CandidateInput {
  specimenId: Id;
  kind: SpecimenKind;
  /** How many of this fish would join the tank. Drives the social-needs rule. */
  quantity: number;
  identityStatus: IdentityStatus;
  species?: Species;
  profile?: SpeciesProfile;
  /** Size seen in the store. Used only for the secondary juvenile view (FR-E03). */
  observedSize?: LengthMeasurement;
}

export interface ResidentInput {
  holdingId: Id;
  /** Display label, raw store text when no species is confirmed. */
  label: string;
  quantity: number;
  speciesId?: Id;
  profile?: SpeciesProfile;
  /** "Fish" | "Invert" | "Amphibian" - preserved from the source inventory (6.2). */
  category?: string;
}

export interface TankInput {
  aquarium: Aquarium;
  residents: ResidentInput[];
}

/** Which body length the rules should reason about. FR-E03. */
type SizeBasis = 'adult' | 'observed';

// ---------------------------------------------------------------------------
// Verdict algebra
// ---------------------------------------------------------------------------

/**
 * Precedence for combining factor verdicts into one headline.
 *
 * INTERPRETATION NOTE. PRD 5.2 lists a trigger for each verdict but not a
 * precedence between them, and two of those triggers can fire at once (a known
 * hard conflict plus an unrelated missing input). We rank a known conflict
 * above "Not enough data", because reporting "Not enough data" when a hard
 * predation conflict has already been proven would hide the more actionable
 * fact. "Not enough data" still outranks Conditional and Suitable, which is
 * what the normative requirements actually demand: FR-E05 says "return Not
 * enough data rather than INFER SAFETY from missing facts", and success
 * measure 11.2 says missing inputs must produce "Not enough data rather than
 * SUITABLE". Under this ordering no green verdict can ever survive a missing
 * required input, and `missingInputs` is populated on every assessment
 * regardless of the headline.
 */
const SEVERITY: Record<Verdict, number> = {
  suitable: 0,
  conditional: 1,
  'insufficient-data': 2,
  'high-risk': 3,
  'extreme-risk': 4,
};

function worst(a: Verdict, b: Verdict): Verdict {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Factor helpers
// ---------------------------------------------------------------------------

function pass(factor: FactorId, inputsUsed: FactorResult['inputsUsed'], reason?: string): FactorResult {
  return { factor, verdict: 'suitable', inputsUsed, missingInputs: [], ...(reason ? { reason } : {}) };
}

function missing(factor: FactorId, missingInputs: string[]): FactorResult {
  return {
    factor,
    verdict: 'insufficient-data',
    reason: `Cannot evaluate: ${missingInputs.join(', ')}.`,
    inputsUsed: [],
    missingInputs,
  };
}

function bodyLength(candidate: CandidateInput, basis: SizeBasis): LengthMeasurement | undefined {
  return basis === 'adult' ? candidate.profile?.adultSize : candidate.observedSize;
}

// ---------------------------------------------------------------------------
// Individual rules (PRD 5.1)
// ---------------------------------------------------------------------------

function ruleMinimumEnclosure(
  candidate: CandidateInput,
  tank: TankInput,
  cfg: CompatibilityRuleConfig,
): FactorResult {
  const required = candidate.profile?.minimumVolume;
  const available = tank.aquarium.volume;
  const missingInputs: string[] = [];
  if (!required) missingInputs.push('species minimum enclosure volume');
  if (!available) missingInputs.push(`volume of ${tank.aquarium.name}`);
  if (missingInputs.length) return missing('minimum-enclosure', missingInputs);

  const requiredL = toLitres(required)!;
  const availableL = toLitres(available)!;
  const inputsUsed = [
    { label: 'Species minimum volume', value: formatVolume(required) },
    { label: `${tank.aquarium.name} volume`, value: formatVolume(available) },
  ];

  if (availableL < requiredL) {
    return {
      factor: 'minimum-enclosure',
      verdict: 'extreme-risk',
      reason: `${tank.aquarium.name} holds ${formatVolume(available)}, below the ${formatVolume(required)} minimum for this species.`,
      inputsUsed,
      missingInputs: [],
    };
  }

  // Footprint is a separate hard floor: volume alone can be met by a tall tank
  // that a long fish still cannot turn around in.
  const footprint = candidate.profile?.minimumFootprint;
  const dims = tank.aquarium.dimensions;
  if (cfg.minimumEnclosure.enabled && footprint && dims) {
    const needL = toCm(footprint.length)!;
    const needW = toCm(footprint.width)!;
    const haveL = toCm(dims.length)!;
    const haveW = toCm(dims.width)!;
    inputsUsed.push({ label: 'Species minimum footprint', value: `${formatLength(footprint.length)} x ${formatLength(footprint.width)}` });
    inputsUsed.push({ label: `${tank.aquarium.name} footprint`, value: `${formatLength(dims.length)} x ${formatLength(dims.width)}` });
    if (haveL < needL || haveW < needW) {
      return {
        factor: 'minimum-enclosure',
        verdict: 'extreme-risk',
        reason: `${tank.aquarium.name} footprint is smaller than the species minimum footprint.`,
        inputsUsed,
        missingInputs: [],
      };
    }
  }

  return pass('minimum-enclosure', inputsUsed, `${formatVolume(available)} meets the ${formatVolume(required)} minimum.`);
}

function ruleAdultSize(
  candidate: CandidateInput,
  tank: TankInput,
  cfg: CompatibilityRuleConfig,
  basis: SizeBasis,
): FactorResult {
  const size = bodyLength(candidate, basis);
  const dims = tank.aquarium.dimensions;
  const missingInputs: string[] = [];
  if (!size) missingInputs.push(basis === 'adult' ? 'species adult size' : 'observed size');
  if (!dims) missingInputs.push(`dimensions of ${tank.aquarium.name}`);
  if (missingInputs.length) return missing('adult-size', missingInputs);

  const sizeCm = toCm(size)!;
  const tankLenCm = toCm(dims!.length)!;
  const tankWidCm = toCm(dims!.width)!;
  const needLen = sizeCm * cfg.adultSize.minLengthMultiple;
  const needWid = sizeCm * cfg.adultSize.minWidthMultiple;

  const inputsUsed = [
    { label: basis === 'adult' ? 'Adult size' : 'Observed size', value: formatLength(size) },
    { label: `${tank.aquarium.name} length`, value: formatLength(dims!.length) },
    { label: `${tank.aquarium.name} width`, value: formatLength(dims!.width) },
    { label: 'Required length', value: `${cfg.adultSize.minLengthMultiple}x body = ${Math.round(needLen)}cm` },
    { label: 'Required width', value: `${cfg.adultSize.minWidthMultiple}x body = ${Math.round(needWid)}cm` },
  ];

  if (tankLenCm < needLen) {
    return {
      factor: 'adult-size',
      verdict: 'extreme-risk',
      reason: `A ${formatLength(size)} fish needs at least ${cfg.adultSize.minLengthMultiple}x its body length to swim; ${tank.aquarium.name} is ${formatLength(dims!.length)}.`,
      inputsUsed,
      missingInputs: [],
    };
  }
  if (tankWidCm < needWid) {
    return {
      factor: 'adult-size',
      verdict: 'high-risk',
      reason: `${tank.aquarium.name} is only ${formatLength(dims!.width)} front-to-back; a ${formatLength(size)} fish needs ${cfg.adultSize.minWidthMultiple}x its body length to turn comfortably.`,
      inputsUsed,
      missingInputs: [],
    };
  }
  if (tankLenCm < sizeCm * cfg.adultSize.conditionalLengthMultiple) {
    return {
      factor: 'adult-size',
      verdict: 'conditional',
      reason: `Workable but tight: ${tank.aquarium.name} gives under ${cfg.adultSize.conditionalLengthMultiple}x body length of swimming room at full size.`,
      inputsUsed,
      missingInputs: [],
    };
  }
  return pass('adult-size', inputsUsed, `${tank.aquarium.name} gives ample room at ${formatLength(size)}.`);
}

function ruleAggression(candidate: CandidateInput, tank: TankInput): FactorResult {
  const candAgg = candidate.profile?.aggression;
  if (!candAgg) return missing('aggression', ['species aggression rating']);
  if (tank.residents.length === 0) {
    return pass('aggression', [{ label: 'Candidate aggression', value: candAgg }], 'No current residents to conflict with.');
  }

  const inputsUsed = [{ label: 'Candidate aggression', value: candAgg }];
  const missingInputs: string[] = [];
  let verdict: Verdict = 'suitable';
  const reasons: string[] = [];
  const related: Id[] = [];

  for (const r of tank.residents) {
    const resAgg: AggressionRating | undefined = r.profile?.aggression;
    if (!resAgg) {
      missingInputs.push(`aggression rating for ${r.label}`);
      continue;
    }
    inputsUsed.push({ label: `${r.label} aggression`, value: resAgg });
    const cand = AGGRESSION_LEVEL[candAgg];
    const res = AGGRESSION_LEVEL[resAgg];
    const gap = Math.abs(cand - res);
    const peak = Math.max(cand, res);

    let pairVerdict: Verdict = 'suitable';
    if (peak >= 3 && gap >= 2) pairVerdict = 'extreme-risk';
    else if (gap >= 2) pairVerdict = 'high-risk';
    else if (peak >= 2 || gap === 1) pairVerdict = 'conditional';

    if (pairVerdict !== 'suitable') {
      related.push(r.holdingId);
      reasons.push(`${candAgg} candidate vs ${resAgg} ${r.label}`);
      verdict = worst(verdict, pairVerdict);
    }
  }

  // A missing resident rating cannot be assumed harmless (FR-E05).
  if (missingInputs.length) verdict = worst(verdict, 'insufficient-data');

  return {
    factor: 'aggression',
    verdict,
    reason: reasons.length ? `Temperament conflict: ${reasons.join('; ')}.` : undefined,
    inputsUsed,
    missingInputs,
    relatedHoldingIds: related,
  };
}

function rulePredation(
  candidate: CandidateInput,
  tank: TankInput,
  cfg: CompatibilityRuleConfig,
  basis: SizeBasis,
): FactorResult {
  const candSize = bodyLength(candidate, basis);
  const candProfile = candidate.profile;
  if (!candProfile) return missing('predation', ['species profile']);
  if (!candSize) return missing('predation', [basis === 'adult' ? 'species adult size' : 'observed size']);
  if (tank.residents.length === 0) {
    return pass('predation', [{ label: 'Candidate size', value: formatLength(candSize) }], 'No current residents to predate or be predated on.');
  }

  const candCm = toCm(candSize)!;
  const candPredatory = candProfile.predationTags.length > 0;
  const inputsUsed = [
    { label: 'Candidate size', value: formatLength(candSize) },
    { label: 'Candidate predation tags', value: candProfile.predationTags.join(', ') || 'none recorded' },
  ];
  const missingInputs: string[] = [];
  const reasons: string[] = [];
  const related: Id[] = [];
  let verdict: Verdict = 'suitable';

  for (const r of tank.residents) {
    // Inverts are prey to anything tagged as an invert predator, regardless of size.
    if (candProfile.predationTags.includes('invert-predator') && r.category?.toLowerCase() === 'invert') {
      related.push(r.holdingId);
      reasons.push(`candidate preys on inverts and ${r.label} is an invert`);
      verdict = worst(verdict, 'high-risk');
      continue;
    }

    const resSize = r.profile?.adultSize;
    if (!resSize) {
      missingInputs.push(`adult size for ${r.label}`);
      continue;
    }
    const resCm = toCm(resSize)!;
    inputsUsed.push({ label: `${r.label} adult size`, value: formatLength(resSize) });

    const [predator, prey, predatorLabel, preyLabel, predatorTags, predatorRatio] =
      candCm >= resCm
        ? [candCm, resCm, candidate.species?.commonName ?? 'candidate', r.label, candProfile.predationTags, candProfile.preySizeRatio]
        : [resCm, candCm, r.label, candidate.species?.commonName ?? 'candidate', r.profile!.predationTags, r.profile!.preySizeRatio];

    if (predatorTags.length === 0) continue;
    const ratio = prey / predator;
    const eatRatio = predatorRatio ?? cfg.predation.defaultPreySizeRatio;

    if (ratio <= eatRatio) {
      related.push(r.holdingId);
      reasons.push(`${preyLabel} is ${Math.round(ratio * 100)}% of ${predatorLabel}'s length, inside its ${Math.round(eatRatio * 100)}% prey band`);
      verdict = worst(verdict, 'extreme-risk');
    } else if (ratio <= eatRatio * cfg.predation.cautionRatioMultiple) {
      related.push(r.holdingId);
      reasons.push(`${preyLabel} at ${Math.round(ratio * 100)}% of ${predatorLabel}'s length is within harassment range`);
      verdict = worst(verdict, 'high-risk');
    }
  }

  if (missingInputs.length) verdict = worst(verdict, 'insufficient-data');
  if (!candPredatory && reasons.length === 0 && missingInputs.length === 0) {
    return pass('predation', inputsUsed, 'No predation tags on the candidate and none triggered by residents.');
  }

  return {
    factor: 'predation',
    verdict,
    reason: reasons.length ? `Predation risk: ${reasons.join('; ')}.` : undefined,
    inputsUsed,
    missingInputs,
    relatedHoldingIds: related,
  };
}

function overlap(a: { min: number; max: number }, b: { min: number; max: number }) {
  const lo = Math.max(a.min, b.min);
  const hi = Math.min(a.max, b.max);
  return { lo, hi, width: hi - lo };
}

function ruleWaterOverlap(
  candidate: CandidateInput,
  tank: TankInput,
  cfg: CompatibilityRuleConfig,
): FactorResult {
  const candRange = candidate.profile?.water?.temperatureC;
  if (!candRange) return missing('water-overlap', ['species temperature range']);

  const others: Array<{ label: string; range: WaterRange['temperatureC'] }> = [
    { label: tank.aquarium.name, range: tank.aquarium.water?.temperatureC },
    ...tank.residents.map((r) => ({ label: r.label, range: r.profile?.water?.temperatureC })),
  ];

  const inputsUsed = [{ label: 'Candidate temperature range', value: `${candRange.min}-${candRange.max}C` }];
  const missingInputs: string[] = [];
  const reasons: string[] = [];
  let verdict: Verdict = 'suitable';
  let compared = 0;

  for (const o of others) {
    if (!o.range) {
      missingInputs.push(`temperature range for ${o.label}`);
      continue;
    }
    compared += 1;
    inputsUsed.push({ label: `${o.label} temperature range`, value: `${o.range.min}-${o.range.max}C` });
    const ov = overlap(candRange, o.range);
    if (ov.width < 0) {
      reasons.push(`no shared temperature with ${o.label}`);
      verdict = worst(verdict, 'extreme-risk');
    } else if (ov.width < cfg.waterOverlap.marginalOverlapC) {
      reasons.push(`only ${ov.width.toFixed(1)}C shared with ${o.label}`);
      verdict = worst(verdict, 'conditional');
    }
  }

  // PRD 5.1: water is "unassessed if data is absent" - it reports what it could
  // not check but does not by itself block a green overall verdict. That
  // exemption is expressed by waterOverlap.blocksSufficiency = false.
  if (compared === 0) return missing('water-overlap', missingInputs);

  return {
    factor: 'water-overlap',
    verdict,
    reason: reasons.length ? `Temperature conflict: ${reasons.join('; ')}.` : undefined,
    inputsUsed,
    missingInputs,
  };
}

function ruleSocialNeeds(
  candidate: CandidateInput,
  tank: TankInput,
  cfg: CompatibilityRuleConfig,
): FactorResult {
  const needs = candidate.profile?.socialNeeds;
  if (!needs) return missing('social-needs', ['species social needs']);

  const inputsUsed = [
    { label: 'Social needs', value: needs.join(', ') || 'none recorded' },
    { label: 'Quantity joining', value: String(candidate.quantity) },
  ];
  const reasons: string[] = [];
  let verdict: Verdict = 'suitable';

  const conspecifics = candidate.species
    ? tank.residents.filter((r) => r.speciesId && r.speciesId === candidate.species!.id)
    : [];
  const conspecificCount = conspecifics.reduce((n, r) => n + r.quantity, 0);
  const groupSize = candidate.quantity + conspecificCount;
  if (conspecificCount > 0) {
    inputsUsed.push({ label: 'Conspecifics already resident', value: String(conspecificCount) });
  }

  if (needs.includes('schooling') && groupSize < cfg.socialNeeds.minSchoolSize) {
    reasons.push(`schooling species kept at ${groupSize}, below the group of ${cfg.socialNeeds.minSchoolSize} it needs`);
    verdict = worst(verdict, 'high-risk');
  } else if (needs.includes('shoaling') && groupSize < cfg.socialNeeds.minShoalSize) {
    reasons.push(`shoaling species kept at ${groupSize}, below a comfortable group of ${cfg.socialNeeds.minShoalSize}`);
    verdict = worst(verdict, 'conditional');
  }

  if (needs.includes('solitary') && groupSize > 1) {
    reasons.push(`solitary species would share the tank with ${groupSize - 1} conspecific(s)`);
    verdict = worst(verdict, 'high-risk');
  }
  if (needs.includes('territorial') && conspecificCount > 0) {
    reasons.push(`territorial species with ${conspecificCount} conspecific(s) already resident`);
    verdict = worst(verdict, 'high-risk');
  }

  return {
    factor: 'social-needs',
    verdict,
    reason: reasons.length ? `Social conflict: ${reasons.join('; ')}.` : undefined,
    inputsUsed,
    missingInputs: [],
  };
}

function ruleCrowding(tank: TankInput): FactorResult {
  const state = tank.aquarium.stockingState;
  if (!state) return missing('crowding', [`stocking state for ${tank.aquarium.name}`]);
  const inputsUsed = [{ label: `${tank.aquarium.name} stocking state`, value: state }];
  if (state === 'crowded') {
    return {
      factor: 'crowding',
      verdict: 'conditional',
      // PRD 5.1: raises risk, but no fabricated bioload number.
      reason: `${tank.aquarium.name} is marked Crowded. Adding another fish increases load on a tank you have already flagged as full.`,
      inputsUsed,
      missingInputs: [],
    };
  }
  return pass('crowding', inputsUsed, `${tank.aquarium.name} is marked ${state}.`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function blocksSufficiency(factor: FactorId, cfg: CompatibilityRuleConfig): boolean {
  switch (factor) {
    case 'minimum-enclosure': return cfg.minimumEnclosure.blocksSufficiency;
    case 'adult-size': return cfg.adultSize.blocksSufficiency;
    case 'aggression': return cfg.aggression.blocksSufficiency;
    case 'predation': return cfg.predation.blocksSufficiency;
    case 'water-overlap': return cfg.waterOverlap.blocksSufficiency;
    case 'social-needs': return cfg.socialNeeds.blocksSufficiency;
    case 'crowding': return cfg.crowding.blocksSufficiency;
  }
}

function runFactors(
  candidate: CandidateInput,
  tank: TankInput,
  cfg: CompatibilityRuleConfig,
  basis: SizeBasis,
): FactorResult[] {
  const out: FactorResult[] = [];
  if (cfg.minimumEnclosure.enabled) out.push(ruleMinimumEnclosure(candidate, tank, cfg));
  if (cfg.adultSize.enabled) out.push(ruleAdultSize(candidate, tank, cfg, basis));
  if (cfg.aggression.enabled) out.push(ruleAggression(candidate, tank));
  if (cfg.predation.enabled) out.push(rulePredation(candidate, tank, cfg, basis));
  if (cfg.waterOverlap.enabled) out.push(ruleWaterOverlap(candidate, tank, cfg));
  if (cfg.socialNeeds.enabled) out.push(ruleSocialNeeds(candidate, tank, cfg));
  if (cfg.crowding.enabled) out.push(ruleCrowding(tank));
  return out;
}

function aggregate(factors: FactorResult[], cfg: CompatibilityRuleConfig): Verdict {
  let verdict: Verdict = 'suitable';
  let conditionals = 0;

  for (const f of factors) {
    if (f.verdict === 'insufficient-data' && !blocksSufficiency(f.factor, cfg)) {
      // Reported to the user as an unchecked factor, but non-blocking by config.
      continue;
    }
    if (f.verdict === 'conditional') conditionals += 1;
    verdict = worst(verdict, f.verdict);
  }

  // PRD 5.2: several compounding warnings escalate to High risk.
  if (verdict === 'conditional' && conditionals >= cfg.compoundingWarningThreshold) {
    return 'high-risk';
  }
  return verdict;
}

function collectMissing(factors: FactorResult[]): string[] {
  const seen = new Set<string>();
  for (const f of factors) for (const m of f.missingInputs) seen.add(m);
  return [...seen];
}

const HEADLINES: Record<Verdict, string> = {
  suitable: 'Plausible long-term home on the data recorded so far.',
  conditional: 'Workable only with conditions met.',
  'high-risk': 'Serious conflict for a long-term home.',
  'extreme-risk': 'Not a viable long-term home.',
  'insufficient-data': 'Not enough data to judge this tank.',
};

export interface EvaluateOptions {
  rules?: CompatibilityRuleConfig;
  now?: Instant;
  /** Supplied by the caller so ids stay deterministic in tests. */
  assessmentId?: Id;
}

/**
 * Screen one candidate against one aquarium.
 *
 * Returns an immutable snapshot (FR-E07). Re-running after a data correction
 * produces a NEW snapshot; the encounter-day result is never mutated.
 */
export function evaluateCompatibility(
  candidate: CandidateInput,
  tank: TankInput,
  options: EvaluateOptions = {},
): CompatibilityAssessment {
  const cfg = options.rules ?? DEFAULT_RULES;
  const now = options.now ?? new Date().toISOString();
  const id = options.assessmentId ?? `assess_${candidate.specimenId}_${tank.aquarium.id}_${now}`;

  const base: Omit<CompatibilityAssessment, 'verdict' | 'headline' | 'factors' | 'missingInputs'> = {
    id,
    specimenId: candidate.specimenId,
    aquariumId: tank.aquarium.id,
    rulesVersion: cfg.version,
    assessedAt: now,
  };

  // FR-I05: no full compatibility claim before identity is adequate. An
  // unconfirmed fish cannot produce any verdict other than "not enough data".
  if (candidate.identityStatus !== 'user-confirmed') {
    const need = candidate.identityStatus === 'unknown' ? 'a confirmed species identity' : 'confirmation of the provisional species identity';
    return {
      ...base,
      verdict: 'insufficient-data',
      headline: HEADLINES['insufficient-data'],
      factors: [],
      missingInputs: [need],
    };
  }

  // FR-E03: the headline is always the long-term adult result.
  const adultFactors = runFactors(candidate, tank, cfg, 'adult');
  const verdict = aggregate(adultFactors, cfg);
  const missingInputs = collectMissing(adultFactors);

  const assessment: CompatibilityAssessment = {
    ...base,
    verdict,
    headline: HEADLINES[verdict],
    factors: adultFactors,
    missingInputs,
  };

  // FR-E03: a juvenile fit may be shown, but only as visibly secondary and
  // explicitly time-bounded. It is computed only when the fish is currently
  // meaningfully smaller than its adult size and the headline is not green.
  const adultCm = toCm(candidate.profile?.adultSize);
  const seenCm = toCm(candidate.observedSize);
  if (adultCm && seenCm && seenCm < adultCm * 0.8 && verdict !== 'suitable') {
    const juvenileFactors = runFactors(candidate, tank, cfg, 'observed');
    const juvenileVerdict = aggregate(juvenileFactors, cfg);
    if (SEVERITY[juvenileVerdict] < SEVERITY[verdict]) {
      assessment.temporaryJuvenileFit = {
        verdict: juvenileVerdict,
        note: `At its current ${formatLength(candidate.observedSize)} this fish would fit for now, but it grows to ${formatLength(candidate.profile!.adultSize)}. This is a temporary window, not a long-term answer.`,
      };
    }
  }

  return assessment;
}

/** Screen a candidate against every active aquarium (FR-E02). */
export function evaluateAllTanks(
  candidate: CandidateInput,
  tanks: TankInput[],
  options: EvaluateOptions = {},
): CompatibilityAssessment[] {
  return tanks
    .filter((t) => t.aquarium.status === 'active')
    .map((t) => evaluateCompatibility(candidate, t, options));
}

export { DEFAULT_RULES };
export type { CompatibilityRuleConfig };
