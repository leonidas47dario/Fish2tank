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
  /**
   * You kept this and no longer do - every holding behind it is empty.
   *
   * Distinct from a quantity of zero, which a fish caught but never brought
   * home also has. "Not in a tank" and "no longer kept" are different
   * sentences and the row has to be able to tell them apart.
   */
  pastKept: boolean;
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

  const summarise = (of: Holding[]) => {
    const quantity = of.reduce((n, h) => n + deriveQuantity(h, lifeEvents), 0);
    return {
      quantity,
      tanks: of.map((h) => tankOf(h.id)).filter((n): n is string => Boolean(n)),
      // Held something once, holds nothing now. A row with no holding at all
      // was never kept, so it is not past kept either.
      pastKept: of.length > 0 && quantity === 0,
    };
  };

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

  /* Kept but never caught.
​
     These used to be dropped once nothing was left of them. Spec 020 keeps
     them: with uploading moved onto the record, dropping a row is dropping the
     only way to reach the fish, and `ownership()` counts the holding either
     way - so the species would read as yours and offer nothing to open. A
     photo of a fish you have lost is the case Fish Heaven exists for. */
  const holdingRows: KeptFishRow[] = holdings
    .filter((h) => !h.specimenId)
    .map((h) => ({
      key: h.id,
      holdingId: h.id,
      name: h.rawLabel ?? speciesName,
      ...summarise([h]),
    }));

  // Specimens first, so minting a record moves a row up the list rather than
  // shuffling the rows around it.
  return [...specimenRows, ...holdingRows];
}
