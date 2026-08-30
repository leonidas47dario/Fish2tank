/**
 * First-run seeding.
 *
 * Seeds the species catalog. Nothing else.
 *
 * IT USED TO SEED A GREAT DEAL MORE: six tanks, a real 61-row inventory, a
 * local fish store, and the Panther encounter PRD section 10 is built around,
 * "so the app opens on real data rather than an empty shell". All of that is
 * one person's collection, and putting it in every database was wrong in three
 * separate ways.
 *
 *   1. REDUNDANT. Exports exist now (spec 006). A fresh device should restore a
 *      backup, not fabricate somebody's fish.
 *   2. IT BROKE RESTORES. Re-seeding an emptied database and then importing a
 *      backup produced 122 holdings instead of 61, because the re-seeded rows
 *      carried different ids from the exported ones. Measured in a browser,
 *      not theorised.
 *   3. IT IS SOMEBODY ELSE'S DATA. The moment a second keeper opens the app,
 *      auto-seeding hands them Ryan's tanks, Ryan's fish and Ryan's local fish
 *      store. That is not a demo, it is a bug.
 *
 * It also had to go before sync arrives: a device that both seeds and syncs
 * would build local rows alongside the incoming ones.
 *
 * The species catalog stays, because it is reference data every keeper needs
 * rather than anyone's collection. The sample collection moved to
 * `src/data/seed/fixtures/smoke-collection.zip` (`npm run fixture:smoke`), and
 * the smoke test restores it through the real import code - so every CI run
 * also proves backup and restore still work.
 *
 * Existing devices are untouched. Seeding only ever ran against an empty table,
 * so removing it neither deletes nor renames anything already on a device.
 */
import { db } from './db';
import { SPECIES_CATALOG } from './seed/species-catalog';
import { upsertSpecies } from './repositories';
import { sweepOrphanedBlobsQuietly } from './blob-sweep';

// Tanks and store live in their own module so plain-tsx tooling can read them
// without pulling in a Vite-only `?raw` CSV import. Re-exported here because
// existing importers (tank-linkage.test.ts among them) address them via this
// file, and because the fixture generator needs them.
export {
  STARTER_TANKS,
  STARTER_PLACE,
  SEEDED_AT,
  NEEDS_MEASURING,
} from './seed/starter-collection';

let started: Promise<void> | undefined;

export function bootstrap(): Promise<void> {
  started ??= (async () => {
    if ((await db.species.count()) === 0) {
      for (const entry of SPECIES_CATALOG) await upsertSpecies(entry.species, entry.profile);
    }

    // BUG-06, spec 012. Deliberately NOT awaited: collecting bytes nothing
    // references is housekeeping, and nobody should wait behind it to see
    // their tanks. It reads last session's records, so a deletion that
    // arrives from another device mid-session is collected on the next
    // start-up or at the end of the next media sync, whichever comes first.
    void sweepOrphanedBlobsQuietly();
  })();
  return started;
}
