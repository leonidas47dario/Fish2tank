/** Test fixtures for the compatibility engine. Not shipped in the app bundle. */
import type { Aquarium, Species, SpeciesProfile } from '@/domain/types';
import type { CandidateInput, ResidentInput, TankInput } from './engine';

const NOW = '2026-08-27T15:00:00.000Z';

export function species(id: string, commonName: string, scientificName?: string): Species {
  return { id, commonName, scientificName, aliases: [], createdAt: NOW };
}

/**
 * A profile with every screening input present. Individual tests strip fields
 * to exercise the missing-data paths, which keeps each test's intent obvious.
 */
export function profile(speciesId: string, over: Partial<SpeciesProfile> = {}): SpeciesProfile {
  return {
    id: `prof_${speciesId}`,
    speciesId,
    adultSize: { value: 4, unit: 'in' },
    minimumVolume: { value: 20, unit: 'gal' },
    aggression: 'peaceful',
    water: { temperatureC: { min: 22, max: 27 } },
    socialNeeds: [],
    predationTags: [],
    sources: [{ label: 'test fixture', retrievedAt: NOW }],
    profileVersion: 1,
    updatedAt: NOW,
    ...over,
  };
}

export function aquarium(over: Partial<Aquarium> = {}): Aquarium {
  return {
    id: 'tank_75g',
    name: '75G',
    kind: 'display',
    volume: { value: 75, unit: 'gal' },
    dimensions: {
      length: { value: 48, unit: 'in' },
      width: { value: 18, unit: 'in' },
      height: { value: 21, unit: 'in' },
    },
    status: 'active',
    stockingState: 'moderate',
    water: { temperatureC: { min: 24, max: 27 } },
    createdAt: NOW,
    ...over,
  };
}

export function candidate(over: Partial<CandidateInput> = {}): CandidateInput {
  const sp = over.species ?? species('sp_test', 'Test Fish');
  return {
    specimenId: 'spec_1',
    kind: 'individual',
    quantity: 1,
    identityStatus: 'user-confirmed',
    species: sp,
    profile: profile(sp.id),
    ...over,
  };
}

export function resident(over: Partial<ResidentInput> = {}): ResidentInput {
  const speciesId = over.speciesId ?? 'sp_resident';
  return {
    holdingId: 'hold_1',
    label: 'Resident Fish',
    quantity: 1,
    speciesId,
    profile: profile(speciesId),
    ...over,
  };
}

export function tank(over: Partial<TankInput> = {}): TankInput {
  return { aquarium: aquarium(), residents: [], ...over };
}

export const FIXTURE_NOW = NOW;
