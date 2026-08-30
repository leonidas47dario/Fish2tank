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
  | 'not-a-binomial'
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

/**
 * Words that appear inside parentheses in a vendor title but are not taxonomy.
 *
 * THE FAILURE THIS EXISTS FOR. The matcher reads parenthesised text in a
 * listing title as a scientific name, which is right far more often than it is
 * wrong: "Jaguar Cichlid (Parachromis managuensis)" is the house style across
 * every vendor. But J4 Flowerhorns published
 *
 *     Red Wolf Fish ( Roofvissen fotografie ) 4"
 *
 * where the parens hold a PHOTO CREDIT - Dutch for "predatory fish
 * photography". It passes every structural test for a binomial: two words,
 * capitalised genus, lowercase epithet, Latin alphabet. So shape cannot catch
 * it and vocabulary has to.
 *
 * WHAT THIS CAN AND CANNOT DO, stated plainly so nobody trusts it too far.
 * Like TRADE_JUNK, every entry here was observed in the generated catalog
 * rather than imagined, and a list of observed words cannot anticipate the
 * next language a vendor credits a photographer in. It is a net for known
 * failures, not a proof of taxonomic validity.
 *
 * The stronger check - "is this genus real?" - is not available. taxonomy.ts
 * has GENUS_FAMILY, but it covers 547 genera against a catalog that now holds
 * 945 species whose genus is absent from it, nearly all of them legitimate
 * marine fish from LiveAquaria. Absence would reject 43% of the catalog.
 */
/**
 * Open-nomenclature qualifiers, which stand where an epithet would.
 *
 * "Geophagus sp." is a complete and correct way to name an undescribed
 * species, not a truncation. Vendors use it because the fish genuinely has no
 * epithet yet.
 */
export const OPEN_NOMENCLATURE: ReadonlySet<string> = new Set(['sp.', 'spp.', 'cf.', 'aff.']);

export const NON_TAXONOMIC: readonly string[] = [
  // Photography credits, which is how the two known phantoms arrived.
  'fotografie', 'fotografia', 'photography', 'photographie', 'photo', 'photos',
  'image', 'images', 'picture', 'pictures',
  // Not an animal at all.
  'food', 'pellets', 'flakes', 'wafers', 'sticks',
];

/** The minimal shape these rules need. Both the mart and the ETL satisfy it. */
export interface NameCheckable {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  /**
   * A name a person chose and a second person approved, rather than one
   * derived from a vendor listing title. See CURATED_EXEMPT below.
   */
  curated?: boolean;
}

/**
 * The one rule a curated name is exempt from, and why only this one.
 *
 * `has-digit` exists because vendor titles produce "2 inch", "6 Pack" and
 * stock codes, and a derivation cannot tell those from a name. That reasoning
 * does not reach a name a keeper typed and a reviewer approved - and it is
 * wrong for the exact fish this catalog is most likely to be missing, because
 * L-numbers (L083, L046) are the standing designation for the many undescribed
 * Loricariids that have no binomial at all. Refusing every digit would refuse
 * the whole class.
 *
 * Nothing else is waived. "Tank Bred" is still not a species name however it
 * got here, a two-letter fragment is still a fragment, and an entry with no
 * binomial and no usable common name is still unidentifiable. Those rules
 * catch what a human reviewer plausibly misses; this one catches what only a
 * parser does.
 */
const CURATED_EXEMPT: ReadonlySet<ProblemCode> = new Set<ProblemCode>(['has-digit']);

/**
 * Is this string usable as a species display name, ignoring the rest of the
 * catalog? Used by the ETL to reject a derived candidate at the point it is
 * minted, before it ever reaches the warehouse.
 */
export function isUsableName(name: string): boolean {
  return nameProblems(name).length === 0;
}

/**
 * Is this string plausibly a scientific name?
 *
 * Used by the ETL to reject a parenthesised candidate before it mints a
 * species from it. Checks the two things that are checkable without a
 * taxonomic authority: the shape of a binomial, and whether it contains
 * vocabulary that is definitely not taxonomy. See NON_TAXONOMIC on why this is
 * a net rather than a proof.
 */
/**
 * Can anybody tell what this species is?
 *
 * A binomial is enough on its own; so is a usable common name. Having neither
 * is the `no-identity` problem. This is the single answer to that question -
 * findProblems and the shipped-catalog test both call it, because two places
 * re-deriving it is exactly how a rule and its test drift apart.
 */
export function isIdentifiable(e: NameCheckable): boolean {
  if (e.scientificName) return true;
  return nameProblems(e.commonName)
    .filter((p) => !(e.curated && CURATED_EXEMPT.has(p.code)))
    .length === 0;
}

export function isUsableBinomial(name: string): boolean {
  return binomialProblems(name).length === 0;
}

/** The context-free problems with a candidate scientific name. */
function binomialProblems(name: string): Array<{ code: ProblemCode; detail: string }> {
  const out: Array<{ code: ProblemCode; detail: string }> = [];
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);

  // Binomial or trinomial. A subspecies is legitimate ("Melanotaenia
  // splendida inornata"); four words is a sentence.
  if (words.length < 2 || words.length > 3) {
    out.push({
      code: 'not-a-binomial',
      detail: `${words.length} word${words.length === 1 ? '' : 's'}, expected two or three`,
    });
    return out;
  }

  // Genus capitalised, epithets lower case. This is not a style preference;
  // it is the botanical and zoological codes, and vendors who write a real
  // binomial follow it because they copied it from somewhere that did.
  if (!/^[A-Z][a-z]+$/.test(words[0]!)) {
    out.push({ code: 'not-a-binomial', detail: `"${words[0]}" is not a genus-shaped word` });
  }
  for (const epithet of words.slice(1)) {
    // OPEN NOMENCLATURE IS VALID TAXONOMY, not a defect. "Geophagus sp." means
    // an undescribed or unidentified species of that genus, "cf." means
    // "compare with", "aff." means "has affinity to". The catalog holds two
    // legitimate examples (Geophagus sp., Heros sp.) and the first draft of
    // this rule rejected both, which would have deleted two real fish while
    // hunting two phantoms.
    if (OPEN_NOMENCLATURE.has(epithet)) continue;
    if (!/^[a-z-]+$/.test(epithet)) {
      out.push({ code: 'not-a-binomial', detail: `"${epithet}" is not an epithet-shaped word` });
    }
  }

  const low = trimmed.toLowerCase();
  const bad = NON_TAXONOMIC.find((w) => new RegExp(`(^|[^a-z])${w}($|[^a-z])`, 'i').test(low));
  if (bad) {
    out.push({ code: 'not-a-binomial', detail: `contains non-taxonomic word "${bad}"` });
  }

  return out;
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
      if (e.curated && CURATED_EXEMPT.has(p.code)) continue;
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

    // A scientific name that is not one is worse than none: it looks like
    // authority. It also mints a phantom species, because the binomial is
    // what the id is derived from.
    if (e.scientificName) {
      for (const p of binomialProblems(e.scientificName)) {
        problems.push({ speciesId: e.speciesId, value: e.scientificName, ...p });
      }
    }

    // A species with no binomial AND no real common name cannot be identified
    // by anyone. The binomial fallback is acceptable; having neither is not.
    // Read through the same exemption, or a curated L-number would be waved
    // past has-digit only to be failed here for the identical reason.
    if (!isIdentifiable(e)) {
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
