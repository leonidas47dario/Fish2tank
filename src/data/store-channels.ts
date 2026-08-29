/**
 * What kind of buyer each tracked store serves.
 *
 * ONE map, so a vendor cannot be classified in the app and forgotten in the
 * ETL - the same drift TRACKED_STORES exists to prevent, in a second place it
 * could have happened. store-channels.test.ts fails the build if a store in
 * STORES or in the shipped index has no channel.
 *
 * WHY THIS DECIDES THE RATING. Market scarcity asks "would I see this on a
 * local shelf", so the sample has to be stores that resemble a local shelf.
 * Weighting every vendor equally turned the rating into a Predatory Fins
 * catalogue dump: 275 of 299 species came from PF and 198 were sole-source
 * there, so the "rarest" fish in the app were simply PF's stock list.
 *
 * See docs/specs/004-local-shelf-scarcity.md.
 */
export type StoreChannel = 'community' | 'specialist';

export const STORE_CHANNELS: Record<string, StoreChannel> = {
  // --- community: generalist shops whose catalogue approximates a local shelf.
  'imperial-tropicals': 'community',
  'aquahuna': 'community',
  'aquarium-coop': 'community',
  // The one vendor Ryan can physically walk into (Orland Park, IL), and so the
  // single most legitimate witness in the list for a question about shelves.
  'nu-aqua': 'community',

  // --- specialist: importers, aggregators and single-niche boutiques. They
  // prove an animal exists in trade and they price it. They are never evidence
  // about a shelf.
  'predatory-fins': 'specialist',
  'global-exoticquatics': 'specialist',
  'j4-flowerhorns': 'specialist',
  // A shrimp and invert boutique. Its not carrying a cichlid says nothing
  // about cichlids, so its silence must not count against one.
  'flip-aquatics': 'specialist',
  /**
   * Aquatic Arts is specialist on Ryan's call - "not a local fish store, more
   * in line with Predatory Fins" - and the catalogue shape agrees. Share of a
   * store's species that no other tracked store carries:
   *
   *   Predatory Fins      79.2%  (423 of 534)
   *   Aquatic Arts        70.9%  (331 of 467)
   *   Imperial Tropicals  45.6%  ( 88 of 193)
   *   J4 Flowerhorns      42.3%  ( 44 of 104)
   *
   * A store where seven of every ten species are carried by nobody else is an
   * aggregator of unusual stock, not a shelf.
   */
  'aquatic-arts': 'specialist',
  /**
   * LiveAquaria is Petco's aquatics brand, and a big-box chain stocking a fish
   * would be the strongest possible evidence it is not rare - which is exactly
   * why it is tempting to call it community. It is not, because it is
   * overwhelmingly MARINE: of 7,714 livestock listings, the resolved species
   * are dominated by coral and reef fish. A marine store's silence about a
   * freshwater fish is not evidence of anything, and counting it as a witness
   * would push every freshwater species toward "rare" on a technicality.
   *
   * Revisit if the index ever carries water type per species. Until then it
   * contributes price and proof-of-existence only.
   */
  'liveaquaria': 'specialist',
};
