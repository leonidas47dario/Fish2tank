/**
 * What "a clean catalog" means, as executable rules.
 *
 * WHY THIS EXISTS. The species dimension is derived from vendor listing titles
 * (see etl/normalize/derive-species.ts), and a vendor title is marketing copy,
 * not a taxonomy. Left unchecked the derivation minted 283 of 1,080 species
 * with names like "- Tank Bred", "BredBy Aquatic Arts" and "-Pack Of Fish" -
 * 26% of the library. Fourteen distinct species were all called "- tank bred".
 *
 * So "clean" has to be a thing a machine checks on every build, not a thing
 * somebody eyeballs after a refresh. These rules are the definition, and
 * catalog-quality.test.ts is the gate that fails the build when they are
 * broken. Both the ETL and the audit tooling read the same rules from here, so
 * there is exactly one answer to "is this name acceptable?".
 *
 * The rules are deliberately mechanical. They catch a name that is obviously
 * not a species; they cannot tell you that "Blue Acara" is the right name for
 * Andinoacara pulcher. That judgement is what the curated overrides in
 * species-overrides.ts carry, each with a source.
 */

/** A single reason a catalog entry is not fit to ship. */
export type ProblemCode =
  | 'trade-junk'
  | 'fragment'
  | 'has-digit'
  | 'ambiguous-generic'
  | 'no-identity'
  | 'too-short'
  | 'unsourced-override';

export interface Problem {
  speciesId: string;
  code: ProblemCode;
  /** The offending value, so a failure message can name it. */
  value: string;
  detail: string;
}

/**
 * Husbandry, packaging and vendor vocabulary that can never be a species name.
 *
 * Every entry here was observed in the generated catalog, not imagined. They
 * fall into four groups: how the fish was raised ("tank bred"), how it is sold
 * ("bunch w lead", "-pack of fish"), who sold it ("aquatic arts"), and units
 * ("tbsp", "inch").
 */
export const TRADE_JUNK: readonly string[] = [
  // Raised / sourced
  'tank bred', 'tank-bred', 'tankbred', 'locally bred', 'locally-bred',
  'bred by', 'bredby', 'captive bred', 'captive-bred', 'wild caught', 'wild-caught',
  'aquacultured', 'imported',
  // Packaging and quantity
  'bare root', 'w lead', 'with lead', 'bunch', 'pack of', '-pack', 'per pack',
  'tbsp', 'portion', 'pcs', 'qty', 'lot of', 'each', 'per ', 'sold as',
  // Commerce
  'sale', 'free ship', 'wysiwyg', 'clearance', 'special order', 'pre order',
  'pre-order', 'in stock', 'out of stock',
  // Vendor names
  'aquatic arts', 'aquarium co-op', 'aquarium coop', 'imperial tropicals',
  'predatory fins', 'flip aquatics', 'aquahuna', 'global exoticquatics',
  'j4 flowerhorns', 'nu aqua', 'liveaquaria',
];

/**
 * Names too generic to identify a fish.
 *
 * These are real English words for a whole family or trade group. One of them
 * as a species name means the derivation gave up: six different species were
 * called "Catfish". They are only a problem when SHARED - "Discus" is a fine
 * name if exactly one species carries it, which is why the check needs the
 * whole catalog and not one entry at a time.
 */
export const GENERIC_NAMES: ReadonlySet<string> = new Set([
  'catfish', 'cichlid', 'pleco', 'plec', 'stingray', 'ray', 'goby', 'tetra',
  'discus', 'crayfish', 'gourami', 'barb', 'rasbora', 'shrimp', 'snail',
  'plant', 'fish', 'loach', 'danio', 'guppy', 'killifish', 'angelfish',
  'oscar', 'betta', 'koi', 'crab', 'frog', 'eel', 'shark', 'cory',
  'corydoras', 'moss', 'sword', 'anubias', 'java fern', 'livebearer',
  'rainbowfish', 'puffer', 'knifefish', 'arowana', 'datnoid', 'halfbeak',
  'ricefish', 'platy', 'molly', 'swordtail', 'lobster', 'shellfish',
]);

/** The minimal shape these rules need. Both the mart and the ETL satisfy it. */
export interface NameCheckable {
  speciesId: string;
  commonName: string;
  scientificName?: string;
}

/**
 * Is this string usable as a species display name, ignoring the rest of the
 * catalog? Used by the ETL to reject a derived candidate at the point it is
 * minted, before it ever reaches the warehouse.
 */
export function isUsableName(name: string): boolean {
  return nameProblems(name).length === 0;
}

/** The context-free problems with a single name. */
function nameProblems(name: string): Array<{ code: ProblemCode; detail: string }> {
  const out: Array<{ code: ProblemCode; detail: string }> = [];
  const trimmed = name.trim();
  const low = trimmed.toLowerCase();

  if (trimmed.length < 3) {
    out.push({ code: 'too-short', detail: 'shorter than three characters' });
  }

  // A leading or trailing dash is the signature of the suffix derivation
  // having sliced a title mid-clause: "Guppy - Tank Bred" losing its head.
  if (trimmed.startsWith('-') || trimmed.endsWith('-') || name !== trimmed) {
    out.push({ code: 'fragment', detail: 'leading/trailing dash or whitespace' });
  }

  // Word-boundary, not substring. Matching raw substrings flagged "Gulper
  // Catfish" for containing "per " - a real species rejected by a typo in the
  // rule. A junk phrase only counts when it stands as whole words.
  const junk = TRADE_JUNK.find((j) => {
    const escaped = j.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+');
    return new RegExp(`(^|[^a-z])${escaped}($|[^a-z])`, 'i').test(low);
  });
  if (junk) {
    out.push({ code: 'trade-junk', detail: `contains trade vocabulary "${junk.trim()}"` });
  }

  // No species name contains a numeral. Sizes ("2 inch"), counts ("6 pack")
  // and stock codes are all this rule firing correctly.
  if (/\d/.test(trimmed)) {
    out.push({ code: 'has-digit', detail: 'contains a digit' });
  }

  return out;
}

/**
 * Every problem in a catalog, checked as a whole.
 *
 * Whole-catalog rather than per-entry because the most damaging rule needs the
 * others for context: a bare generic name is only wrong when several species
 * share it. Returns an empty array for a clean catalog, which is exactly what
 * the build gate asserts.
 */
export function findProblems(entries: readonly NameCheckable[]): Problem[] {
  const problems: Problem[] = [];

  // Which bare generics are contested? Built first, so the per-entry pass can
  // tell "Discus" (fine, unique) from "Catfish" (six species, meaningless).
  const genericUse = new Map<string, string[]>();
  for (const e of entries) {
    const low = e.commonName.trim().toLowerCase();
    if (!GENERIC_NAMES.has(low)) continue;
    genericUse.set(low, [...(genericUse.get(low) ?? []), e.speciesId]);
  }

  for (const e of entries) {
    for (const p of nameProblems(e.commonName)) {
      problems.push({ speciesId: e.speciesId, value: e.commonName, ...p });
    }

    const low = e.commonName.trim().toLowerCase();
    const sharers = genericUse.get(low);
    if (sharers && sharers.length > 1) {
      problems.push({
        speciesId: e.speciesId,
        code: 'ambiguous-generic',
        value: e.commonName,
        detail: `"${e.commonName}" is shared by ${sharers.length} species`,
      });
    }

    // A species with no binomial AND no real common name cannot be identified
    // by anyone. The binomial fallback is acceptable; having neither is not.
    if (!e.scientificName && nameProblems(e.commonName).length > 0) {
      problems.push({
        speciesId: e.speciesId,
        code: 'no-identity',
        value: e.commonName,
        detail: 'no scientific name and no usable common name',
      });
    }
  }

  return problems;
}

/** Group problems by code, for a readable failure message and for reporting. */
export function summarise(problems: readonly Problem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of problems) out[p.code] = (out[p.code] ?? 0) + 1;
  return out;
}
