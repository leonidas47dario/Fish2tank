/**
 * Who lived in a tank and does not now - spec 048.
 *
 * WHAT THIS MAKES TRUE. Fish Heaven's subtitle says "Still part of every tank
 * they lived in". That was true of the data and false of the app: a memorial
 * recorded which holding died, a residency recorded which tank that holding
 * lived in, and no screen ever joined the two. This is the join. It needs no
 * new storage - `Residency` has carried `aquariumId`, `startDate` and
 * `endDate` from the beginning and `Memorial` has carried `holdingId` and
 * `occurredOn` since FR-L02.
 *
 * PURE, like everything in `domain/`. No clock, no database, no global state,
 * so the screen decides nothing and what a test asserts cannot drift from what
 * a keeper sees.
 *
 * NOT ONLY THE DEAD. A fish you rehomed lived here exactly as much as one that
 * died here, and a section called "who lived here" that quietly omitted it
 * would answer a different question than its own heading asks.
 */
import type {
  Aquarium, CalendarDate, Holding, Id, Memorial, Residency, Specimen,
} from './types';

export interface FormerResident {
  /** Stable per residency: a holding that lived here twice has two entries. */
  id: Id;
  holdingId: Id;
  specimenId?: Id;
  name: string;
  from: CalendarDate;
  /** Absent while the holding still lives here - only possible with a death. */
  to?: CalendarDate;
  /**
   * The memorial for this holding, when there is one - whether or not the
   * death happened here. `diedHere` is what says which.
   */
  memorial?: Memorial;
  /**
   * True when the death falls inside THIS residency. A fish that left and died
   * somewhere else later must not be filed as having died here: that would
   * attribute a death to a tank the fish had already left, which is the class
   * of false claim P6 forbids.
   */
  diedHere: boolean;
  /** Where they went next, when a later residency says. */
  movedTo?: { id: Id; name: string };
  /**
   * A holding can be several fish, and the still-resident-with-a-loss case is
   * only sayable when the row knows which: "some of them are still here" is
   * true of a group of six that lost two and false of one fish.
   */
  isGroup: boolean;
}

/** Inclusive at both ends: `recordDeath` closes the residency ON the death date. */
function within(residency: Residency, on: CalendarDate): boolean {
  if (on < residency.startDate) return false;
  return !residency.endDate || on <= residency.endDate;
}

export function whoLivedHere(input: {
  aquariumId: Id;
  residencies: Residency[];
  holdings: Holding[];
  memorials: Memorial[];
  specimens: Specimen[];
  aquariums: Aquarium[];
}): FormerResident[] {
  const {
    aquariumId, residencies, holdings, memorials, specimens, aquariums,
  } = input;

  const holdingById = new Map(holdings.map((h) => [h.id, h]));
  const specimenById = new Map(specimens.map((s) => [s.id, s]));
  const tankById = new Map(aquariums.map((a) => [a.id, a]));

  const here = residencies.filter((r) => r.aquariumId === aquariumId);
  const out: FormerResident[] = [];

  for (const residency of here) {
    const holding = holdingById.get(residency.holdingId);
    if (!holding) continue;

    const mine = memorials.filter((m) => m.holdingId === holding.id);
    const diedHereMemorial = mine.find((m) => within(residency, m.occurredOn));

    /*
     * A residency that is still open and carries no death is a CURRENT
     * resident. The tank lists it above; printing it here would say it has
     * gone. The open-with-a-death case is kept on purpose - a group of six
     * that lost two is still resident, and those two died in this tank.
     */
    if (!residency.endDate && !diedHereMemorial) continue;

    const specimen = holding.specimenId ? specimenById.get(holding.specimenId) : undefined;

    /*
     * Where they went next: the earliest residency elsewhere that began at or
     * after this one ended. Not simply "their current tank" - a fish that has
     * moved twice went to the second tank FROM here, and naming the third
     * would describe a journey nobody took.
     */
    let movedTo: FormerResident['movedTo'];
    if (residency.endDate) {
      const next = residencies
        .filter((r) => r.holdingId === holding.id
          && r.aquariumId !== aquariumId
          && r.startDate >= residency.endDate!)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
      const tank = next ? tankById.get(next.aquariumId) : undefined;
      if (next && tank) movedTo = { id: tank.id, name: tank.name };
    }

    out.push({
      id: residency.id,
      holdingId: holding.id,
      specimenId: holding.specimenId,
      name: specimen?.nickname
        ?? holding.rawLabel
        ?? specimen?.rawLabel
        ?? 'A fish',
      from: residency.startDate,
      to: residency.endDate,
      isGroup: holding.kind === 'group',
      // Prefer the death that happened here; otherwise carry the one that
      // happened later somewhere else, so the row can still link to it.
      memorial: diedHereMemorial ?? mine.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))[0],
      diedHere: Boolean(diedHereMemorial),
      movedTo,
    });
  }

  // Most recently gone first: a keeper opening this is looking for the one
  // they just lost, not the first fish they ever kept.
  return out.sort((a, b) =>
    (b.to ?? b.memorial?.occurredOn ?? b.from).localeCompare(a.to ?? a.memorial?.occurredOn ?? a.from)
    || a.id.localeCompare(b.id));
}
