/**
 * Species promoted from keeper submissions, as the mart builder consumes them.
 *
 * WHY THIS IS APPLIED AT MART LEVEL, like species-care.json. The warehouse is
 * rebuilt from a vendor scrape, and anything merged into it has to be
 * re-derived on every refresh or it is lost. These species are not derived
 * from anything scrapeable - that is the entire reason they exist - so they
 * are folded in after the warehouse is read, and survive every rebuild.
 *
 * WHAT A PROMOTED SPECIES IS AND IS NOT. It has a name and nothing else: no
 * adult size, no aggression rating, no portrait, no water type. One keeper's
 * reading of a store tag is a name, not a care profile, and inventing the rest
 * to make the card look complete would be the invented fact this codebase
 * refuses everywhere else. The care backfill can source them later, the same
 * way it does for any other species.
 */
import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_PATH = 'src/data/seed/community-species.json';

export interface PromotedSpecies {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  aliases: string[];
  submittedAt: string;
  submittedLabel: string;
  acceptedAt: string;
  note?: string;
}

/**
 * Absent file is a normal state, not an error - the catalog must build on a
 * clean checkout where nobody has promoted anything yet.
 */
export function loadPromotedSpecies(path = DEFAULT_PATH): PromotedSpecies[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { species?: PromotedSpecies[] };
  return parsed.species ?? [];
}
