/**
 * The gate: turns a proposed care value into a shipped one, or into a review
 * item with the reason it failed.
 *
 * Kept separate from the runner so that every rejection path is reachable from
 * a unit test. A gate nobody has watched fail is not a gate, it is a hope.
 */
import {
  figureSupportedBy,
  inRange,
  isAggressionRating,
  quoteFound,
  rangeSupportedBy,
  temperamentSupportedBy,
  type AggressionRating,
} from './quote';

export type SourceKind = 'wikipedia' | 'vendor';

export interface SourceDoc {
  kind: SourceKind;
  text: string;
  url?: string;
  title?: string;
}

export interface Cited<T> {
  value: T;
  quote: string;
  source: SourceKind;
}

export interface TempRange {
  min: number;
  max: number;
  quote: string;
  source: SourceKind;
}

export interface CareProposal {
  species_id: string;
  adult_size_in?: Cited<number> | null;
  min_volume_gal?: Cited<number> | null;
  aggression?: Cited<string> | null;
  temp_c?: TempRange | null;
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
  corrected_scientific_name?: string;
}

/** A value that passed, with the evidence that got it through. */
export interface CareValue<T> {
  value: T;
  quote: string;
  source: SourceKind;
  sourceUrl?: string;
}

export interface AcceptedCare {
  speciesId: string;
  adultSizeIn?: CareValue<number>;
  minVolumeGal?: CareValue<number>;
  aggression?: CareValue<AggressionRating>;
  tempC?: CareValue<{ min: number; max: number }>;
}

export interface Rejection {
  field: string;
  reason: string;
  /** What was claimed, so the review file is readable without the proposal. */
  claimed?: unknown;
}

export interface VerifyResult {
  accepted: AcceptedCare;
  rejections: Rejection[];
  /** True when at least one field survived. */
  anyAccepted: boolean;
}

const MIN_QUOTE_CHARS = 12;

/**
 * Shared checks for any cited field: the citation names a source we actually
 * hold, and the sentence is really in it.
 *
 * Returns the document on success so the caller can attach its URL.
 */
function checkCitation(
  field: string,
  cited: { quote?: unknown; source?: unknown },
  docs: Partial<Record<SourceKind, SourceDoc>>,
  rejections: Rejection[],
): SourceDoc | undefined {
  const { quote, source } = cited;
  if (typeof quote !== 'string' || quote.trim().length < MIN_QUOTE_CHARS) {
    rejections.push({ field, reason: `quote missing or shorter than ${MIN_QUOTE_CHARS} characters` });
    return undefined;
  }
  if (source !== 'wikipedia' && source !== 'vendor') {
    rejections.push({ field, reason: `source must be "wikipedia" or "vendor", got ${JSON.stringify(source)}` });
    return undefined;
  }
  const doc = docs[source];
  if (!doc) {
    rejections.push({ field, reason: `cited ${source} but no ${source} text was cached for this species` });
    return undefined;
  }
  if (!quoteFound(quote, doc.text)) {
    rejections.push({ field, reason: `quote not found in the cached ${source} text`, claimed: quote });
    return undefined;
  }
  return doc;
}

function verifyNumber(
  field: 'adult_size_in' | 'min_volume_gal',
  cited: Cited<number>,
  kind: 'length-in' | 'volume-gal',
  docs: Partial<Record<SourceKind, SourceDoc>>,
  rejections: Rejection[],
): CareValue<number> | undefined {
  const doc = checkCitation(field, cited, docs, rejections);
  if (!doc) return undefined;

  const value = cited.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    rejections.push({ field, reason: 'value is not a finite number', claimed: value });
    return undefined;
  }
  if (!inRange(field, value)) {
    rejections.push({ field, reason: 'value outside the plausible range (likely a unit error)', claimed: value });
    return undefined;
  }
  if (!figureSupportedBy(value, kind, cited.quote)) {
    // The mis-citation case: a real sentence with a number bolted on.
    rejections.push({
      field,
      reason: 'the quote does not contain a figure that yields this value',
      claimed: `${value} from "${cited.quote}"`,
    });
    return undefined;
  }
  return { value, quote: cited.quote, source: cited.source, ...(doc.url ? { sourceUrl: doc.url } : {}) };
}

export function verifyProposal(
  p: CareProposal,
  docs: Partial<Record<SourceKind, SourceDoc>>,
): VerifyResult {
  const rejections: Rejection[] = [];
  const accepted: AcceptedCare = { speciesId: p.species_id };

  if (p.adult_size_in) {
    const v = verifyNumber('adult_size_in', p.adult_size_in, 'length-in', docs, rejections);
    if (v) accepted.adultSizeIn = v;
  }
  if (p.min_volume_gal) {
    const v = verifyNumber('min_volume_gal', p.min_volume_gal, 'volume-gal', docs, rejections);
    if (v) accepted.minVolumeGal = v;
  }

  if (p.aggression) {
    const field = 'aggression';
    const doc = checkCitation(field, p.aggression, docs, rejections);
    if (doc) {
      const value = p.aggression.value;
      if (!isAggressionRating(value)) {
        rejections.push({ field, reason: 'not one of the four AggressionRating values', claimed: value });
      } else if (!temperamentSupportedBy(value, p.aggression.quote)) {
        rejections.push({
          field,
          reason: 'the quote uses no word supporting this temperament',
          claimed: `${value} from "${p.aggression.quote}"`,
        });
      } else {
        accepted.aggression = {
          value,
          quote: p.aggression.quote,
          source: p.aggression.source,
          ...(doc.url ? { sourceUrl: doc.url } : {}),
        };
      }
    }
  }

  if (p.temp_c) {
    const field = 'temp_c';
    const doc = checkCitation(field, p.temp_c, docs, rejections);
    if (doc) {
      const { min, max } = p.temp_c;
      if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) {
        rejections.push({ field, reason: 'min or max is not a finite number', claimed: `${min}-${max}` });
      } else if (!inRange('temp_c', min) || !inRange('temp_c', max)) {
        rejections.push({ field, reason: 'outside 4-40 °C (likely fahrenheit left unconverted)', claimed: `${min}-${max}` });
      } else if (min > max) {
        rejections.push({ field, reason: 'min is greater than max', claimed: `${min}-${max}` });
      } else if (!rangeSupportedBy(min, max, p.temp_c.quote)) {
        rejections.push({
          field,
          reason: 'the quote does not state this range',
          claimed: `${min}-${max} from "${p.temp_c.quote}"`,
        });
      } else {
        accepted.tempC = {
          value: { min, max },
          quote: p.temp_c.quote,
          source: p.temp_c.source,
          ...(doc.url ? { sourceUrl: doc.url } : {}),
        };
      }
    }
  }

  const anyAccepted = Boolean(
    accepted.adultSizeIn || accepted.minVolumeGal || accepted.aggression || accepted.tempC,
  );
  return { accepted, rejections, anyAccepted };
}
