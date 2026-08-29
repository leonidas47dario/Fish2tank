import { describe, expect, it } from 'vitest';
import { isGenusChange, isUnprofiled } from './fetch-care-text';

describe('isUnprofiled', () => {
  it('treats a species with none of the three gating fields as unprofiled', () => {
    expect(isUnprofiled({ speciesId: 'x', commonName: 'X' })).toBe(true);
  });

  it('treats any one gating field as profiled, so it is left alone', () => {
    expect(isUnprofiled({ speciesId: 'x', commonName: 'X', adultSizeIn: 4 })).toBe(false);
    expect(isUnprofiled({ speciesId: 'x', commonName: 'X', aggression: 'peaceful' })).toBe(false);
  });
});

describe('isGenusChange', () => {
  it('reports a reclassification, which keeps the species epithet', () => {
    expect(isGenusChange('Corydoras agassizii', 'Brochis agassizii')).toBe(true);
    expect(isGenusChange('Clea helena', 'Anentome helena')).toBe(true);
  });

  it('does not report a redirect to the common-name article', () => {
    // The failure that inflated the count from 35 to 204: these look like
    // binomials and are English names.
    expect(isGenusChange('Corydoras metae', 'Masked corydoras')).toBe(false);
    expect(isGenusChange('Ictalurus punctatus', 'Channel catfish')).toBe(false);
    expect(isGenusChange('Atractosteus spatula', 'Alligator gar')).toBe(false);
  });

  it('does not report a single-word article title', () => {
    expect(isGenusChange('Carassius auratus auratus', 'Goldfish')).toBe(false);
  });

  it('does not report a title that only changed the epithet', () => {
    expect(isGenusChange('Azolla caroliniana', 'Azolla cristata')).toBe(false);
  });

  it('is safe on missing input', () => {
    expect(isGenusChange(undefined, 'Brochis agassizii')).toBe(false);
    expect(isGenusChange('Corydoras agassizii', undefined)).toBe(false);
  });
});
