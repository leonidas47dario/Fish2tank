/**
 * Propose species-synonym merges, with evidence, and refuse to guess.
 *
 *   npm run synonyms:propose
 *
 * THE PROBLEM (BUG-02). The species dimension is minted from binomials vendors
 * write in their own titles, and vendors do not agree on taxonomy. So the same
 * fish arrives twice under two names - `Danio rerio` and `Brachydanio rerio`,
 * `Puntius tetrazona` and `Puntigrus tetrazona` - and each copy gets its own
 * half of the listings. Every number derived from those listings, the median
 * price and the market-scarcity band, is then computed on roughly half the
 * evidence that exists. 23 groups, 47 species, every one of them with listings
 * on both sides.
 *
 * WHY THIS IS A PROPOSAL TOOL AND NOT A MERGE. Two species sharing a portrait
 * is a HINT, not proof. `Hymenochirus boettgeri` and `Hymenochirus curtipes`
 * share one because they are two dwarf frogs that look alike, and merging them
 * would destroy a real distinction. So the shared portrait only nominates a
 * group; something else has to decide.
 *
 * WHAT DECIDES. Wikipedia's own redirect graph, which is an assertion by a
 * source rather than an inference by this script. If "Brachydanio rerio"
 * redirects to "Danio rerio", Wikipedia is saying both that they are one taxon
 * AND which name is current - the two things a merge needs. wikipedia-text.ts
 * has always returned this as `WikiPage.redirected`, with a comment noting it
 * is "a hint that our own binomial is a misspelling or a superseded
 * combination, which is worth recording even though this spec does not act on
 * it." This is the tool that acts on it.
 *
 * The weaker fallback is a synonyms field in the taxobox naming the other
 * binomial. That is still the article asserting synonymy, just less
 * machine-certain about direction, so it proposes and does not auto-merge.
 *
 * Anything neither test resolves is emitted as `review` and merged by nobody.
 * That is the point: the output of this tool is an argument, and a human puts
 * the surviving entries into SPECIES_SYNONYMS with the source attached.
 *
 * WHAT IT DOES NOT DO. It does not write species-overrides.ts. Ingest stays
 * manual, the same shape care:plan/care:ingest uses, because a bad merge is
 * silent and permanent-looking: two fish become one and nothing in the app
 * says a species went missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchWikitextBatch, MAX_TITLES_PER_REQUEST, type WikiPage } from './sources/wikipedia-text';

const CATALOG = 'src/data/seed/marts/catalog.json';
const INDEX = 'src/data/seed/marts/market-index.json';
const OUT_DIR = 'data/synonyms';
const OUT = `${OUT_DIR}/proposals.jsonl`;

interface CatalogRow {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  portrait?: { url: string };
}

/** How a group's names differ, which is most of what tells a merge from a mistake. */
type Pattern =
  /** Same epithet, different genus: a genus reassignment. Nearly always one fish. */
  | 'genus-reassignment'
  /** Same genus, epithets differing only in gender ending: one fish, two agreements. */
  | 'gender-ending'
  /** "Carassius auratus auratus" against "Carassius auratus": a subspecies and its species. */
  | 'trinomial'
  /** Same genus, genuinely different epithets. Usually two fish that look alike. */
  | 'same-genus'
  | 'other';

const words = (n?: string) => (n ?? '').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Whether two epithets differ only in their Latin gender ending.
 *
 * `multipunctatus`/`multipunctata` and `margaritacea`/`margaritaceus` are the
 * same word agreeing with a masculine or feminine genus. This is a real and
 * very common source of duplicate rows, and it is safe to detect
 * mechanically because the stem has to match exactly.
 */
function genderVariant(a: string, b: string): boolean {
  const ENDINGS = ['us', 'a', 'um', 'is', 'e', 'i'];
  for (const x of ENDINGS) {
    for (const y of ENDINGS) {
      if (x === y) continue;
      if (a.endsWith(x) && b.endsWith(y)) {
        const stemA = a.slice(0, -x.length);
        const stemB = b.slice(0, -y.length);
        if (stemA.length >= 4 && stemA === stemB) return true;
      }
    }
  }
  return false;
}

function classify(names: string[]): Pattern {
  const parts = names.map(words);
  const genera = new Set(parts.map((p) => p[0]));
  const epithets = new Set(parts.map((p) => p[1]));

  if (parts.some((p) => p.length === 3) && parts.some((p) => p.length === 2)) {
    const stems = new Set(parts.map((p) => `${p[0]} ${p[1]}`));
    if (stems.size === 1) return 'trinomial';
  }
  if (epithets.size === 1 && genera.size > 1) return 'genus-reassignment';
  if (epithets.size > 1) {
    const eps = [...epithets].filter(Boolean) as string[];
    const allGender = eps.every((e) => eps.some((o) => o !== e && genderVariant(e, o)));
    if (allGender) return 'gender-ending';
    if (genera.size === 1) return 'same-genus';
  }
  return 'other';
}

interface Proposal {
  pattern: Pattern;
  members: Array<{ speciesId: string; scientificName?: string; commonName: string; listings: number; curated: boolean }>;
  /** The id everything else should fold onto, when the evidence names one. */
  canonicalId?: string;
  /** Why, in one line, quoting what the evidence actually said. */
  evidence: string;
  source?: string;
  verdict: 'merge' | 'review';
}

/**
 * The accepted binomial an article declares for itself, from its taxobox.
 *
 * THIS IS WHAT DECIDES DIRECTION, and the first draft of this tool got it
 * wrong by not having it. Most of these fish have articles titled with a
 * common name - "Zebrafish", "Goldfish", "Bala shark" - so asking "which group
 * member does the redirect point at?" fails, because it points at a name that
 * is not a binomial at all. The first draft then fell back on a substring
 * search for one binomial inside the other's synonyms block, which knows that
 * two names are related but nothing about which one is current. It duly
 * proposed folding `Balantiocheilos melanopterus` (correct spelling, 8
 * listings) into `Balantiocheilus` (a typo, 3), and `Carassius auratus` (86)
 * into its own subspecies (2).
 *
 * The taxobox states the accepted name outright. `|binomial = Danio rerio`, or
 * `|taxon = ...` in the newer speciesbox. Reading that is asking the source,
 * which is the whole point of a verification step.
 */
function taxoboxBinomial(wikitext: string): string | undefined {
  // `'*` and not `''*`: the latter demands at least one apostrophe, and the
  // field is usually plain (`| taxon = Danio rerio`). That single character
  // made this return undefined for every article on the first run.
  const direct = wikitext.match(/\|\s*(?:binomial|taxon)\s*=\s*'*([A-Z][a-z]+(?:\s+[a-z-]+){1,2})'*/);
  if (direct?.[1]) return direct[1].replace(/\s+/g, ' ').trim();

  // Older Speciesboxes split it across two fields instead of one `taxon`.
  const genus = wikitext.match(/\|\s*genus\s*=\s*'*([A-Z][a-z]+)'*/)?.[1];
  const species = wikitext.match(/\|\s*species\s*=\s*'*([a-z-]+)'*/)?.[1];
  return genus && species ? `${genus} ${species}` : undefined;
}

async function main() {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as { species: CatalogRow[] };
  const index = JSON.parse(readFileSync(INDEX, 'utf8')) as {
    species: Record<string, { totalListings?: number }>;
  };
  const curated = new Set(
    [...readFileSync('src/data/seed/species-catalog.ts', 'utf8').matchAll(/entry\(\s*'([^']+)'/g)]
      .map((m) => m[1] as string),
  );
  const listings = (id: string) => index.species[id]?.totalListings ?? 0;

  // Nominate: species that share a bundled portrait are very likely one fish.
  const byPortrait = new Map<string, CatalogRow[]>();
  for (const s of catalog.species) {
    const url = s.portrait?.url;
    if (!url) continue;
    const bucket = byPortrait.get(url) ?? [];
    bucket.push(s);
    byPortrait.set(url, bucket);
  }
  const groups = [...byPortrait.values()].filter((g) => g.length > 1);
  console.log(`  ${groups.length} candidate groups nominated by a shared portrait`);

  // Verify: ask Wikipedia about every binomial involved, in batches.
  const titles = [...new Set(groups.flatMap((g) => g.map((s) => s.scientificName).filter(Boolean)))] as string[];
  const pages = new Map<string, WikiPage>();
  for (let i = 0; i < titles.length; i += MAX_TITLES_PER_REQUEST) {
    const batch = titles.slice(i, i + MAX_TITLES_PER_REQUEST);
    console.log(`  wikipedia: batch ${i / MAX_TITLES_PER_REQUEST + 1}, ${batch.length} titles`);
    for (const page of await fetchWikitextBatch(batch)) pages.set(page.requested, page);
  }

  const proposals: Proposal[] = [];
  for (const g of groups) {
    const members = g.map((s) => ({
      speciesId: s.speciesId,
      scientificName: s.scientificName,
      commonName: s.commonName,
      listings: listings(s.speciesId),
      curated: curated.has(s.speciesId),
    }));
    const names = members.map((m) => m.scientificName).filter(Boolean) as string[];
    const pattern = classify(names);
    const idFor = (binomial: string) =>
      members.find((m) => m.scientificName?.toLowerCase() === binomial.toLowerCase())?.speciesId;

    /**
     * ONE TEST, and it is the source speaking rather than this script guessing.
     *
     * Every member binomial is looked up. If they all land on the SAME article
     * after redirects, Wikipedia is asserting they are one taxon - that is the
     * synonymy. That article's taxobox then names the accepted binomial, which
     * is the direction. Both facts come from the same place, and either one
     * missing means no merge.
     *
     * Members landing on DIFFERENT articles is the answer "these are two
     * fish", and it is the answer that matters most: it is what keeps
     * Hymenochirus boettgeri and H. curtipes apart, two dwarf frogs that share
     * a photograph because they look alike.
     */
    let canonicalId: string | undefined;
    let evidence = '';
    let source: string | undefined;

    const resolved = new Set(
      members.map((m) => (m.scientificName ? pages.get(m.scientificName)?.resolved : undefined))
        .filter(Boolean) as string[],
    );
    const haveAllPages = members.every((m) => m.scientificName && pages.get(m.scientificName)?.wikitext);

    if (resolved.size === 1 && haveAllPages) {
      const article = [...resolved][0]!;
      const wikitext = pages.get(members.find((m) => m.scientificName)!.scientificName!)!.wikitext!;
      const accepted = taxoboxBinomial(wikitext);
      const target = accepted ? idFor(accepted) : undefined;
      source = `https://en.wikipedia.org/wiki/${article.replace(/ /g, '_')}`;
      if (target) {
        canonicalId = target;
        evidence = `All ${members.length} names resolve to "${article}", whose taxobox gives the accepted binomial as "${accepted}".`;
      } else if (accepted) {
        evidence = `All names resolve to "${article}", but its accepted binomial "${accepted}" is not one of these rows - merging would need a new id.`;
      } else {
        evidence = `All names resolve to "${article}", but no accepted binomial could be read from its taxobox.`;
      }
    } else if (resolved.size > 1) {
      evidence = `Separate articles (${[...resolved].join(', ')}), so Wikipedia treats these as different taxa.`;
    } else {
      evidence = 'No article could be fetched for these names.';
    }

    /**
     * A curated id outranks a derived one for the SAME accepted taxon.
     *
     * Not a taxonomic judgement - the evidence above already settled which fish
     * this is. It is about not breaking stored records: the curated 47 carry
     * readable ids (`sp_panda_cory`) that specimens and holdings already point
     * at, so folding the curated row into a derived one would strand real data
     * for no gain.
     */
    if (canonicalId) {
      const curatedMember = members.find((m) => m.curated);
      if (curatedMember && curatedMember.speciesId !== canonicalId) {
        evidence += ` Canonical id is the curated ${curatedMember.speciesId}, which stored records already reference.`;
        canonicalId = curatedMember.speciesId;
      }
    }

    proposals.push({
      pattern,
      members,
      canonicalId,
      evidence: evidence || 'No redirect and no synonyms entry connects these names.',
      source,
      verdict: canonicalId ? 'merge' : 'review',
    });
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, proposals.map((p) => JSON.stringify(p)).join('\n') + '\n');

  const merge = proposals.filter((p) => p.verdict === 'merge');
  const review = proposals.filter((p) => p.verdict === 'review');
  const pooled = merge.reduce(
    (n, p) => n + p.members.filter((m) => m.speciesId !== p.canonicalId).reduce((a, m) => a + m.listings, 0),
    0,
  );

  console.log(`\n  ${merge.length} groups have evidence and propose a merge`);
  console.log(`  ${review.length} groups do not, and are left alone`);
  console.log(`  ${pooled} listings would move onto a canonical id\n`);
  for (const p of proposals) {
    const tag = p.verdict === 'merge' ? '  MERGE ' : '  review';
    console.log(`${tag} [${p.pattern}] ${p.members.map((m) => `${m.scientificName} (${m.listings})`).join('  |  ')}`);
    console.log(`          -> ${p.canonicalId ?? 'no canonical'} : ${p.evidence}`);
  }
  console.log(`\n  wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
