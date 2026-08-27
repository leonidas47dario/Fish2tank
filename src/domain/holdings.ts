/**
 * Derived views over holding lifecycle history - PRD 4.8.
 *
 * Nothing here mutates. Quantity, tank placement and badges are all DERIVED
 * from the dated event and residency records, which is what lets FR-T03 and
 * FR-T06 hold: "history is never overwritten by a single tank field", and
 * "badges update without deleting earlier records".
 */
import type { CalendarDate, Holding, Id, LifeEvent, Residency } from './types';

/**
 * Live count for a holding. Opening balance plus every dated delta.
 *
 * Clamped at zero: a correction that over-subtracts is a data-entry problem,
 * not a licence to render a negative fish count.
 */
export function deriveQuantity(holding: Holding, events: LifeEvent[]): number {
  const total = events
    .filter((e) => e.holdingId === holding.id)
    .reduce((n, e) => n + e.quantityDelta, holding.openingQuantity);
  return Math.max(0, total);
}

/** The residency with no end date, if the holding currently lives anywhere. */
export function currentResidency(holdingId: Id, residencies: Residency[]): Residency | undefined {
  return residencies.find((r) => r.holdingId === holdingId && !r.endDate);
}

export type HoldingBadge = 'current' | 'past-kept';

/**
 * FR-T06. "Current" requires both live animals and an open tank placement;
 * anything that was once kept and no longer is becomes "Past kept". A holding
 * that has never had a residency gets no badge at all.
 */
export function deriveBadge(
  holding: Holding,
  events: LifeEvent[],
  residencies: Residency[],
): HoldingBadge | undefined {
  const quantity = deriveQuantity(holding, events);
  const open = currentResidency(holding.id, residencies);
  const everKept = residencies.some((r) => r.holdingId === holding.id);
  if (quantity > 0 && open) return 'current';
  if (everKept) return 'past-kept';
  return undefined;
}

function overlaps(a: Residency, b: Residency): boolean {
  const aStart = Date.parse(a.startDate);
  const aEnd = a.endDate ? Date.parse(a.endDate) : Infinity;
  const bStart = Date.parse(b.startDate);
  const bEnd = b.endDate ? Date.parse(b.endDate) : Infinity;
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * FR-T08: real tankmates, derived from overlapping residency intervals in the
 * same aquarium.
 *
 * Deliberately separate from anything the compatibility engine consumes. A
 * store's co-housing choices are not evidence, and neither is the fact that
 * two fish happened to share a tank here - this answers "who did this fish
 * actually live with", nothing more.
 */
export function homeTankmates(holdingId: Id, residencies: Residency[]): Array<{ holdingId: Id; aquariumId: Id }> {
  const mine = residencies.filter((r) => r.holdingId === holdingId);
  const out = new Map<string, { holdingId: Id; aquariumId: Id }>();
  for (const m of mine) {
    for (const other of residencies) {
      if (other.holdingId === holdingId) continue;
      if (other.aquariumId !== m.aquariumId) continue;
      if (!overlaps(m, other)) continue;
      out.set(`${other.holdingId}:${other.aquariumId}`, {
        holdingId: other.holdingId,
        aquariumId: other.aquariumId,
      });
    }
  }
  return [...out.values()];
}

/**
 * Close the open residency and open a new one (FR-T03).
 *
 * Returns the records to write rather than writing them, so the move is
 * testable and the caller controls the transaction.
 */
export function planMove(
  holdingId: Id,
  toAquariumId: Id,
  on: CalendarDate,
  residencies: Residency[],
  newResidencyId: Id,
): { close?: Residency; open: Residency } {
  const open = currentResidency(holdingId, residencies);
  return {
    close: open ? { ...open, endDate: on } : undefined,
    open: { id: newResidencyId, holdingId, aquariumId: toAquariumId, startDate: on },
  };
}

/** Chronological history for one holding, newest last. */
export function timeline(holdingId: Id, events: LifeEvent[]): LifeEvent[] {
  return events
    .filter((e) => e.holdingId === holdingId)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt));
}
