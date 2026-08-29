/**
 * Turning "what did I just photograph?" into a catalog species.
 *
 * WHY IT WORKS THIS WAY. Google Lens has no public API - there is no endpoint
 * a third party can call - and Cloud Vision would need a billing-backed key
 * plus shipping the photograph to Google, which contradicts the one promise
 * this app makes without qualification: nothing leaves the device. PRD FR-I03
 * already anticipated this and specifies a *handoff*, not an integration.
 *
 * So the flow is: the photo goes to Lens only if you tap share, Lens tells YOU
 * what it thinks, and you type or paste the name back. This module is the half
 * that matters afterwards - turning whatever words came back into a ranked
 * shortlist of real catalog species, so the fewest possible taps stand between
 * a name and a confirmed identity.
 *
 * The matching is deliberately generous where the search is, and strict where
 * the *assertion* is: a search can suggest ten candidates harmlessly, but
 * nothing is ever auto-confirmed. The user picks. That keeps FR-E05 intact -
 * the app never decides that one fish is another.
 */
import type { CatalogSpecies } from './catalog';

export interface Candidate {
  species: CatalogSpecies;
  /** 0-1. A ranking aid for the UI, never a claimed probability. */
  score: number;
  /** Which field matched, so the UI can say why this is on the list. */
  via: 'scientific-name' | 'common-name' | 'alias' | 'word-overlap';
}

/** Lowercase, strip punctuation and the noise Lens tends to return. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words that carry no identifying signal.
 *
 * Lens results are full of them - "aquarium fish", "freshwater fish", "pet" -
 * and without this a query of "freshwater aquarium fish" scores every species
 * whose name happens to contain "fish" equally.
 */
const STOPWORDS = new Set([
  'fish', 'aquarium', 'freshwater', 'saltwater', 'marine', 'tropical', 'pet',
  'live', 'the', 'a', 'an', 'and', 'of', 'for', 'with', 'in', 'on',
  'species', 'genus', 'family', 'photo', 'image', 'stock', 'sale', 'tank',
]);

function contentWords(s: string): string[] {
  return normalise(s).split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * How much of `query` is accounted for by `target`, and vice versa.
 *
 * Symmetric on purpose. "Cardinal Tetra" against "Cardinal Tetra" should beat
 * "Cardinal Tetra" against "Cardinal Tetra Long Fin Albino Premium", because
 * the second target is carrying words the query never mentioned.
 */
function overlap(queryWords: string[], targetWords: string[]): number {
  if (queryWords.length === 0 || targetWords.length === 0) return 0;
  const t = new Set(targetWords);
  const hits = queryWords.filter((w) => t.has(w)).length;
  if (hits === 0) return 0;
  const precision = hits / targetWords.length;
  const recall = hits / queryWords.length;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Rank catalog species against free text.
 *
 * The text can be anything: a binomial pasted out of Lens, a trade name typed
 * one-handed in a shop, or a whole messy Lens caption. All three have to work,
 * because all three are what actually happens.
 */
export function identifyFromText(
  text: string,
  catalog: readonly CatalogSpecies[],
  limit = 8,
): Candidate[] {
  const q = normalise(text);
  if (!q) return [];
  const qWords = contentWords(text);

  const scored: Candidate[] = [];

  for (const species of catalog) {
    let best: Candidate | undefined;

    const consider = (score: number, via: Candidate['via']) => {
      if (score <= 0) return;
      if (!best || score > best.score) best = { species, score, via };
    };

    // An exact binomial is as certain as this gets short of the user saying so.
    const sci = species.scientificName ? normalise(species.scientificName) : '';
    if (sci) {
      if (q === sci) consider(1, 'scientific-name');
      else if (q.includes(sci) || sci.includes(q)) consider(0.9, 'scientific-name');
      else consider(overlap(qWords, contentWords(species.scientificName!)) * 0.85, 'scientific-name');
    }

    const common = normalise(species.commonName);
    if (common) {
      if (q === common) consider(0.98, 'common-name');
      else if (q.includes(common) || common.includes(q)) consider(0.8, 'common-name');
      else consider(overlap(qWords, contentWords(species.commonName)) * 0.75, 'common-name');
    }

    // Trade names are how a shop labels it, which is often what Lens reads off
    // the tag in the photograph.
    for (const alias of species.aliases) {
      const a = normalise(alias);
      if (!a) continue;
      if (q === a) consider(0.9, 'alias');
      else consider(overlap(qWords, contentWords(alias)) * 0.6, 'alias');
    }

    if (best) scored.push(best);
  }

  return scored
    .sort((a, b) => b.score - a.score || a.species.commonName.localeCompare(b.species.commonName))
    .slice(0, limit);
}

/**
 * Is the top candidate far enough ahead to lead with?
 *
 * Never used to auto-confirm - only to decide whether the UI shows one
 * suggestion prominently or a flat list of equals. A near-tie means the app
 * genuinely does not know, and pretending otherwise is how you end up with a
 * peacock bass filed as a largemouth.
 */
export function isConfident(candidates: readonly Candidate[]): boolean {
  const [first, second] = candidates;
  if (!first || first.score < 0.7) return false;
  return !second || first.score - second.score >= 0.15;
}

/**
 * Can this device hand a photo to another app?
 *
 * `canShare` with files is the honest check - Firefox and desktop Chrome
 * expose `navigator.share` but reject files, so testing for `share` alone
 * offers a button that fails on tap.
 */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * Hand a photo to a visual search app, as an IMAGE AND NOTHING ELSE.
 *
 * THE TITLE AND TEXT ARE DELIBERATELY ABSENT, and removing them is the whole
 * point of this function existing.
 *
 * It used to share `{ files, title: 'What fish is this?', text: 'Identify this
 * fish' }`. A share carrying text is a different kind of share: the receiving
 * app gets a text payload as well as an image, and Chrome on iOS acts on the
 * text - opening a tab or a web search for the words - rather than routing the
 * image into Lens. The extra text also pushes iOS's own sheet toward the
 * people-and-messaging suggestions at the top, because a caption plus a
 * picture looks like a message.
 *
 * Neither string was ever read by anything. Lens wants a picture.
 *
 * WHAT THIS STILL CANNOT DO, because no web page can: choose which app
 * receives the share. `navigator.share()` has no target parameter on any
 * platform, by design - the OS owns that choice, and on iOS the order of the
 * sheet is Apple's, learned from what you actually pick. Sending a clean image
 * share is the whole of what a web app is allowed to influence here.
 */
export async function shareForLens(
  file: File,
  share: (data: ShareData) => Promise<void> = (d) => navigator.share(d),
): Promise<'shared' | 'cancelled' | 'unavailable'> {
  try {
    await share({ files: [file] });
    return 'shared';
  } catch (e) {
    // Dismissing the sheet rejects with AbortError. That is the user changing
    // their mind, not a failure worth shouting about.
    if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
    return 'unavailable';
  }
}

/**
 * Google Lens by URL, for when the share sheet is not available.
 *
 * Only usable with a publicly reachable image URL, which a blob in IndexedDB
 * is not - so this is the fallback for a species PORTRAIT (already a Commons
 * URL), not for your own photo. Your own photo never goes anywhere except
 * through the share sheet you tapped.
 */
export function lensSearchUrl(imageUrl: string): string {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
}
