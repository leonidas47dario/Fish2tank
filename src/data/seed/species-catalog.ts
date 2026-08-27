/**
 * Curated MVP species catalog, covering the real inventory.
 *
 * PROVENANCE. Per the product owner's decision, Wikipedia is the approved
 * PLACEHOLDER source until a licensed care database is chosen (PRD 12.1,
 * "Species-care sources"). Each profile therefore carries a real Wikipedia URL
 * and a note saying plainly that it is a placeholder.
 *
 * Read this before trusting a verdict:
 *   - Wikipedia species articles are strong on taxonomy and adult size, and
 *     THIN on the things this engine actually screens on - minimum tank
 *     volume, aggression rating, and prey-size behaviour. Those fields are
 *     conventional hobbyist consensus, not sourced from the linked article.
 *   - PRD 12 names exactly this as a top risk: "No single authoritative source
 *     covers minimum tank and aggression consistently."
 *   - Where a label in the inventory is genuinely ambiguous, NO entry is added
 *     here. The importer then leaves it unresolved and screening returns
 *     "Not enough data" (FR-O05, FR-E05). That is the correct outcome, not a
 *     gap to be filled with a guess.
 *
 * Aliases include the exact label used in the source inventory so that the
 * importer's exact-match rule resolves it without fuzzy guessing.
 */
import type { Species, SpeciesProfile } from '@/domain/types';

const SEEDED_AT = '2026-08-27T00:00:00.000Z';

const WIKI = 'https://en.wikipedia.org/wiki/';

function placeholderSource(article: string) {
  return {
    label: `Wikipedia: ${article.replace(/_/g, ' ')} — PLACEHOLDER source`,
    url: WIKI + article,
    retrievedAt: SEEDED_AT,
    note:
      'Taxonomy and adult size follow the article. Minimum volume, aggression ' +
      'and prey-size values are hobbyist consensus and are NOT sourced from it. ' +
      'Replace when a licensed care source is chosen (PRD 12.1).',
  };
}

export interface CatalogEntry {
  species: Species;
  profile: SpeciesProfile;
}

type ProfileFields = Omit<SpeciesProfile, 'id' | 'speciesId' | 'sources' | 'profileVersion' | 'updatedAt'>;

function entry(
  id: string,
  commonName: string,
  scientificName: string | undefined,
  aliases: string[],
  article: string | undefined,
  profile: ProfileFields,
): CatalogEntry {
  return {
    species: { id, commonName, scientificName, aliases, createdAt: SEEDED_AT },
    profile: {
      id: `prof_${id}`,
      speciesId: id,
      sources: article ? [placeholderSource(article)] : [{
        label: 'Hobby-trade hybrid with no species article — hobbyist consensus only',
        retrievedAt: SEEDED_AT,
        note: 'No taxonomic source exists for a man-made hybrid. Treat every value as provisional.',
      }],
      profileVersion: 2,
      updatedAt: SEEDED_AT,
      ...profile,
    },
  };
}

const inches = (value: number) => ({ value, unit: 'in' as const });
const gal = (value: number) => ({ value, unit: 'gal' as const });
const temp = (min: number, max: number) => ({ temperatureC: { min, max } });

export const SPECIES_CATALOG: CatalogEntry[] = [
  // ---------------------------------------------------------------------
  // The Panther, and the correction example from FR-I06
  // ---------------------------------------------------------------------
  entry('sp_jaguar_cichlid', 'Jaguar Cichlid', 'Parachromis managuensis',
    ['Managuense', 'Managuense Cichlid', 'Jaguar', 'Aztec Cichlid', 'Guapote Tigre'], 'Parachromis_managuensis', {
    adultSize: inches(14), minimumVolume: gal(125),
    minimumFootprint: { length: inches(72), width: inches(18) },
    aggression: 'highly-aggressive', water: temp(25, 30),
    socialNeeds: ['territorial', 'pair'], predationTags: ['piscivore', 'opportunistic'], preySizeRatio: 0.45,
  }),
  entry('sp_wolf_cichlid', 'Wolf Cichlid', 'Parachromis dovii', ['Dovii', 'Guapote', 'Rainbow Bass'], 'Parachromis_dovii', {
    adultSize: inches(24), minimumVolume: gal(240),
    minimumFootprint: { length: inches(96), width: inches(24) },
    aggression: 'highly-aggressive', water: temp(24, 29),
    socialNeeds: ['territorial', 'solitary'], predationTags: ['piscivore', 'ambush-predator'], preySizeRatio: 0.5,
  }),

  // ---------------------------------------------------------------------
  // 75G residents
  // ---------------------------------------------------------------------
  entry('sp_green_severum', 'Green Severum', 'Heros severus', ['Severum', 'Banded Cichlid'], 'Heros_severus', {
    adultSize: inches(8), minimumVolume: gal(55), aggression: 'semi-aggressive', water: temp(24, 29),
    socialNeeds: ['pair'], predationTags: [],
  }),
  entry('sp_super_red_severum', 'Super Red Severum', 'Heros sp.', ['Red Severum'], 'Heros_(genus)', {
    adultSize: inches(8), minimumVolume: gal(55), aggression: 'semi-aggressive', water: temp(24, 29),
    socialNeeds: ['pair'], predationTags: [],
  }),
  entry('sp_pinktail_chalceus', 'Pinktail Chalceus', 'Chalceus macrolepidotus', ['Pink Tail Chalceus'], 'Chalceus_macrolepidotus', {
    adultSize: inches(10), minimumVolume: gal(125),
    minimumFootprint: { length: inches(60), width: inches(18) },
    aggression: 'semi-aggressive', water: temp(23, 28),
    socialNeeds: ['shoaling'], predationTags: ['opportunistic'], preySizeRatio: 0.3,
  }),
  entry('sp_wolf_fish', 'Wolf Fish', 'Hoplias malabaricus', ['Trahira', 'Tiger Wolf Fish'], 'Hoplias_malabaricus', {
    adultSize: inches(20), minimumVolume: gal(125),
    minimumFootprint: { length: inches(72), width: inches(24) },
    aggression: 'highly-aggressive', water: temp(22, 28),
    socialNeeds: ['solitary'], predationTags: ['piscivore', 'ambush-predator'], preySizeRatio: 0.5,
  }),
  entry('sp_freshwater_needlefish', 'Giant Needlefish', 'Xenentodon cancila',
    ['Freshwater Garfish', 'Needlefish', 'Asian Needlefish'], 'Xenentodon_cancila', {
    adultSize: inches(12), minimumVolume: gal(75),
    minimumFootprint: { length: inches(48), width: inches(18) },
    aggression: 'semi-aggressive', water: temp(22, 28),
    socialNeeds: ['shoaling'], predationTags: ['piscivore', 'ambush-predator'], preySizeRatio: 0.3,
  }),
  entry('sp_rocket_gar', 'Rocket Gar', 'Ctenolucius hujeta', ['Hujeta Gar', 'Freshwater Barracuda', 'Gar Characin'], 'Ctenolucius_hujeta', {
    adultSize: inches(10), minimumVolume: gal(75), aggression: 'semi-aggressive', water: temp(23, 28),
    socialNeeds: ['shoaling'], predationTags: ['piscivore', 'ambush-predator'], preySizeRatio: 0.35,
  }),
  entry('sp_kissing_gourami', 'Kissing Gourami', 'Helostoma temminckii', ['Kisser Fish'], 'Kissing_gourami', {
    adultSize: inches(12), minimumVolume: gal(75), aggression: 'semi-aggressive', water: temp(22, 28),
    socialNeeds: [], predationTags: [],
  }),
  entry('sp_geophagus_sveni', 'Geophagus sveni', 'Geophagus sveni', ['Sveni Eartheater'], 'Geophagus', {
    adultSize: inches(10), minimumVolume: gal(75), aggression: 'peaceful', water: temp(26, 30),
    socialNeeds: ['shoaling'], predationTags: [],
  }),
  entry('sp_geophagus_tapajos', 'Geophagus (Tapajos type)', 'Geophagus sp.', ['Red Head Tapajos'], 'Geophagus', {
    adultSize: inches(8), minimumVolume: gal(75), aggression: 'peaceful', water: temp(26, 30),
    socialNeeds: ['shoaling'], predationTags: [],
  }),
  entry('sp_ropefish', 'Ropefish', 'Erpetoichthys calabaricus', ['Reedfish', 'Snakefish'], 'Reedfish', {
    adultSize: inches(15), minimumVolume: gal(50), aggression: 'peaceful', water: temp(22, 28),
    socialNeeds: ['shoaling'], predationTags: ['invert-predator', 'opportunistic'], preySizeRatio: 0.15,
  }),
  entry('sp_senegal_bichir', 'Senegal Bichir', 'Polypterus senegalus', ['Dinosaur Eel', 'Dinosaur Bichir', 'Cuvier Bichir'], 'Polypterus_senegalus', {
    adultSize: inches(12), minimumVolume: gal(90), aggression: 'semi-aggressive', water: temp(24, 29),
    socialNeeds: [], predationTags: ['piscivore', 'ambush-predator', 'invert-predator'], preySizeRatio: 0.4,
  }),
  entry('sp_jack_dempsey', 'Jack Dempsey', 'Rocio octofasciata', ['Dempsey'], 'Jack_Dempsey_(fish)', {
    adultSize: inches(8), minimumVolume: gal(55), aggression: 'aggressive', water: temp(22, 30),
    socialNeeds: ['territorial', 'pair'], predationTags: ['opportunistic'], preySizeRatio: 0.25,
  }),
  entry('sp_tire_track_eel', 'Tire Track Eel', 'Mastacembelus favus', ['Tyre Track Eel', 'Zig-Zag Eel'], 'Mastacembelus_favus', {
    adultSize: inches(20), minimumVolume: gal(125),
    minimumFootprint: { length: inches(60), width: inches(18) },
    aggression: 'semi-aggressive', water: temp(24, 28),
    socialNeeds: [], predationTags: ['invert-predator', 'opportunistic'], preySizeRatio: 0.2,
  }),
  entry('sp_cuckoo_catfish', 'Cuckoo Catfish', 'Synodontis multipunctatus', ['Multipunctatus', 'Cuckoo Synodontis'], 'Synodontis_multipunctatus', {
    adultSize: inches(5), minimumVolume: gal(55), aggression: 'semi-aggressive', water: temp(24, 28),
    socialNeeds: ['shoaling'], predationTags: [],
  }),
  entry('sp_electric_blue_acara', 'Electric Blue Acara', 'Andinoacara pulcher', ['Blue Acara', 'EBA'], 'Andinoacara_pulcher', {
    adultSize: inches(6), minimumVolume: gal(40), aggression: 'semi-aggressive', water: temp(22, 28),
    socialNeeds: ['pair'], predationTags: [],
  }),
  entry('sp_raphael_catfish', 'Raphael Catfish', 'Platydoras armatulus',
    ['Striped Raphael', 'Talking Catfish', 'Raphael catfish (large)'], 'Platydoras_armatulus', {
    adultSize: inches(9), minimumVolume: gal(55), aggression: 'peaceful', water: temp(24, 30),
    socialNeeds: [], predationTags: ['opportunistic'], preySizeRatio: 0.15,
  }),
  entry('sp_snakehead_gudgeon', 'Snakehead Gudgeon', 'Giuris margaritacea',
    ['Snakehead gudgeon', 'Spangled Gudgeon'], 'Giuris_margaritacea', {
    adultSize: inches(12), minimumVolume: gal(75), aggression: 'aggressive', water: temp(22, 28),
    socialNeeds: ['territorial'], predationTags: ['piscivore', 'ambush-predator'], preySizeRatio: 0.4,
  }),

  // ---------------------------------------------------------------------
  // Predator Tank
  // ---------------------------------------------------------------------
  entry('sp_largemouth_bass', 'Largemouth Bass', 'Micropterus salmoides', ['Bass', 'LMB'], 'Largemouth_bass', {
    adultSize: inches(20), minimumVolume: gal(300),
    minimumFootprint: { length: inches(96), width: inches(30) },
    aggression: 'aggressive', water: temp(10, 27),
    socialNeeds: [], predationTags: ['piscivore', 'ambush-predator', 'invert-predator'], preySizeRatio: 0.5,
  }),
  entry('sp_congo_puffer', 'Congo Puffer', 'Tetraodon miurus', ['Potato Puffer'], 'Tetraodon_miurus', {
    adultSize: inches(6), minimumVolume: gal(30), aggression: 'aggressive', water: temp(24, 28),
    socialNeeds: ['solitary'], predationTags: ['ambush-predator', 'fin-nipper', 'invert-predator'], preySizeRatio: 0.5,
  }),
  entry('sp_ornate_bichir', 'Ornate Bichir', 'Polypterus ornatipinnis', ['Ornate bichir'], 'Polypterus_ornatipinnis', {
    adultSize: inches(15), minimumVolume: gal(125), aggression: 'semi-aggressive', water: temp(24, 29),
    socialNeeds: [], predationTags: ['piscivore', 'ambush-predator', 'invert-predator'], preySizeRatio: 0.4,
  }),
  entry('sp_delhezi_bichir', 'Delhezi Bichir', 'Polypterus delhezi', ['Barred Bichir', 'Delhezi bichir'], 'Polypterus_delhezi', {
    adultSize: inches(14), minimumVolume: gal(90), aggression: 'semi-aggressive', water: temp(24, 29),
    socialNeeds: [], predationTags: ['piscivore', 'ambush-predator', 'invert-predator'], preySizeRatio: 0.4,
  }),
  entry('sp_teugelsi_bichir', 'Teugelsi Bichir', 'Polypterus teugelsi', ['Teugelsi bichir'], 'Polypterus_teugelsi', {
    adultSize: inches(16), minimumVolume: gal(125), aggression: 'semi-aggressive', water: temp(24, 29),
    socialNeeds: [], predationTags: ['piscivore', 'ambush-predator', 'invert-predator'], preySizeRatio: 0.4,
  }),
  entry('sp_true_parrot_cichlid', 'True Parrot Cichlid', 'Hoplarchus psittacus', ['Psittacus'], 'Hoplarchus_psittacus', {
    adultSize: inches(14), minimumVolume: gal(125), aggression: 'semi-aggressive', water: temp(26, 30),
    socialNeeds: ['pair', 'territorial'], predationTags: ['opportunistic'], preySizeRatio: 0.25,
  }),
  entry('sp_golden_wonder_killifish', 'Golden Wonder Killifish', 'Aplocheilus lineatus', ['Striped Panchax', 'Golden wonder killifish'], 'Aplocheilus_lineatus', {
    adultSize: inches(4), minimumVolume: gal(20), aggression: 'semi-aggressive', water: temp(22, 28),
    socialNeeds: [], predationTags: ['opportunistic'], preySizeRatio: 0.3,
  }),
  entry('sp_indian_sun_catfish', 'Indian Sun Catfish', 'Horabagrus brachysoma', ['Sun Catfish', 'Günther’s Catfish'], 'Horabagrus_brachysoma', {
    adultSize: inches(12), minimumVolume: gal(90), aggression: 'semi-aggressive', water: temp(22, 28),
    socialNeeds: [], predationTags: ['piscivore', 'opportunistic'], preySizeRatio: 0.35,
  }),
  entry('sp_banjo_catfish', 'Banjo Catfish', 'Bunocephalus coracoideus', ['Guitarrita'], 'Bunocephalus_coracoideus', {
    adultSize: inches(5), minimumVolume: gal(20), aggression: 'peaceful', water: temp(21, 28),
    socialNeeds: [], predationTags: [],
  }),
  entry('sp_albino_clawed_frog', 'African Clawed Frog', 'Xenopus laevis', ['Albino clawed frog', 'Clawed Frog'], 'African_clawed_frog', {
    adultSize: inches(5), minimumVolume: gal(20), aggression: 'semi-aggressive', water: temp(18, 26),
    socialNeeds: [], predationTags: ['opportunistic', 'invert-predator'], preySizeRatio: 0.4,
  }),

  // ---------------------------------------------------------------------
  // Quarantine, Mini Tank, Breeder Tote
  // ---------------------------------------------------------------------
  entry('sp_flowerhorn', 'Flowerhorn', undefined, ['Flowerhorn (juvenile)', 'Flowerhorn Cichlid'], undefined, {
    adultSize: inches(12), minimumVolume: gal(75), aggression: 'highly-aggressive', water: temp(26, 30),
    socialNeeds: ['solitary', 'territorial'], predationTags: ['opportunistic'], preySizeRatio: 0.3,
  }),
  entry('sp_king_kong_parrot', 'King Kong Parrot', undefined, ['King Kong parrot', 'Blood Parrot'], undefined, {
    adultSize: inches(8), minimumVolume: gal(55), aggression: 'semi-aggressive', water: temp(24, 30),
    socialNeeds: ['territorial'], predationTags: [],
  }),
  entry('sp_knight_goby', 'Knight Goby', 'Stigmatogobius sadanundio', ['Knight goby'], 'Stigmatogobius_sadanundio', {
    adultSize: inches(3), minimumVolume: gal(20), aggression: 'semi-aggressive', water: temp(22, 28),
    socialNeeds: ['territorial'], predationTags: [],
  }),
  entry('sp_freshwater_butterflyfish', 'Butterfly Fish', 'Pantodon buchholzi', ['Butterfly fish', 'Freshwater Butterflyfish'], 'Pantodon', {
    adultSize: inches(4), minimumVolume: gal(30), aggression: 'semi-aggressive', water: temp(23, 30),
    socialNeeds: [], predationTags: ['opportunistic'], preySizeRatio: 0.3,
  }),
  entry('sp_guppy', 'Fancy Guppy', 'Poecilia reticulata', ['Guppy', 'Feeder guppy', 'Millionfish'], 'Guppy', {
    adultSize: inches(2), minimumVolume: gal(10), aggression: 'peaceful', water: temp(22, 28),
    socialNeeds: ['shoaling'], predationTags: [],
  }),
  entry('sp_peacock_gudgeon', 'Peacock Gudgeon', 'Tateurndina ocellicauda', ['Peacock Goby'], 'Tateurndina', {
    adultSize: inches(3), minimumVolume: gal(15), aggression: 'peaceful', water: temp(22, 28),
    socialNeeds: ['pair'], predationTags: [],
  }),
  entry('sp_empire_gudgeon', 'Empire Gudgeon', 'Hypseleotris compressa', ['Empire gudgeon'], 'Hypseleotris_compressa', {
    adultSize: inches(4), minimumVolume: gal(20), aggression: 'peaceful', water: temp(20, 28),
    socialNeeds: ['shoaling'], predationTags: [],
  }),
  entry('sp_betta', 'Betta', 'Betta splendens', ['Siamese Fighting Fish'], 'Siamese_fighting_fish', {
    adultSize: inches(3), minimumVolume: gal(5), aggression: 'semi-aggressive', water: temp(24, 30),
    socialNeeds: ['solitary', 'territorial'], predationTags: ['fin-nipper'],
  }),
  entry('sp_panda_cory', 'Panda Cory', 'Corydoras panda', ['Panda Corydoras'], 'Corydoras_panda', {
    adultSize: inches(2), minimumVolume: gal(20), aggression: 'peaceful', water: temp(20, 26),
    socialNeeds: ['schooling'], predationTags: [],
  }),
  entry('sp_bristlenose_pleco', 'Bristlenose Pleco', 'Ancistrus cirrhosus',
    ['Bushynose Pleco', 'Lemon eye bristlenose pleco', 'Zebra bristlenose pleco', 'Albino bristlenose pleco (giant)'], 'Ancistrus', {
    adultSize: inches(5), minimumVolume: gal(30), aggression: 'peaceful', water: temp(22, 28),
    socialNeeds: ['territorial'], predationTags: [],
  }),
  entry('sp_common_pleco', 'Common Pleco', 'Pterygoplichthys pardalis', ['Sailfin Pleco', 'Janitor Fish', 'Plec'], 'Pterygoplichthys_pardalis', {
    adultSize: inches(18), minimumVolume: gal(125), aggression: 'peaceful', water: temp(23, 28),
    socialNeeds: ['territorial'], predationTags: [],
  }),
  entry('sp_hillstream_loach', 'Hillstream Loach', 'Sewellia lineolata', ['Reticulated Hillstream Loach', 'Hillstream loach'], 'Sewellia_lineolata', {
    adultSize: inches(3), minimumVolume: gal(20), aggression: 'peaceful', water: temp(20, 24),
    socialNeeds: ['shoaling'], predationTags: [],
  }),
  entry('sp_neon_tetra', 'Neon Tetra', 'Paracheirodon innesi', ['Neon'], 'Neon_tetra', {
    adultSize: inches(1.5), minimumVolume: gal(10), aggression: 'peaceful', water: temp(20, 26),
    socialNeeds: ['schooling'], predationTags: [],
  }),
  entry('sp_bumblebee_goby', 'Bumblebee Goby', 'Brachygobius doriae', ['Bumble Bee Goby'], 'Brachygobius', {
    adultSize: inches(1.5), minimumVolume: gal(10), aggression: 'peaceful', water: temp(24, 30),
    socialNeeds: ['shoaling', 'territorial'], predationTags: [],
  }),

  // ---------------------------------------------------------------------
  // Inverts
  // ---------------------------------------------------------------------
  entry('sp_bamboo_shrimp', 'Bamboo Shrimp', 'Atyopsis moluccensis', ['Wood Shrimp', 'Filter Shrimp'], 'Atyopsis_moluccensis', {
    adultSize: inches(3), minimumVolume: gal(20), aggression: 'peaceful', water: temp(23, 28),
    socialNeeds: ['shoaling'], predationTags: [],
  }),
  entry('sp_vampire_shrimp', 'Vampire Shrimp', 'Atya gabonensis', ['African Filter Shrimp', 'Viper Shrimp'], 'Atya_gabonensis', {
    adultSize: inches(6), minimumVolume: gal(30), aggression: 'peaceful', water: temp(23, 29),
    socialNeeds: [], predationTags: [],
  }),
  entry('sp_malaysian_trumpet_snail', 'Malaysian Trumpet Snail', 'Melanoides tuberculata', ['MTS', 'Malaysian trumpet snail'], 'Melanoides_tuberculata', {
    adultSize: inches(1), minimumVolume: gal(5), aggression: 'peaceful', water: temp(20, 30),
    socialNeeds: ['colony'], predationTags: [],
  }),
  entry('sp_vampire_crab', 'Vampire Crab', 'Geosesarma dennerle', ['Vampire crab'], 'Geosesarma', {
    adultSize: inches(1), minimumVolume: gal(10), aggression: 'peaceful', water: temp(23, 28),
    socialNeeds: ['colony'], predationTags: [],
  }),
];

export const CATALOG_BY_ID = new Map(SPECIES_CATALOG.map((e) => [e.species.id, e]));

/**
 * Labels in the source inventory that are deliberately NOT in the catalog.
 *
 * Each is genuinely ambiguous: an unclear ID the keeper already flagged, a
 * genus without a species, or a trade name that maps to several fish. Adding a
 * guess here would be the single easiest way to make this app dishonest, so
 * they stay unresolved and screening says so.
 */
export const DELIBERATELY_UNRESOLVED = [
  'Deinoi (unclear ID)',
  'Neobasher (unclear ID)',
  'Rare cory (unknown)',
  'Severum (unspecified)',
  'Striped cory',
  'Spiny eel (large)',
  'Neon striped goby',
  'White cheek goby',
  'Ornate goby',
  'Gold snail',
  'Horned nerite snail',
] as const;
