/**
 * What goes on one fish's card - spec 070, FR-R16.
 *
 * Pure, and separate from the drawing, because every rule that matters here
 * is about what must NOT appear: an invented fact (P6), a home, a coordinate
 * (NFR-04), an email address on an image made to be sent to strangers. Those
 * are unit tests. The canvas only decides where the words go.
 */
import type { CalendarDate, Instant, Place, Specimen } from './types';

export interface CatchCardInput {
  specimen: Pick<Specimen, 'nickname' | 'rawLabel' | 'golden'>;
  commonName?: string;
  scientificName?: string;
  /** When this fish was first met - the earliest encounter. */
  firstMet?: Instant;
  /** Where it was first met. */
  place?: Pick<Place, 'name' | 'branch' | 'type' | 'coarseLocation'>;
  /** When it came home, for a fish that was never met in a shop. */
  acquiredOn?: CalendarDate;
  /** The name the keeper chose in this app. Preferred. */
  displayName?: string;
  /** The account's name, from the sign-in provider. Used only if it is not an address. */
  accountName?: string;
  showPlace: boolean;
  showName: boolean;
}

export interface CatchCardContent {
  title: string;
  /** The common name, when the title is a nickname that does not say what it is. */
  kind?: string;
  scientific?: string;
  finder?: string;
  where?: string;
  when?: { kind: 'caught' | 'home'; on: Instant | CalendarDate };
  golden: boolean;
}

/**
 * Anything with an @ between two non-space runs.
 *
 * Deliberately broad. A false positive costs a name that was not shown; a
 * false negative publishes someone's address on an image.
 */
export function looksLikeEmail(name: string): boolean {
  return /\S@\S/.test(name);
}

/** The name a card may credit, or nothing. */
export function publicName(displayName?: string, accountName?: string): string | undefined {
  for (const candidate of [displayName, accountName]) {
    const name = candidate?.trim();
    if (name && !looksLikeEmail(name)) return name;
  }
  return undefined;
}

/**
 * The place, as a card may name it.
 *
 * Only the three fields `types.ts` marks safe to surface. Never a home, not
 * even its name: "Caught at Mum's" on an image is a home location by another
 * route.
 */
export function publicPlace(place?: CatchCardInput['place']): string | undefined {
  if (!place || place.type === 'home') return undefined;
  const name = [place.name, place.branch].map((p) => p?.trim()).filter(Boolean).join(' ');
  const locality = place.coarseLocation?.trim();
  return [name, locality].filter(Boolean).join(' · ') || undefined;
}

export function catchCardContent(input: CatchCardInput): CatchCardContent {
  const { specimen, commonName, scientificName } = input;
  const nickname = specimen.nickname?.trim() || undefined;
  return {
    // The Home shelf's order, so a fish is called the same thing everywhere.
    title: nickname ?? commonName ?? specimen.rawLabel ?? 'Mystery catch',
    // "the Panther" alone does not say what the Panther is.
    kind: nickname && commonName ? commonName : undefined,
    scientific: scientificName,
    finder: input.showName ? publicName(input.displayName, input.accountName) : undefined,
    where: input.showPlace ? publicPlace(input.place) : undefined,
    when: input.firstMet
      ? { kind: 'caught', on: input.firstMet }
      : input.acquiredOn ? { kind: 'home', on: input.acquiredOn } : undefined,
    golden: Boolean(specimen.golden),
  };
}

/**
 * Greedy word wrap against any measuring function, so the line breaking is
 * testable without a canvas. A single word wider than the line is kept whole
 * on its own line rather than split mid-word; the caller's ellipsis handles it.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * At most `max` lines, the last one ending in an ellipsis when anything was
 * cut. Trims whole words from the last line until the ellipsis fits.
 */
export function clampLines(
  lines: string[], max: number, maxWidth: number, measure: (s: string) => number,
): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1]!;
  while (last.includes(' ') && measure(`${last}…`) > maxWidth) {
    last = last.slice(0, last.lastIndexOf(' '));
  }
  kept[max - 1] = `${last}…`;
  return kept;
}

/** A file name for the saved image: lowercase, ASCII, hyphenated. */
export function cardFileName(title: string): string {
  const slug = title
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `fish2tank-${slug || 'card'}.jpg`;
}
