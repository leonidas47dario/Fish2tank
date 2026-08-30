/**
 * "Your fish" on a species page, as one list - spec 019.
 *
 * A fish of yours reaches this list by one of two routes. You caught it, so a
 * specimen stands for it; or you simply keep it, so only a holding does, which
 * is the FR-T02 case an imported inventory row produces. Both are your fish
 * and both should read the same, which is what this flattens them into.
 *
 * It used to be two lists with different facts - specimens showed a name and a
 * date, holdings showed a name, a count and a tank. That seam was visible the
 * moment a holding was minted into a specimen: the row crossed from one list
 * to the other and dropped its count and its tank on the way.
 *
 * Pure, and here rather than in the screen, because it is also the answer to
 * "which fish is this a photo OF?" and those two answers must not drift apart.
 */
import { deriveQuantity } from './holdings';
import type { Aquarium, Holding, Id, Instant, LifeEvent, Residency, Specimen } from './types';

export interface KeptFishRow {
  /** Stable list key: the specimen when one exists, else the holding. */
  key: Id;
  /** Set when a record already exists and can simply be opened. */
  specimenId?: Id;
  /** Set when opening the row has to mint the record first. */
  holdingId?: Id;
  name: string;
  /** Live count across every holding behind this row. Zero for a fish never brought home. */
  quantity: number;
  /** Tanks it currently lives in, in holding order. Empty when it lives nowhere. */
  tanks: string[];
  /** When the record was created. Absent until one exists. */
  createdAt?: Instant;
}

export interface KeptFishInput {
  specimens: Specimen[];
  /** Holdings of this species only. */
  holdings: Holding[];
  residencies: Residency[];
  lifeEvents: LifeEvent[];
  aquariums: Aquarium[];
  /** Shown when a holding carried no label of its own. */
  speciesName: string;
}

export function keptFishRows(input: KeptFishInput): KeptFishRow[] {
  const { specimens, holdings, residencies, lifeEvents, aquariums, speciesName } = input;

  /** Where a holding lives now, by name. A closed residency is not a home. */
  const tankOf = (holdingId: Id): string | undefined => {
    const open = residencies.find((r) => r.holdingId === holdingId && !r.endDate);
    if (!open) return undefined;
    return aquariums.find((t) => t.id === open.aquariumId)?.name;
  };

  const summarise = (of: Holding[]) => ({
    quantity: of.reduce((n, h) => n + deriveQuantity(h, lifeEvents), 0),
    tanks: of.map((h) => tankOf(h.id)).filter((n): n is string => Boolean(n)),
  });

  /* A specimen can stand behind several holdings, because "also add to another
     tank" attaches a second one rather than moving the first. So a specimen is
     one row that sums across them, not one row each. */
  const specimenRows: KeptFishRow[] = specimens.map((s) => ({
    key: s.id,
    specimenId: s.id,
    name: s.nickname ?? s.rawLabel ?? 'Unnamed specimen',
    createdAt: s.createdAt,
    ...summarise(holdings.filter((h) => h.specimenId === s.id)),
  }));

  /* Kept but never caught. Dropped once nothing is left of it, the way the
     tank views drop it - a holding at zero is history, not a resident. */
  const holdingRows: KeptFishRow[] = holdings
    .filter((h) => !h.specimenId)
    .map((h) => ({
      key: h.id,
      holdingId: h.id,
      name: h.rawLabel ?? speciesName,
      ...summarise([h]),
    }))
    .filter((r) => r.quantity > 0);

  // Specimens first, so minting a record moves a row up the list rather than
  // shuffling the rows around it.
  return [...specimenRows, ...holdingRows];
}
