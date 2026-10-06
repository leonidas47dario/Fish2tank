/**
 * Every fish you have met or kept, one sticker each - spec 069, FR-R15.
 *
 * PRD 3.2 put "unique specimen cards" in the Collection destination beside the
 * species index, and only the index was built: the catalog is per SPECIES, so
 * today's Panther and last year's smaller jaguar are one tile (FR-R02 asked
 * for them to stay two). This is the other half - one entry per fish.
 *
 * Pure, so the rule Cat Collector's own R04 check names - "filtering returns
 * the appropriate entries without duplicating them" - is a unit test rather
 * than something to eyeball on a screen.
 */
import { deriveQuantity } from './holdings';
import type {
  CalendarDate, Encounter, Holding, Id, Instant, LifeEvent, Media, Specimen,
} from './types';

export type StickerFilter = 'all' | 'caught' | 'kept' | 'golden';

export interface Sticker {
  /** Stable list key: the specimen when one exists, else the holding. */
  key: Id;
  /** Set when a record exists and can simply be opened. */
  specimenId?: Id;
  /** Set when opening the sticker has to mint the record first. */
  holdingId?: Id;
  speciesId?: Id;
  name: string;
  /** Met somewhere: at least one encounter. */
  caught: boolean;
  /** Has a holding, now or in the past. */
  kept: boolean;
  /** Was kept and nothing is left of it. Still a kept fish; it says so. */
  pastKept: boolean;
  golden: boolean;
  /** Newest photograph of THIS fish, if there is one. */
  mediaId?: Id;
  /**
   * The one date a sticker may print, and what it means.
   *
   * Never `createdAt`. That is when a row was written: for the 61 imported
   * fish it is the minute a spreadsheet was read (spec 037), and for a catch
   * it is not when the fish was met (spec 040). A sticker with no real date
   * prints none - P6.
   */
  when?: { kind: 'caught' | 'home'; on: Instant | CalendarDate };
}

export interface StickerBookInput {
  specimens: Specimen[];
  encounters: Encounter[];
  holdings: Holding[];
  lifeEvents: LifeEvent[];
  media: Media[];
  /** Common name for a species id, from whichever catalog knows it. */
  speciesName: (speciesId: Id) => string | undefined;
}

/** The Home shelf's naming order, so a fish is called the same thing on both. */
function nameFor(nickname: string | undefined, speciesName: string | undefined, rawLabel: string | undefined) {
  return nickname ?? speciesName ?? rawLabel ?? 'Mystery catch';
}

export function stickerBook(input: StickerBookInput): Sticker[] {
  const { specimens, encounters, holdings, lifeEvents, media, speciesName } = input;

  const holdingsOf = new Map<Id, Holding[]>();
  for (const h of holdings) {
    if (!h.specimenId) continue;
    holdingsOf.set(h.specimenId, [...(holdingsOf.get(h.specimenId) ?? []), h]);
  }
  const firstMet = new Map<Id, Instant>();
  for (const e of encounters) {
    const seen = firstMet.get(e.specimenId);
    if (!seen || e.observedAt < seen) firstMet.set(e.specimenId, e.observedAt);
  }
  const newestPhoto = new Map<Id, Media>();
  for (const m of media) {
    if (m.kind !== 'photo') continue;
    for (const id of m.specimenIds) {
      const seen = newestPhoto.get(id);
      if (!seen || m.capturedAt > seen.capturedAt) newestPhoto.set(id, m);
    }
  }

  /** Earliest homecoming across the holdings behind one fish. */
  const cameHome = (of: Holding[]): CalendarDate | undefined =>
    of.map((h) => h.acquiredOn).filter((d): d is CalendarDate => Boolean(d)).sort()[0];
  const isPastKept = (of: Holding[]) =>
    of.length > 0 && of.reduce((n, h) => n + deriveQuantity(h, lifeEvents), 0) <= 0;

  const fromSpecimens: Array<Sticker & { order: string }> = specimens.map((s) => {
    const mine = holdingsOf.get(s.id) ?? [];
    const met = firstMet.get(s.id);
    const home = cameHome(mine);
    return {
      key: s.id,
      specimenId: s.id,
      speciesId: s.speciesId,
      name: nameFor(s.nickname, s.speciesId ? speciesName(s.speciesId) : undefined, s.rawLabel),
      caught: met !== undefined,
      kept: mine.length > 0,
      pastKept: isPastKept(mine),
      golden: Boolean(s.golden),
      mediaId: newestPhoto.get(s.id)?.id,
      when: met ? { kind: 'caught', on: met } : home ? { kind: 'home', on: home } : undefined,
      order: s.createdAt,
    };
  });

  /* Kept and never opened - an imported inventory row, typically. Left out,
     the book would disagree with the tanks about which fish are yours. */
  const fromHoldings: Array<Sticker & { order: string }> = holdings
    .filter((h) => !h.specimenId)
    .map((h) => ({
      key: h.id,
      holdingId: h.id,
      speciesId: h.speciesId,
      name: nameFor(undefined, h.speciesId ? speciesName(h.speciesId) : undefined, h.rawLabel),
      caught: false,
      kept: true,
      pastKept: isPastKept([h]),
      golden: false,
      when: h.acquiredOn ? { kind: 'home', on: h.acquiredOn } : undefined,
      order: h.createdAt,
    }));

  /*
   * Newest first by the date the sticker actually prints. Fish with no real
   * date go after every dated one, ordered among themselves by when their row
   * was written - an ORDER, which claims nothing, rather than a printed date,
   * which would. Sorting undated imports by createdAt alongside the rest would
   * put a three-year-old fish above yesterday's catch.
   */
  return [...fromSpecimens, ...fromHoldings]
    .sort((a, b) => {
      if (a.when && b.when) return b.when.on.localeCompare(a.when.on);
      if (a.when) return -1;
      if (b.when) return 1;
      return b.order.localeCompare(a.order);
    })
    .map(({ order: _order, ...sticker }) => sticker);
}

export function matchesFilter(sticker: Sticker, filter: StickerFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'caught': return sticker.caught;
    case 'kept': return sticker.kept;
    case 'golden': return sticker.golden;
  }
}

export function countStickers(stickers: Sticker[]): Record<StickerFilter, number> {
  const count = (f: StickerFilter) => stickers.filter((s) => matchesFilter(s, f)).length;
  return { all: count('all'), caught: count('caught'), kept: count('kept'), golden: count('golden') };
}
