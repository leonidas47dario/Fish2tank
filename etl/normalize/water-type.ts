/**
 * Fresh, brackish or salt - taken from what the vendors say, never from the fish.
 *
 * WHY THIS IS NOT A LOOKUP. There is no care-database licence yet (PRD 12.1),
 * and inferring salinity from taxonomy is the same trap the aggression rating
 * avoids: Gobiidae holds the bumblebee goby and a hundred reef gobies, so a
 * family-level answer would be an invented fact. What IS available is that the
 * vendors sort their own shops by it, because a customer with a reef tank and
 * a customer with a planted tank are different customers.
 *
 * Two sources, in this order:
 *
 *   1. THE LISTING'S OWN TAGS. LiveAquaria tags "Marine Fish" (841 products),
 *      "Freshwater Fish" (539) and "Corals" (419); Aquatic Arts tags
 *      "Freshwater Fish"/"Freshwater Plants"/"Freshwater Shrimp"; Predatory
 *      Fins tags "Freshwater Fish" and, on four products, "Marine / Saltwater
 *      Fish". This is per-product and precise, so it always wins.
 *
 *   2. THE VENDOR'S DECLARATION, for shops that sell one kind only. Nine of
 *      the twelve are freshwater specialists and tag nothing, so without this
 *      their catalogues would read as unknown.
 *
 * LiveAquaria deliberately declares no vendor default any more. It used to
 * declare 'marine' on the grounds of being "overwhelmingly marine", and that
 * was measurably wrong: 1,147 of its livestock listings are tagged freshwater,
 * and the blanket declaration was filing roughly 180 freshwater species under
 * saltwater. Its tags are good, so its tags are what it gets.
 */

import type { WaterType } from '@/domain/types';

export type { WaterType };

/**
 * Brackish is checked FIRST because it is the specific claim. A vendor tagging
 * a fish "Brackish" has said something more precise than the "Freshwater Fish"
 * section it also sits in, and collapsing that into freshwater would lose the
 * one bit of information the tag was added to carry.
 */
const BRACKISH = /\bbrackish\b/i;
/**
 * "Reef safe" is a marine-only claim - it describes whether a fish will eat
 * your corals. "Coral" alone is not enough on its own line ("Coral Blue Platy"
 * is a colour, "Crushed Coral" is substrate), so it must appear as a whole
 * word in a tag that is not doing something else; the platy is caught by
 * freshwater tags on the same listing winning at species level anyway.
 */
const MARINE = /\b(marine|salt\s?water|reef\s?safe|corals)\b/i;
/** Pond stock is freshwater; the vendors file it separately but not elsewhere. */
const FRESHWATER = /\bfresh\s?water\b|\bpond\b/i;

/**
 * What one listing says about its own salinity, or undefined if it says
 * nothing. Undefined is never a guess - it is the absence of a claim.
 */
export function waterTypeFromListing(
  tags: readonly string[] | undefined,
  productType?: string,
): WaterType | undefined {
  const fields = [...(tags ?? []), productType ?? ''];
  if (fields.some((f) => BRACKISH.test(f))) return 'brackish';
  if (fields.some((f) => MARINE.test(f))) return 'marine';
  if (fields.some((f) => FRESHWATER.test(f))) return 'freshwater';
  return undefined;
}

/**
 * Collapse everything the vendors said about one species into one answer.
 *
 * FRESHWATER WINS, and that is a decision about who is asking. The twelve
 * species with conflicting tags are all genuinely euryhaline - Amano shrimp,
 * archerfish, bumblebee goby, sailfin molly, an amphidromous Sicyopus goby -
 * animals that live in both and are sold into both. Someone filtering to
 * freshwater wants to be shown a molly.
 *
 * Brackish then outranks marine for the same reason: it is the closer of the
 * two to a tank the owner could actually run.
 *
 * Returns undefined when no listing made any claim, which the catalog renders
 * as "not recorded" and excludes from every specific filter rather than
 * defaulting into one - the same rule the water-column zone follows.
 */
export function resolveSpeciesWaterType(
  claims: Iterable<WaterType | undefined>,
): WaterType | undefined {
  const seen = new Set<WaterType>();
  for (const c of claims) if (c) seen.add(c);
  if (seen.has('freshwater')) return 'freshwater';
  if (seen.has('brackish')) return 'brackish';
  if (seen.has('marine')) return 'marine';
  return undefined;
}

/**
 * Species id -> water type, over every listing in the dataset.
 *
 * Deliberately computed for CURATED and discovered species alike. An earlier
 * pass tagged only the discovered half and hard-coded the curated 47 to null,
 * which meant the fish actually in the owner's tanks were the ones the filter
 * could say least about.
 */
export function waterTypeBySpecies(
  listings: ReadonlyArray<{
    speciesId?: string;
    storeId: string;
    tags?: readonly string[];
    productType?: string;
  }>,
  /** storeId -> the water type that vendor sells, for shops that sell one kind. */
  vendorDefaults: ReadonlyMap<string, WaterType>,
): Map<string, WaterType> {
  const claims = new Map<string, Set<WaterType>>();

  for (const l of listings) {
    if (!l.speciesId) continue;
    const claim = waterTypeFromListing(l.tags, l.productType) ?? vendorDefaults.get(l.storeId);
    if (!claim) continue;
    const bucket = claims.get(l.speciesId) ?? new Set<WaterType>();
    bucket.add(claim);
    claims.set(l.speciesId, bucket);
  }

  const out = new Map<string, WaterType>();
  for (const [speciesId, set] of claims) {
    const resolved = resolveSpeciesWaterType(set);
    if (resolved) out.set(speciesId, resolved);
  }
  return out;
}
