/**
 * Logical data model - PRD section 6.
 *
 * The central modelling decision (PRD 3.4): Species, Specimen/group, Encounter,
 * Holding, Residency and Life event are SEPARATE records. A spreadsheet-style
 * "species in tank" row cannot preserve the product story by itself.
 */

// ---------------------------------------------------------------------------
// Identifiers and shared primitives
// ---------------------------------------------------------------------------

export type Id = string;

/** ISO-8601 instant, e.g. "2026-08-27T15:04:05.000Z". */
export type Instant = string;
/** ISO-8601 calendar date, e.g. "2026-08-27". Used where time of day is noise. */
export type CalendarDate = string;

export type LengthUnit = 'in' | 'cm';
export type VolumeUnit = 'gal' | 'l';
export type CurrencyCode = string;

export interface Measurement<U extends string> {
  value: number;
  unit: U;
  /** True when the user eyeballed it rather than measured it (FR-C05, FR-T07). */
  estimate?: boolean;
}

export type LengthMeasurement = Measurement<LengthUnit>;
export type VolumeMeasurement = Measurement<VolumeUnit>;

export interface Dimensions {
  length: LengthMeasurement;
  width: LengthMeasurement;
  height: LengthMeasurement;
}

/**
 * Provenance for any externally sourced fact. NFR-05 requires every computed
 * result to expose its sources; NFR-12 requires external sources to sit behind
 * replaceable adapters that retain attribution and source dates.
 */
export interface SourceRef {
  label: string;
  url?: string;
  retrievedAt: Instant;
  note?: string;
}

/** Local-first sync state. FR-C02, FR-C07, NFR-02. */
export type SyncState = 'local-draft' | 'uploading' | 'synced' | 'retry-required' | 'failed';

// ---------------------------------------------------------------------------
// User and place
// ---------------------------------------------------------------------------

/**
 * Account-level settings (spec 005 FR-A04).
 *
 * `muted` is deliberately absent: it is about the room a device is in, so it
 * stays device-local in localStorage. Everything here follows the keeper.
 */
export interface UserSettings {
  /** Active app theme token set (PRD 7.2/7.3). Narrowed by src/theme/resolve.ts. */
  themeId: string;
  /** Living Portrait surround (PRD 7.4). Independent of the app theme. */
  sceneId: string;
  /**
   * NFR-06 / FR-R04: the reveal ceremony must respect this. Account-level
   * because an accessibility need belongs to the person, not the device.
   */
  reducedMotion: boolean;
  /** FR-P01: the currency new price observations are recorded in. */
  currency: CurrencyCode;
  /**
   * Spec 014: how often photos sync on their own, in minutes. 0 is off.
   *
   * Optional so no migration is needed - a profile written before this
   * existed reads DEFAULT_SYNC_INTERVAL_MINUTES. Account-level rather than
   * per-device, alongside `currency`, because a sync cadence is about how the
   * collection is kept; `muted` is the counter-example and stays local
   * because it is about the room a device is in.
   */
  photoSyncMinutes?: number;
}

export interface User {
  id: Id;
  displayName: string;
  settings: UserSettings;
  createdAt: Instant;
}

export type PlaceType = 'fish-store' | 'chain-store' | 'aquarium' | 'expo' | 'home' | 'other';

/** NFR-04 / 8.2: exact store and home locations stay private. */
export type PlacePrivacy = 'private-exact' | 'private-coarse';

export interface Place {
  id: Id;
  name: string;
  branch?: string;
  type: PlaceType;
  /** Free-text coarse locality, e.g. "Chicago area". Safe to surface. */
  coarseLocation?: string;
  /**
   * Precise coordinates. Private, and never published (NFR-04).
   *
   * THIS USED TO SAY "never leaves the device in the MVP", which is a harder
   * constraint than any requirement actually imposes, and it nearly ruled out
   * private per-account sync in spec 005 on a rule that does not exist. NFR-04
   * is about PUBLICATION: "private by default; never publish exact home
   * location". Writing a place into the keeper's own private realm is not
   * publishing it to anyone.
   *
   * Still forbidden, and this is the part that matters: surfacing these
   * coordinates in anything another person can see - a shared card, an export
   * prepared for someone else, a community submission. Those get
   * `coarseLocation` or nothing at all (BUG-05).
   */
  exactLocation?: { lat: number; lon: number };
  privacy: PlacePrivacy;
  isFavorite: boolean;
  createdAt: Instant;
}

// ---------------------------------------------------------------------------
// Species and species profile
// ---------------------------------------------------------------------------

/**
 * Where a species record came from.
 *
 * Absent means the shipped catalog, which is every species the app seeds. A
 * `user-submitted` row is one a keeper typed in because the catalog had no
 * match, and it is deliberately NOT the same thing: it carries one person's
 * reading of a store tag, with no source behind it. The distinction is what
 * lets the app show it honestly and lets the review CLI find it.
 */
export type SpeciesOrigin = 'catalog' | 'user-submitted';

/**
 * The evidence behind a user-submitted species, kept so somebody can judge it.
 *
 * A submission without this is unreviewable - "Congo tetra" alone does not say
 * whether it was read off a tag, guessed, or mistyped. Every field here exists
 * to be shown to a human deciding whether it belongs in the shared catalog.
 */
export interface SpeciesSubmission {
  /** Exactly what the keeper typed, never cleaned up. */
  label: string;
  /** The specimen it was logged from, so the photo can be looked at. */
  specimenId?: Id;
  submittedAt: Instant;
  /** Anything the keeper added about where the name came from. */
  note?: string;
}

export interface Species {
  id: Id;
  commonName: string;
  scientificName?: string;
  /** Alternate trade names the store might use. Searchable (FR-I02). */
  aliases: string[];
  morph?: string;
  locality?: string;
  createdAt: Instant;
  /** Absent means the shipped catalog. See SpeciesOrigin. */
  origin?: SpeciesOrigin;
  /** Present only on a user-submitted row. */
  submission?: SpeciesSubmission;
}

export type AggressionRating = 'peaceful' | 'semi-aggressive' | 'aggressive' | 'highly-aggressive';

/**
 * The water an animal is sold to live in.
 *
 * A property of the trade rather than of the fish, and sourced that way: it
 * comes from what the vendors tag, never inferred from taxonomy. See
 * etl/normalize/water-type.ts for why inferring it would be the same invented
 * fact the aggression rating refuses to be.
 */
export type WaterType = 'freshwater' | 'brackish' | 'marine';
export type SocialNeed = 'solitary' | 'pair' | 'schooling' | 'shoaling' | 'colony' | 'territorial';
export type PredationTag =
  | 'piscivore'
  | 'fin-nipper'
  | 'invert-predator'
  | 'opportunistic'
  | 'ambush-predator';

export interface WaterRange {
  temperatureC?: { min: number; max: number };
  ph?: { min: number; max: number };
}

/**
 * The screening inputs for one species. Deliberately all-optional below the
 * identity fields: FR-E05 requires missing facts to produce "Not enough data"
 * rather than an inferred green result, so absence must be representable.
 */
export interface SpeciesProfile {
  id: Id;
  speciesId: Id;
  adultSize?: LengthMeasurement;
  /** Hard floor for a long-term adult home (PRD 5.1 "Minimum enclosure"). */
  minimumVolume?: VolumeMeasurement;
  minimumFootprint?: { length: LengthMeasurement; width: LengthMeasurement };
  aggression?: AggressionRating;
  water?: WaterRange;
  socialNeeds: SocialNeed[];
  predationTags: PredationTag[];
  /**
   * Largest prey-to-predator length ratio this species is known to swallow.
   * Drives the predation rule in PRD 5.1.
   */
  preySizeRatio?: number;
  sources: SourceRef[];
  /** Bumped whenever curated values change, so assessments stay traceable (NFR-09). */
  profileVersion: number;
  /** Conflicting sources must surface as a conflict, not a silent pick (edge cases, section 9). */
  conflictNotes?: string[];
  updatedAt: Instant;
}

// ---------------------------------------------------------------------------
// Specimen, encounter, media, identification
// ---------------------------------------------------------------------------

/** FR-I01. "Unknown" is a valid, saveable, permanent state (P6). */
export type IdentityStatus = 'unknown' | 'provisional' | 'user-confirmed';

/** PRD 6.1 specimen transitions. */
export type SpecimenStatus =
  | 'encountered'
  | 'considering'
  | 'reserved'
  | 'resident'
  | 'rehomed'
  | 'sold'
  | 'returned'
  | 'missing'
  | 'deceased';

export type SpecimenKind = 'individual' | 'group';

export interface Specimen {
  id: Id;
  kind: SpecimenKind;
  /** Verbatim store label. Never overwritten by an identification (FR-O05, FR-J04). */
  rawLabel?: string;
  /** Null until identified. FR-I01. */
  speciesId?: Id;
  identityStatus: IdentityStatus;
  /** Narrative name such as "the Panther" (FR-J04). */
  nickname?: string;
  status: SpecimenStatus;
  /** FR-R06: personal foil treatment, with an optional private reason. */
  golden?: { awardedAt: Instant; reason?: string };
  /** FR-R06 / 5.3: user-flagged unusually compelling individual. */
  exceptional?: boolean;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface Encounter {
  id: Id;
  specimenId: Id;
  placeId?: Id;
  /** Automatic but editable (FR-C03). */
  observedAt: Instant;
  quantitySeen?: number;
  observedSize?: LengthMeasurement;
  /** The label on the store's own tank, kept verbatim. */
  rawTankLabel?: string;
  /** Store co-housing. Explicitly NOT compatibility evidence (FR-T08). */
  observedTankmates?: string;
  originLocality?: string;
  notes?: string;
  createdAt: Instant;
  syncState: SyncState;
}

export type MediaKind = 'photo' | 'video' | 'audio';

export interface Media {
  id: Id;
  kind: MediaKind;
  /** One media item may link to several specimens (section 9, multi-species video). */
  specimenIds: Id[];
  encounterId?: Id;
  /** The untouched original. NFR-03: never silently downsampled or replaced. */
  originalBlobKey: string;
  originalBytes: number;
  mimeType: string;
  /** Compressed playback derivative; regenerable, never authoritative. */
  previewBlobKey?: string;
  thumbnailBlobKey?: string;
  durationSeconds?: number;
  capturedAt: Instant;
  syncState: SyncState;
  /** FR-J03: transcript is editable and its deletion never deletes the audio. */
  transcript?: { text: string; editedByUser: boolean; updatedAt: Instant };
}

export interface IdentificationAssertion {
  id: Id;
  specimenId: Id;
  candidateSpeciesId?: Id;
  /** Retained when the user typed a name that matched no species record. */
  candidateRawText?: string;
  source: 'user' | 'external-visual-search' | 'store-label' | 'import';
  /**
   * Only populated when a source actually supplies one. FR-I04 forbids
   * inventing a percentage for a manual confirmation.
   */
  confidence?: number;
  assertedAt: Instant;
  /** Superseded assertions are retained, never deleted (FR-I06, NFR-09). */
  supersededByAssertionId?: Id;
  note?: string;
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/** FR-C06 / FR-P04: a lot price cannot be compared per-fish without this. */
export type PriceBasis = 'each' | 'pair' | 'lot';

export interface PriceObservation {
  id: Id;
  specimenId?: Id;
  speciesId?: Id;
  encounterId?: Id;
  placeId?: Id;
  /** FR-P03: these three are separate facts and never overwrite one another. */
  askingPrice?: number;
  memberPrice?: number;
  paidPrice?: number;
  currency: CurrencyCode;
  basis: PriceBasis;
  /** How many fish the price covers. Required to normalize a pair/lot price. */
  packageQuantity: number;
  observedSize?: LengthMeasurement;
  observedAt: Instant;
  /** FR-P05: manual online comparisons carry shipping and a source URL. */
  online?: { sourceUrl?: string; shipping?: number; riskNote?: string };
  source: 'in-store' | 'online-manual' | 'import';
  note?: string;
}

// ---------------------------------------------------------------------------
// Collection: rarity and dream list
// ---------------------------------------------------------------------------

export type DiscoveryTier = 'familiar' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/**
 * What a reveal awarded, by component.
 *
 * As of formula v0.3.0 a new snapshot carries `marketScarcity` and nothing
 * else. The other four are OPTIONAL rather than deleted because snapshots are
 * immutable by requirement (FR-R05: "tuning never rewrites a historical reveal
 * snapshot"), so v0.2.0 records on the device still carry all five and still
 * have to render. Read the keys a snapshot actually has; never assume the set.
 */
export interface RarityComponentBreakdown {
  /**
   * Contribution from how hard the fish is to source from the tracked
   * vendors. The entire score as of v0.2.0 -> v0.3.0; see discovery-tier.ts.
   */
  marketScarcity: number;
  /** Retired in v0.3.0. Present on v0.1.0 and v0.2.0 snapshots. */
  firstConfirmedSpecies?: number;
  /** Retired in v0.3.0. Present on v0.1.0 and v0.2.0 snapshots. */
  dreamListHit?: number;
  /** Retired in v0.3.0. Present on v0.1.0 and v0.2.0 snapshots. */
  personalEncounterScarcity?: number;
  /** Retired in v0.3.0. Present on v0.1.0 and v0.2.0 snapshots. */
  exceptionalSpecimen?: number;
}

/**
 * Immutable reveal-day result. FR-E07 / 5.3: retuning weights must never
 * rewrite a historical reveal.
 */
export interface RaritySnapshot {
  id: Id;
  specimenId: Id;
  speciesId?: Id;
  components: RarityComponentBreakdown;
  totalScore: number;
  tier: DiscoveryTier;
  formulaVersion: string;
  golden: boolean;
  revealedAt: Instant;
}

export interface DreamListItem {
  id: Id;
  speciesId: Id;
  /** FR-R08: dream-list status must predate the encounter to score. */
  addedAt: Instant;
  source: 'search' | 'collection-browse' | 'manual';
  notes?: string;
  /** Set when an encounter finally fulfils it; the item is not deleted. */
  fulfilledBySpecimenId?: Id;
}

// ---------------------------------------------------------------------------
// Tanks, holdings, residency, lifecycle
// ---------------------------------------------------------------------------

export type AquariumStatus = 'planned' | 'active' | 'retired';
export type AquariumKind = 'display' | 'tote' | 'quarantine' | 'grow-out' | 'pond' | 'virtual';
/** FR-E06 / 5.1: user-set, never a fabricated bioload calculation. */
export type StockingState = 'low' | 'moderate' | 'crowded';

export interface Aquarium {
  id: Id;
  name: string;
  kind: AquariumKind;
  volume?: VolumeMeasurement;
  dimensions?: Dimensions;
  status: AquariumStatus;
  stockingState?: StockingState;
  water?: WaterRange;
  photoMediaId?: Id;
  notes?: string;
  createdAt: Instant;
}

export interface Holding {
  id: Id;
  /** Null for opening-balance rows imported without an encounter (FR-T02). */
  specimenId?: Id;
  speciesId?: Id;
  /** Preserved verbatim from the source spreadsheet (FR-O05, 6.2). */
  rawLabel?: string;
  kind: SpecimenKind;
  /** Derived from life events; see deriveQuantity(). */
  openingQuantity: number;
  category?: string;
  /** True when created by inventory import rather than a tracked acquisition. */
  openingBalance: boolean;
  notes?: string;
  createdAt: Instant;
}

/** FR-T03: a move closes one interval and opens another. Never a single tank field. */
export interface Residency {
  id: Id;
  holdingId: Id;
  aquariumId: Id;
  startDate: CalendarDate;
  /** Null while the holding currently lives here. */
  endDate?: CalendarDate;
  note?: string;
}

/** FR-T05. */
export type LifeEventType =
  | 'opening-balance'
  | 'reserved'
  | 'acquired'
  | 'quantity-adjusted'
  | 'birth'
  | 'moved'
  | 'rehomed'
  | 'sold'
  | 'returned'
  | 'missing'
  | 'escaped'
  | 'deceased';

export interface LifeEvent {
  id: Id;
  holdingId: Id;
  type: LifeEventType;
  occurredOn: CalendarDate;
  /** Signed change to the holding's live count. 0 for non-quantity events. */
  quantityDelta: number;
  fromAquariumId?: Id;
  toAquariumId?: Id;
  notes?: string;
  createdAt: Instant;
}

// ---------------------------------------------------------------------------
// Compatibility assessment
// ---------------------------------------------------------------------------

/** PRD 5.2 verdict scale. Ordered least to most severe; "insufficient" is separate. */
export type Verdict = 'suitable' | 'conditional' | 'high-risk' | 'extreme-risk' | 'insufficient-data';

export type FactorId =
  | 'minimum-enclosure'
  | 'adult-size'
  | 'aggression'
  | 'predation'
  | 'water-overlap'
  | 'social-needs'
  | 'crowding';

export interface FactorResult {
  factor: FactorId;
  verdict: Verdict;
  /** Human-readable reason. Empty for a clean pass. */
  reason?: string;
  /** FR-E04: exactly which stored values produced this outcome. */
  inputsUsed: Array<{ label: string; value: string }>;
  /** FR-E05: what is missing, when the factor could not be evaluated. */
  missingInputs: string[];
  /** Residents implicated, for pairwise factors. */
  relatedHoldingIds?: Id[];
}

/**
 * Immutable snapshot. FR-E07: a rerun creates a new one; the encounter-day
 * result stays readable forever.
 */
export interface CompatibilityAssessment {
  id: Id;
  specimenId: Id;
  aquariumId: Id;
  verdict: Verdict;
  /** FR-E03: the long-term adult result is the headline. */
  headline: string;
  /** FR-E03: shown only as visibly secondary, and time-bounded. */
  temporaryJuvenileFit?: { verdict: Verdict; note: string };
  factors: FactorResult[];
  missingInputs: string[];
  rulesVersion: string;
  assessedAt: Instant;
  /** FR-E08: an override records a decision without erasing the calculated risk. */
  userOverride?: { decision: string; reason: string; overriddenAt: Instant };
}

// ---------------------------------------------------------------------------
// Legacy: Fish Heaven and Keeper's Code
// ---------------------------------------------------------------------------

export type CauseConfidence = 'unknown' | 'suspected' | 'likely' | 'confirmed';

export interface Memorial {
  id: Id;
  holdingId: Id;
  specimenId?: Id;
  occurredOn: CalendarDate;
  quantity: number;
  story?: string;
  /** FR-L02: several possibilities are valid; there is no required diagnosis. */
  suspectedContributors: string[];
  causeConfidence: CauseConfidence;
  lesson?: string;
  keeperPrincipleId?: Id;
  createdAt: Instant;
}

export interface KeeperPrinciple {
  id: Id;
  text: string;
  /** FR-L04: links back to the fish that inspired it. */
  sourceMemorialId?: Id;
  sourceSpecimenId?: Id;
  createdAt: Instant;
}
