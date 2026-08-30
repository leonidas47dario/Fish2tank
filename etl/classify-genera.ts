/**
 * Work out what kind of animal a genus is, by walking Wikipedia's taxonomy.
 *
 *   npm run genera:classify
 *
 * THE PROBLEM (BUG-03). `traitsFor()` maps genus -> family -> traits, and
 * GENUS_FAMILY covers 547 genera. The catalog now holds 437 more that it has
 * never heard of, so 954 of 2,155 species carry no `organismKind` and the
 * catalog's kind facet cannot filter what it cannot classify. Measured: 854 of
 * those 954 are marine, reef stock that arrived with a saltwater vendor long
 * after the taxonomy table was compiled by hand against a freshwater catalog.
 *
 * WHY THIS CAN BE AUTOMATED WHEN THE ORIGINAL COULD NOT. taxonomy.ts says
 * FishBase and Wikidata were unreachable and that Wikipedia's PROSE does not
 * state what it needed. Both still true. But Wikipedia also publishes its
 * taxonomic hierarchy as machine-readable templates - `Template:Taxonomy/
 * Chaetodon` is literally `|rank=genus |parent=Chaetodontidae` - and walking
 * that chain upward is neither prose nor inference. It is the encyclopedia's
 * own structured claim, followed link by link.
 *
 * WHAT IT DERIVES, and what it refuses to.
 *
 *   - FAMILY: walk up from the genus until a node says `rank=familia`. Some
 *     genera hang off a subfamily or a tribe (Cirrhilabrus -> Cirrhilabrinae,
 *     Zebrasoma -> Zebrasomini), so this is a walk and not a lookup.
 *   - KIND: keep walking to phylum or class. An ancestor of Actinopterygii is
 *     a fish; of Cnidaria or Mollusca or Arthropoda, an invertebrate. This is
 *     the least arguable classification in the whole repo.
 *   - ZONE: NOT DERIVED. Where an animal sits in the water column is not
 *     recoverable from taxonomy alone at this level of confidence, and
 *     taxonomy.ts is explicit that a family with no zone yields "not recorded"
 *     rather than a guess. Proposed families come back with a kind and no
 *     zone, and a human adds the zone where they can source it.
 *
 * Like `synonyms:propose`, this WRITES A PROPOSAL and edits nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchWikitextBatch, MAX_TITLES_PER_REQUEST } from './sources/wikipedia-text';
import { FAMILY_TRAITS, GENUS_FAMILY, type OrganismKind } from '@/data/seed/taxonomy';

const CATALOG = 'src/data/seed/marts/catalog.json';
const OUT_DIR = 'data/taxonomy';
const OUT = `${OUT_DIR}/genus-proposals.json`;

/** One hop in Wikipedia's taxonomy chain. */
interface Node { taxon: string; rank?: string; parent?: string }

/**
 * Which high-level ancestor decides the kind.
 *
 * Ordered by specificity: a coral is inside Cnidaria which is inside Animalia,
 * so the first match walking UP from the genus is the informative one. Fish
 * classes are listed individually rather than as "Vertebrata" because an
 * amphibian and a reptile are also vertebrates and read very differently on a
 * card.
 */
const KIND_BY_ANCESTOR: ReadonlyArray<[string, OrganismKind]> = [
  // Bony-fish clades. Listed well below class level on purpose: Wikipedia's
  // fish chains are 20+ hops deep, and stopping the walk early was why the
  // first run resolved a family for almost everything and a kind for nothing.
  // Every name here is uncontroversially a fish, so matching lower costs no
  // confidence and saves a great many lookups.
  ['Actinopterygii', 'fish'], ['Actinopteri', 'fish'], ['Teleostei', 'fish'],
  ['Teleocephala', 'fish'], ['Clupeocephala', 'fish'], ['Euteleostei', 'fish'],
  ['Pan-Euteleostei', 'fish'], ['Neoteleostei', 'fish'], ['Eurypterygii', 'fish'],
  ['Ctenosquamata', 'fish'], ['Acanthomorpha', 'fish'], ['Acanthopterygii', 'fish'],
  ['Percomorpha', 'fish'], ['Eupercaria', 'fish'], ['Ovalentaria', 'fish'],
  ['Osteichthyes', 'fish'], ['Chondrichthyes', 'fish'], ['Elasmobranchii', 'fish'],
  ['Sarcopterygii', 'fish'], ['Otophysi', 'fish'], ['Ostariophysi', 'fish'],
  ['Amphibia', 'amphibian'], ['Batrachia', 'amphibian'],
  ['Reptilia', 'reptile'], ['Testudines', 'reptile'], ['Squamata', 'reptile'],
  ['Cryptodira', 'reptile'], ['Eucryptodira', 'reptile'], ['Archelosauria', 'reptile'],
  ['Cnidaria', 'invertebrate'], ['Anthozoa', 'invertebrate'], ['Hexacorallia', 'invertebrate'],
  ['Octocorallia', 'invertebrate'], ['Scleractinia', 'invertebrate'], ['Mollusca', 'invertebrate'],
  ['Gastropoda', 'invertebrate'], ['Bivalvia', 'invertebrate'], ['Cephalopoda', 'invertebrate'],
  ['Arthropoda', 'invertebrate'], ['Crustacea', 'invertebrate'], ['Malacostraca', 'invertebrate'],
  ['Decapoda', 'invertebrate'], ['Echinodermata', 'invertebrate'], ['Asteroidea', 'invertebrate'],
  ['Echinoidea', 'invertebrate'], ['Holothuroidea', 'invertebrate'], ['Ophiuroidea', 'invertebrate'],
  ['Annelida', 'invertebrate'], ['Porifera', 'invertebrate'], ['Bryozoa', 'invertebrate'],
  ['Platyhelminthes', 'invertebrate'], ['Cerithioidea', 'invertebrate'],
  ['Tracheophyta', 'plant'], ['Magnoliophyta', 'plant'], ['Angiosperms', 'plant'],
  ['Monocots', 'plant'], ['Eudicots', 'plant'], ['Core eudicots', 'plant'],
  ['Commelinids', 'plant'], ['Rosids', 'plant'], ['Asterids', 'plant'],
  ['Superrosids', 'plant'], ['Superasterids', 'plant'], ['Bryophyta', 'plant'],
  ['Marchantiophyta', 'plant'], ['Chlorophyta', 'plant'], ['Rhodophyta', 'plant'],
  ['Polypodiopsida', 'plant'], ['Cyatheales', 'plant'], ['Plantae', 'plant'],
  ['Viridiplantae', 'plant'],
];

/**
 * Genus names that mean different things in different kingdoms.
 *
 * `Culcita` is a genus of tree fern AND a genus of cushion starfish, and
 * Wikipedia's taxonomy template answers with the fern. An aquarium vendor is
 * selling the starfish. There is no way to tell from the genus alone, so a
 * homonym is never auto-classified - it is reported for a human, because
 * labelling a starfish as a plant is exactly the invented fact this repo
 * refuses to ship, and it would be invisible once written.
 *
 * A genus is treated as a homonym when its derived kind disagrees with what
 * the vendors say about the water it lives in, or when it is on this list.
 */
const KNOWN_HOMONYMS = new Set(['Culcita', 'Aegle']);

const parseNode = (taxon: string, wikitext?: string): Node => ({
  taxon,
  rank: wikitext?.match(/\|\s*rank\s*=\s*([A-Za-z]+)/)?.[1],
  parent: wikitext?.match(/\|\s*parent\s*=\s*([A-Za-z][A-Za-z\s-]*?)\s*(?:\||\}|$)/m)?.[1]?.trim(),
});

async function main() {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as {
    species: Array<{
      speciesId: string; scientificName?: string; organismKind?: string; waterType?: string;
    }>;
  };

  const unmapped = new Map<string, number>();
  /** What the vendors say about the water each genus is sold for. */
  const waterByGenus = new Map<string, Set<string>>();
  for (const s of catalog.species) {
    if (s.organismKind || !s.scientificName) continue;
    const genus = s.scientificName.split(' ')[0];
    if (!genus || GENUS_FAMILY[genus]) continue;
    unmapped.set(genus, (unmapped.get(genus) ?? 0) + 1);
    if (s.waterType) {
      const set = waterByGenus.get(genus) ?? new Set<string>();
      set.add(s.waterType);
      waterByGenus.set(genus, set);
    }
  }
  const genera = [...unmapped.keys()].sort();
  console.log(`  ${genera.length} genera unmapped, covering ${[...unmapped.values()].reduce((a, b) => a + b, 0)} species`);

  /**
   * Every node fetched, once. The chains converge hard - hundreds of reef
   * genera share Actinopterygii - so memoising turns a walk per genus into
   * roughly one fetch per distinct taxon.
   */
  const seen = new Map<string, Node>();
  let frontier = [...genera];

  for (let depth = 0; depth < 30 && frontier.length; depth++) {
    const todo = [...new Set(frontier)].filter((t) => !seen.has(t));
    if (!todo.length) break;
    console.log(`  depth ${depth}: ${todo.length} taxa to look up`);
    for (let i = 0; i < todo.length; i += MAX_TITLES_PER_REQUEST) {
      const batch = todo.slice(i, i + MAX_TITLES_PER_REQUEST);
      const pages = await fetchWikitextBatch(batch.map((t) => `Template:Taxonomy/${t}`));
      for (const p of pages) {
        const taxon = p.requested.replace('Template:Taxonomy/', '');
        seen.set(taxon, parseNode(taxon, p.wikitext));
      }
      // A title with no template still has to be recorded, or the loop retries
      // it at every depth forever.
      for (const t of batch) if (!seen.has(t)) seen.set(t, { taxon: t });
    }
    frontier = todo.map((t) => seen.get(t)?.parent).filter(Boolean) as string[];
  }

  const chainOf = (genus: string): string[] => {
    const chain: string[] = [];
    let cur: string | undefined = genus;
    while (cur && chain.length < 34) {
      chain.push(cur);
      cur = seen.get(cur)?.parent;
      if (cur && chain.includes(cur)) break; // cyclic template, stop.
    }
    return chain;
  };

  interface Proposal {
    genus: string; species: number; family?: string; kind?: OrganismKind;
    familyKnown: boolean; chain: string[]; source: string;
    /** Set when something about this genus should stop it being auto-applied. */
    suspect?: string;
  }

  const proposals: Proposal[] = genera.map((genus) => {
    const chain = chainOf(genus);
    const family = chain.find((t) => seen.get(t)?.rank === 'familia');
    const ancestor = chain.find((t) => KIND_BY_ANCESTOR.some(([a]) => a === t));
    const kind = KIND_BY_ANCESTOR.find(([a]) => a === ancestor)?.[1];
    const water = waterByGenus.get(genus);

    /**
     * Two independent sources disagreeing is the signal.
     *
     * Wikipedia says what the NAME is; the vendors say what they are SELLING.
     * A genus the taxonomy calls a land plant, listed by a saltwater store, is
     * a homonym rather than a discovery - `Culcita` is a tree fern and also a
     * cushion starfish, and the template answers with the fern. Rather than
     * pick, the disagreement is reported.
     */
    let suspect: string | undefined;
    if (KNOWN_HOMONYMS.has(genus)) {
      suspect = 'Genus name is used in more than one kingdom.';
    } else if (kind === 'plant' && water?.has('marine') && !water.has('freshwater')) {
      suspect = 'Taxonomy says plant, but every listing is marine. Likely a homonym.';
    } else if (kind === 'reptile' && water?.has('marine')) {
      suspect = 'Taxonomy says reptile, sold as marine stock. Check before applying.';
    }

    return {
      genus,
      species: unmapped.get(genus)!,
      family,
      kind,
      familyKnown: Boolean(family && FAMILY_TRAITS[family]),
      chain,
      source: `https://en.wikipedia.org/wiki/Template:Taxonomy/${genus}`,
      ...(suspect ? { suspect } : {}),
    };
  });

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(proposals, null, 2) + '\n');

  const resolved = proposals.filter((p) => p.family && p.kind && !p.suspect);
  const suspect = proposals.filter((p) => p.suspect);
  const newFamilies = new Map<string, { kind: OrganismKind; genera: string[]; species: number }>();
  for (const p of resolved) {
    if (p.familyKnown) continue;
    const e = newFamilies.get(p.family!) ?? { kind: p.kind!, genera: [], species: 0 };
    e.genera.push(p.genus);
    e.species += p.species;
    newFamilies.set(p.family!, e);
  }

  console.log(`\n  ${resolved.length} of ${genera.length} genera resolved to a family AND a kind`);
  console.log(`  ${proposals.length - resolved.length} did not, and are left for a human`);
  console.log(`  ${resolved.reduce((a, p) => a + p.species, 0)} species would gain an organismKind`);
  console.log(`  ${newFamilies.size} families are new to FAMILY_TRAITS\n`);

  const byKind: Record<string, number> = {};
  for (const p of resolved) byKind[p.kind!] = (byKind[p.kind!] ?? 0) + p.species;
  console.log('  species by derived kind:', JSON.stringify(byKind));

  if (suspect.length) {
    console.log(`\n  ${suspect.length} held back for a human:`);
    for (const p of suspect) console.log(`    ${p.genus} (${p.species}) kind=${p.kind} - ${p.suspect}`);
  }

  const unresolved = proposals.filter((p) => !p.family || !p.kind);
  if (unresolved.length) {
    console.log('\n  unresolved:');
    for (const p of unresolved.slice(0, 40)) {
      console.log(`    ${p.genus} (${p.species} species) family=${p.family ?? '?'} kind=${p.kind ?? '?'} chain=${p.chain.join('>')}`);
    }
    if (unresolved.length > 40) console.log(`    ...and ${unresolved.length - 40} more (all in ${OUT})`);
  }
  console.log(`\n  wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
