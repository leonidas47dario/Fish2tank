/**
 * Curated MVP species catalog.
 *
 * PRD 12 names care-data quality as a top risk: "No single authoritative
 * source covers minimum tank and aggression consistently. Mitigation: curate a
 * small sourced catalog, version rules, expose conflicts."
 *
 * PROVENANCE - READ BEFORE TRUSTING THESE NUMBERS. Every value below is
 * general freshwater hobbyist consensus, entered by hand to make the MVP
 * demonstrable. None of it has been checked against a licensed care database,
 * and no citation URL is attached because none was consulted. Each profile
 * therefore carries a SourceRef that says exactly that, and the UI surfaces
 * it, because PRD principle P6 ("Unknown is an honest answer") and NFR-05
 * ("every computed result exposes sources") make an invented citation worse
 * than an admitted gap.
 *
 * PRD 12.1 leaves "species-care sources" an explicitly open decision. Choosing
 * one and re-verifying every row here is a prerequisite for real use.
 */
import type { Species, SpeciesProfile } from '@/domain/types';

const SEEDED_AT = '2026-08-27T00:00:00.000Z';

const UNVERIFIED = {
  label: 'MVP seed value - general hobbyist consensus, NOT verified against a licensed care source',
  retrievedAt: SEEDED_AT,
  note: 'Replace before relying on any verdict. See PRD 12.1, "Species-care sources".',
};

export interface CatalogEntry {
  species: Species;
  profile: SpeciesProfile;
}

function entry(
  id: string,
  commonName: string,
  scientificName: string,
  aliases: string[],
  profile: Omit<SpeciesProfile, 'id' | 'speciesId' | 'sources' | 'profileVersion' | 'updatedAt'>,
): CatalogEntry {
  return {
    species: { id, commonName, scientificName, aliases, createdAt: SEEDED_AT },
    profile: {
      id: `prof_${id}`,
      speciesId: id,
      sources: [UNVERIFIED],
      profileVersion: 1,
      updatedAt: SEEDED_AT,
      ...profile,
    },
  };
}

export const SPECIES_CATALOG: CatalogEntry[] = [
  // The Panther. PRD section 10 acceptance scenario.
  entry('sp_jaguar_cichlid', 'Jaguar Cichlid', 'Parachromis managuensis',
    ['Managuense', 'Managuense Cichlid', 'Jaguar', 'Aztec Cichlid', 'Guapote Tigre'], {
    adultSize: { value: 14, unit: 'in' },
    minimumVolume: { value: 125, unit: 'gal' },
    minimumFootprint: { length: { value: 72, unit: 'in' }, width: { value: 18, unit: 'in' } },
    aggression: 'highly-aggressive',
    water: { temperatureC: { min: 25, max: 30 }, ph: { min: 7, max: 8.7 } },
    socialNeeds: ['territorial', 'pair'],
    predationTags: ['piscivore', 'opportunistic'],
    preySizeRatio: 0.45,
  }),

  // The FR-I06 correction example: "changing jaguar cichlid to dovii".
  entry('sp_wolf_cichlid', 'Wolf Cichlid', 'Parachromis dovii',
    ['Dovii', 'Guapote', 'Rainbow Bass'], {
    adultSize: { value: 24, unit: 'in' },
    minimumVolume: { value: 240, unit: 'gal' },
    minimumFootprint: { length: { value: 96, unit: 'in' }, width: { value: 24, unit: 'in' } },
    aggression: 'highly-aggressive',
    water: { temperatureC: { min: 24, max: 29 } },
    socialNeeds: ['territorial', 'solitary'],
    predationTags: ['piscivore', 'ambush-predator'],
    preySizeRatio: 0.5,
  }),

  entry('sp_senegal_bichir', 'Senegal Bichir', 'Polypterus senegalus',
    ['Dinosaur Eel', 'Dinosaur Bichir', 'Cuvier Bichir'], {
    adultSize: { value: 12, unit: 'in' },
    minimumVolume: { value: 90, unit: 'gal' },
    aggression: 'semi-aggressive',
    water: { temperatureC: { min: 24, max: 29 } },
    socialNeeds: [],
    predationTags: ['piscivore', 'ambush-predator', 'invert-predator'],
    preySizeRatio: 0.4,
  }),

  entry('sp_common_pleco', 'Common Pleco', 'Pterygoplichthys pardalis',
    ['Sailfin Pleco', 'Janitor Fish', 'Plec'], {
    adultSize: { value: 18, unit: 'in' },
    minimumVolume: { value: 125, unit: 'gal' },
    aggression: 'peaceful',
    water: { temperatureC: { min: 23, max: 28 } },
    socialNeeds: ['territorial'],
    predationTags: [],
  }),

  entry('sp_neon_tetra', 'Neon Tetra', 'Paracheirodon innesi', ['Neon'], {
    adultSize: { value: 1.5, unit: 'in' },
    minimumVolume: { value: 10, unit: 'gal' },
    aggression: 'peaceful',
    water: { temperatureC: { min: 20, max: 26 } },
    socialNeeds: ['schooling'],
    predationTags: [],
  }),

  entry('sp_bumblebee_goby', 'Bumblebee Goby', 'Brachygobius doriae', ['Bumble Bee Goby'], {
    adultSize: { value: 1.5, unit: 'in' },
    minimumVolume: { value: 10, unit: 'gal' },
    aggression: 'peaceful',
    water: { temperatureC: { min: 24, max: 30 } },
    socialNeeds: ['shoaling', 'territorial'],
    predationTags: [],
  }),

  // For the "Bass Tote" enclosure label in the source inventory.
  entry('sp_largemouth_bass', 'Largemouth Bass', 'Micropterus salmoides', ['Bass', 'LMB'], {
    adultSize: { value: 20, unit: 'in' },
    minimumVolume: { value: 300, unit: 'gal' },
    aggression: 'aggressive',
    water: { temperatureC: { min: 10, max: 27 } },
    socialNeeds: [],
    predationTags: ['piscivore', 'ambush-predator', 'invert-predator'],
    preySizeRatio: 0.5,
  }),
];

export const CATALOG_BY_ID = new Map(SPECIES_CATALOG.map((e) => [e.species.id, e]));
