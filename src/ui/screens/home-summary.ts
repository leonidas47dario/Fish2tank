/**
 * The two lines at the top of Home.
 *
 * Pure so it can be tested: `Home.tsx` is a `.tsx` file and `vitest.config.ts`
 * only collects `src/**\/*.test.ts`, so anything with a branch in it earns its
 * place in a module like this one rather than inline in the component.
 *
 * "species" and "fish" are their own plurals, which is why neither count needs
 * the `s` handling the tank count does.
 */

export interface HomeSummaryInput {
  /** Undefined while the query is in flight. */
  metCount: number | undefined;
  /** Undefined while the query is in flight. */
  fishKept: number | undefined;
  tankCount: number;
  measured: number;
  /** The profile display name, already trimmed. Empty when never set. */
  displayName: string;
}

export interface HomeSummary {
  heading: string;
  sub: string;
}

export function homeSummary(input: HomeSummaryInput): HomeSummary {
  const { metCount, fishKept, tankCount, measured, displayName } = input;

  // No name is the default state, not an error: the profile is created
  // automatically with an empty displayName and nothing forces you to fill it.
  const heading = displayName ? `Welcome, ${displayName}.` : 'Welcome back.';

  if (metCount === undefined || fishKept === undefined) {
    return { heading, sub: 'Loading your collection…' };
  }

  /*
   * The collection state used to be the h1. It moves here so the greeting can
   * take the heading, but it must not be dropped: a screen reader landing on
   * this screen should still hear where the collection stands immediately,
   * which it does as the very next line.
   */
  const collection =
    metCount === 0 && fishKept === 0
      ? 'Nothing caught yet.'
      : `${metCount} species met, ${fishKept} fish kept.`;

  const tanks =
    tankCount === 0
      ? 'No tanks recorded, so nothing can be screened yet.'
      : measured === tankCount
        ? `${tankCount} tank${tankCount === 1 ? '' : 's'}, all measured.`
        : `${tankCount} tank${tankCount === 1 ? '' : 's'}, ${measured} measured.`;

  return { heading, sub: `${collection} ${tanks}` };
}
