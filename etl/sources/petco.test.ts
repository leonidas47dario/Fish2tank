import { describe, expect, it } from 'vitest';
import { hasAquatics, parseStore, storeUrlsForCity } from './petco';

const STORE_HTML = `
<html><head><script type="application/ld+json">
{"@graph":[
 {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]},
 {"@context":"https://schema.org","@type":"PetStore","name":"Petco Pet Store in Chicago Halsted",
  "address":{"@type":"PostalAddress","streetAddress":"3046 N Halsted","addressLocality":"Chicago",
   "addressRegion":"IL","postalCode":"60657","addressCountry":"US"},
  "telephone":"+17739357547",
  "geo":{"@type":"GeoCoordinates","latitude":41.93761112665786,"longitude":-87.6500203338705},
  "department":[{"@type":"LocalBusiness","name":"Dog Grooming"},
                {"@type":"LocalBusiness","name":"Aquatics Department"}]}
]}
</script></head></html>`;

const URL = 'https://stores.petco.com/il/chicago/pet-supplies-chicago-il-696.html';

describe('parseStore', () => {
  it('reads the branch out of the @graph-wrapped PetStore block', () => {
    expect(parseStore(STORE_HTML, URL)).toMatchObject({
      vendorId: 'petco',
      storeNumber: '696',
      name: 'Petco Pet Store in Chicago Halsted',
      street: '3046 N Halsted',
      city: 'Chicago',
      state: 'IL',
      postalCode: '60657',
      latitude: 41.93761112665786,
    });
  });

  it('keeps the departments verbatim rather than reducing them to a flag', () => {
    expect(parseStore(STORE_HTML, URL)!.departments).toEqual(['Dog Grooming', 'Aquatics Department']);
  });

  it('reports no departments as empty, which is not the same as no fish', () => {
    // A branch that publishes no department list has told us nothing. An empty
    // array must never be read as "this branch has no aquatics".
    const bare = STORE_HTML.replace(/"department":\[[^\]]*\}\]/, '"department":[]');
    const store = parseStore(bare, URL)!;
    expect(store.departments).toEqual([]);
    expect(hasAquatics(store)).toBe(false);
  });

  it('returns nothing for a page with no PetStore block', () => {
    expect(parseStore('<html></html>', URL)).toBeUndefined();
  });
});

describe('storeUrlsForCity', () => {
  const urls = [
    'https://stores.petco.com/il/chicago/pet-supplies-chicago-il-696.html',
    'https://stores.petco.com/il/chicago/full-service-grooming-chicago-il-696.html',
    'https://stores.petco.com/aquatics/il/chicago',
    'https://stores.petco.com/il/chicago',
    'https://stores.petco.com/il/chicago-heights/pet-supplies-chicago-heights-il-2500.html',
    'https://stores.petco.com/ca/chico/pet-supplies-chico-ca-800.html',
  ];

  it('keeps branch pages only, for the city asked for', () => {
    expect(storeUrlsForCity(urls, 'il', 'chicago')).toEqual([
      'https://stores.petco.com/il/chicago/pet-supplies-chicago-il-696.html',
    ]);
  });
});

describe('hasAquatics', () => {
  it('is true only when the branch itself names an aquatics department', () => {
    expect(hasAquatics(parseStore(STORE_HTML, URL)!)).toBe(true);
  });
});
