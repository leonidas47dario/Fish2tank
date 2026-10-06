/**
 * A date the app stores, as words - shared by the sticker book and the card
 * (specs 069, 070) so the same fish never reads two different days.
 *
 * A bare calendar date ("2023-03-14") is parsed as a LOCAL date, not as UTC
 * midnight, which in Chicago would print 14 March as 13 March. An instant is
 * shown in the reader's own zone, which is the day they were standing there.
 */
export function formatWhen(on: string, month: 'short' | 'long' = 'short'): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(on)
    ? new Date(Number(on.slice(0, 4)), Number(on.slice(5, 7)) - 1, Number(on.slice(8, 10)))
    : new Date(on);
  return date.toLocaleDateString(undefined, { month, day: 'numeric', year: 'numeric' });
}
