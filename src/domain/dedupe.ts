/**
 * Collapsing the holdings that three non-idempotent seed runs left behind.
 *
 * THIS REPAIRS ONE HISTORICAL BUG AND IS NOT A GENERAL FEATURE. Before
 * `ea7accc` (2026-08-29) `importInventory` minted a fresh UUID per row on
 * every run, so re-seeding or re-importing the same spreadsheet added a whole
 * second copy of the inventory instead of updating it. Ids are derived from
 * row content now and `applyInventoryImport` uses `bulkPut`, so no new
 * duplicate can be created - but the fix cannot heal rows that already exist,
 * because every one of them carries a different primary key.
 *
 * Ryan's production account was measured on 2026-08-30 through
 * `npx dexie-cloud export`: 176 holdings written in three bulk runs
 * (2026-08-27T15:57:46Z, 2026-08-29T04:00:10Z, 2026-08-29T07:29:56Z) plus two
 * rows added by hand. 63 distinct fish. Every id a random UUID, so all three
 * runs predate the fix.
 *
 * WHAT COUNTS AS THE SAME FISH: species, verbatim label, and the tank it
 * currently lives in. The tank is part of the key because keeping guppies in
 * two tanks is two legitimate rows, and that is exactly what Ryan does -
 * without the tank in the key this would silently merge them. Verified
 * against the real export: no single run ever wrote two rows for one fish in
 * one tank, so within a group every row beyond the first is import damage.
 *
 * WHICH COPY SURVIVES: the richest, not the oldest. Keeping the oldest looks
 * obviously right and is wrong - measured against production it would have
 * deleted two holdings linked to real logged catches and one carrying life
 * events, because those attached themselves to whichever copy happened to be
 * on screen at the time. Richness wins, and the oldest breaks the tie so the
 * original creation date survives where nothing else distinguishes the rows.
 */
import { currentResidency } from './holdings';
import type { Holding, Id, LifeEvent, Residency } from './types';

export interface DedupePlan {
  /** One survivor per group, plus every holding the plan refuses to touch. */
  keep: Holding[];
  /** Duplicates to delete, with their residencies and life events. */
  remove: Holding[];
  /**
   * Dropped rows whose note the survivor does not already carry. Empty on
   * Ryan's production data - every duplicated note was a verbatim copy - but
   * a caller must surface a non-empty list rather than deleting through it.
   */
  notesAtRisk: Holding[];
  /** Left alone because there is no open residency to group them by. */
  skippedWithoutTank: Holding[];
  before: number;
  after: number;
}

/**
 * How much a copy is worth keeping. A catch link is worth more than an event,
 * an event more than a note, because a lost link orphans a specimen while a
 * lost note loses a sentence.
 */
function richness(holding: Holding, eventCounts: Map<Id, number>): number {
  return (holding.specimenId ? 4 : 0)
    + (eventCounts.get(holding.id) ? 2 : 0)
    + (holding.notes ? 1 : 0);
}

/**
 * Group by species, label and current tank. Undefined species and undefined
 * label are distinct values rather than wildcards: two unlisted fish with
 * different verbatim labels are two fish.
 */
function groupKey(holding: Holding, aquariumId: Id): string {
  return JSON.stringify([holding.speciesId ?? null, holding.rawLabel ?? null, aquariumId]);
}

export function planDedupe(
  holdings: Holding[],
  residencies: Residency[],
  events: LifeEvent[],
): DedupePlan {
  const eventCounts = new Map<Id, number>();
  for (const e of events) eventCounts.set(e.holdingId, (eventCounts.get(e.holdingId) ?? 0) + 1);

  const groups = new Map<string, Holding[]>();
  const keep: Holding[] = [];
  const skippedWithoutTank: Holding[] = [];

  for (const holding of holdings) {
    // A holding the keeper created by hand is not import damage, whatever it
    // looks like. The importer is the only thing that ever duplicated.
    if (!holding.openingBalance) {
      keep.push(holding);
      continue;
    }
    const tank = currentResidency(holding.id, residencies)?.aquariumId;
    if (!tank) {
      // No open residency means no group. Guessing from a closed one would
      // merge a fish with the tank it used to live in.
      skippedWithoutTank.push(holding);
      keep.push(holding);
      continue;
    }
    const key = groupKey(holding, tank);
    const bucket = groups.get(key);
    if (bucket) bucket.push(holding);
    else groups.set(key, [holding]);
  }

  const remove: Holding[] = [];
  const notesAtRisk: Holding[] = [];

  for (const bucket of groups.values()) {
    // Richest first; oldest breaks the tie; id breaks that, so the same input
    // always produces the same plan whatever order Dexie hands rows back in.
    const ordered = [...bucket].sort((a, b) =>
      richness(b, eventCounts) - richness(a, eventCounts)
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id));

    const [survivor, ...duplicates] = ordered;
    keep.push(survivor);
    remove.push(...duplicates);
    for (const d of duplicates) {
      if (d.notes && d.notes !== survivor.notes) notesAtRisk.push(d);
    }
  }

  return {
    keep,
    remove,
    notesAtRisk,
    skippedWithoutTank,
    before: holdings.length,
    after: keep.length,
  };
}
