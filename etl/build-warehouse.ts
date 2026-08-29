/**
 * Load the star schema and write it as Parquet.
 *
 * DuckDB does the modelling work in SQL - which is deliberate. The transforms
 * are then plain, portable SQL that a future warehouse can run essentially
 * unchanged, rather than TypeScript that would have to be rewritten.
 *
 * Each run stamps its own snapshot_date, so re-running accumulates the price
 * history that no single pull can contain.
 */
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SPECIES_CATALOG } from '@/data/seed/species-catalog';
import { STORES, type LocalStore, type MarketListing, type StoreInventory } from './types';
import { discoverSpecies } from './normalize/derive-species';
import { surrogateKey } from './surrogate-key';

const WAREHOUSE = 'warehouse';
const LISTINGS = 'data/market/listings.jsonl';
const IMAGES = 'data/market/images.jsonl';
const LOCAL_STORES = 'data/market/local-stores.jsonl';
const STORE_INVENTORY = 'data/market/store-inventory.jsonl';

export const dateKey = (iso: string): number => Number(iso.slice(0, 10).replace(/-/g, ''));

async function writeTable(c: DuckDBConnection, name: string, folder: 'dim' | 'fact') {
  const path = `${WAREHOUSE}/${folder}/${name}.parquet`;
  // ZSTD: better ratio than snappy, and universally readable.
  await c.run(`COPY ${name} TO '${path}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  return path;
}

const SIZE_IN_SQL = `CASE WHEN l.size IS NULL THEN NULL
       WHEN l.size.unit = 'cm' THEN l.size.value / 2.54
       ELSE l.size.value END`;

async function main() {
  mkdirSync(`${WAREHOUSE}/dim`, { recursive: true });
  mkdirSync(`${WAREHOUSE}/fact`, { recursive: true });

  if (!existsSync(LISTINGS)) {
    throw new Error(`${LISTINGS} not found - run "npm run etl" first.`);
  }

  const instance = await DuckDBInstance.create(':memory:');
  const c = await instance.connect();
  const validFrom = new Date().toISOString().slice(0, 10);

  // --- Staging -----------------------------------------------------------
  await c.run(
    `CREATE TABLE stg_listing AS SELECT * FROM read_json_auto('${LISTINGS}', format='newline_delimited')`,
  );

  const stores = STORES.map((s) => ({
    store_key: surrogateKey(s.id).toString(),
    store_id: s.id,
    name: s.name,
    host: s.host,
    currency: s.currency,
    region: s.region ?? null,
    platform: s.platform ?? 'shopify',
    // Stated on the dimension so a vendor with no listings reads as a
    // deliberate scope rather than a broken run. Petco is the only one.
    data_scope: s.dataScope ?? 'listings',
  }));

  const species = SPECIES_CATALOG.map(({ species: sp, profile }) => ({
    species_key: surrogateKey(sp.id, validFrom).toString(),
    species_id: sp.id,
    common_name: sp.commonName,
    scientific_name: sp.scientificName ?? null,
    aliases: sp.aliases.join('|'),
    adult_size_in:
      profile.adultSize?.unit === 'cm' ? profile.adultSize.value / 2.54 : profile.adultSize?.value ?? null,
    min_volume_gal:
      profile.minimumVolume?.unit === 'l'
        ? profile.minimumVolume.value / 3.785411784
        : profile.minimumVolume?.value ?? null,
    aggression: profile.aggression ?? null,
    temp_min_c: profile.water?.temperatureC?.min ?? null,
    temp_max_c: profile.water?.temperatureC?.max ?? null,
    predation_tags: profile.predationTags.join('|'),
    profile_version: profile.profileVersion,
    // Curated profiles declare no water type: nothing in the profile states
    // one, and every tank the owner keeps is freshwater, so inferring it from
    // that would be the app inventing a fact about the fish.
    water_type: null as string | null,
    source_label: profile.sources[0]?.label ?? null,
    source_url: profile.sources[0]?.url ?? null,
    valid_from: validFrom,
    valid_to: null,
    is_current: true,
  }));

  /**
   * The species dimension is the union of two sources, and the order matters:
   * curated profiles are authoritative, and discovery only fills the gaps.
   *
   * Without the discovered half, dim_species held 47 rows while the vendors
   * named 1,068 species - the library was showing 4% of itself.
   */
  const curatedScientific = new Set(
    SPECIES_CATALOG.map((e) => e.species.scientificName?.toLowerCase()).filter(Boolean) as string[],
  );
  const listingRows: MarketListing[] = readFileSync(LISTINGS, 'utf8')
    .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const waterTypeByStore = new Map(
    STORES.filter((s) => s.waterType).map((s) => [s.id, s.waterType!] as const),
  );
  const discovered = discoverSpecies(listingRows, curatedScientific, waterTypeByStore);

  for (const d of discovered) {
    species.push({
      species_key: surrogateKey(d.speciesId, validFrom).toString(),
      species_id: d.speciesId,
      common_name: d.commonName,
      scientific_name: d.scientificName,
      aliases: d.aliases.join('|'),
      // No care data, deliberately. The compatibility engine will return
      // "Not enough data" for these, which is correct - nobody has profiled
      // them. Inventing values here would be the fastest way to make every
      // downstream verdict untrustworthy.
      adult_size_in: null, min_volume_gal: null, aggression: null,
      temp_min_c: null, temp_max_c: null, predation_tags: '',
      profile_version: 0,
      // The one fact the vendors DO settle: a species only LiveAquaria sells
      // is a marine species. Tagged, not inferred - see DiscoveredSpecies.
      water_type: d.waterType ?? null,
      source_label: 'Discovered from vendor listings - no care profile yet',
      source_url: null,
      valid_from: validFrom, valid_to: null, is_current: true,
    });
  }

  writeFileSync('/tmp/_stores.jsonl', stores.map((s) => JSON.stringify(s)).join('\n'));
  writeFileSync('/tmp/_species.jsonl', species.map((s) => JSON.stringify(s)).join('\n'));
  await c.run(
    `CREATE TABLE stg_store AS SELECT * FROM read_json_auto('/tmp/_stores.jsonl', format='newline_delimited')`,
  );
  await c.run(
    `CREATE TABLE stg_species AS SELECT * FROM read_json_auto('/tmp/_species.jsonl', format='newline_delimited')`,
  );

  // --- Dimensions --------------------------------------------------------
  await c.run(`CREATE TABLE dim_store AS
    SELECT CAST(store_key AS BIGINT) AS store_key, store_id, name, host, currency, region,
           platform, data_scope
    FROM stg_store`);

  /**
   * Physical branches, and the first rows in this warehouse that are not mail
   * order. Created even when empty so a query against it never fails before
   * the big-box vendors have been run.
   *
   * has_aquatics is NULLABLE on purpose. False must mean "the branch publishes
   * a department list and fish are not on it"; a vendor that publishes no list
   * at all gets NULL, because "we did not check" and "there are no fish here"
   * are not the same claim.
   */
  await c.run(`CREATE TABLE dim_local_store (
    local_store_key BIGINT, store_key BIGINT, vendor_id VARCHAR, store_number VARCHAR,
    name VARCHAR, street VARCHAR, city VARCHAR, state VARCHAR, postal_code VARCHAR,
    phone VARCHAR, latitude DOUBLE, longitude DOUBLE, url VARCHAR,
    departments VARCHAR, has_aquatics BOOLEAN)`);

  if (existsSync(LOCAL_STORES) && readFileSync(LOCAL_STORES, 'utf8').trim()) {
    const branches: LocalStore[] = readFileSync(LOCAL_STORES, 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const rows = branches.map((b) => ({
      local_store_key: surrogateKey(b.vendorId, b.storeNumber).toString(),
      store_key: surrogateKey(b.vendorId).toString(),
      vendor_id: b.vendorId,
      store_number: b.storeNumber,
      name: b.name,
      street: b.street,
      city: b.city,
      state: b.state,
      postal_code: b.postalCode,
      phone: b.phone ?? null,
      latitude: b.latitude ?? null,
      longitude: b.longitude ?? null,
      url: b.url,
      departments: b.departments.join('|'),
      has_aquatics: b.departments.length ? b.departments.some((d) => /aquatic/i.test(d)) : null,
    }));
    writeFileSync('/tmp/_local_stores.jsonl', rows.map((r) => JSON.stringify(r)).join('\n'));
    await c.run(`INSERT INTO dim_local_store SELECT
      CAST(local_store_key AS BIGINT), CAST(store_key AS BIGINT), vendor_id, store_number,
      name, street, city, state, postal_code, phone,
      CAST(latitude AS DOUBLE), CAST(longitude AS DOUBLE), url, departments,
      CAST(has_aquatics AS BOOLEAN)
      FROM read_json_auto('/tmp/_local_stores.jsonl', format='newline_delimited')`);
  }

  await c.run(`CREATE TABLE dim_species AS
    SELECT CAST(species_key AS BIGINT) AS species_key, species_id, common_name, scientific_name,
           aliases, adult_size_in, min_volume_gal, aggression, temp_min_c, temp_max_c,
           predation_tags, CAST(profile_version AS INTEGER) AS profile_version,
           water_type, source_label, source_url,
           CAST(valid_from AS DATE) AS valid_from, CAST(valid_to AS DATE) AS valid_to, is_current
    FROM stg_species`);

  // Every date referenced by any fact, so time joins never miss a row.
  await c.run(`CREATE TABLE dim_date AS
    WITH d AS (
      SELECT DISTINCT CAST(retrievedAt AS DATE) AS date FROM stg_listing
      UNION
      SELECT DISTINCT CAST(publishedAt AS DATE) FROM stg_listing WHERE publishedAt IS NOT NULL
    )
    SELECT CAST(strftime(date, '%Y%m%d') AS INTEGER) AS date_key, date,
           CAST(year(date) AS INTEGER) AS year, CAST(month(date) AS INTEGER) AS month,
           CAST(day(date) AS INTEGER) AS day, strftime(date, '%Y-%m') AS year_month
    FROM d WHERE date IS NOT NULL ORDER BY date`);

  // Created even when empty: the schema must be complete so queries against
  // dim_image do not fail before the image ETL has ever run.
  await c.run(`CREATE TABLE dim_image (
    image_key BIGINT, species_id VARCHAR, role VARCHAR, source VARCHAR, url VARCHAR,
    license VARCHAR, artist VARCHAR, attribution_url VARCHAR,
    width INTEGER, height INTEGER, retrieved_at TIMESTAMP)`);

  if (existsSync(IMAGES) && readFileSync(IMAGES, 'utf8').trim()) {
    await c.run(`INSERT INTO dim_image SELECT
      CAST(image_key AS BIGINT), species_id, role, source, url, license, artist,
      attribution_url, CAST(width AS INTEGER), CAST(height AS INTEGER),
      CAST(retrieved_at AS TIMESTAMP)
      FROM read_json_auto('${IMAGES}', format='newline_delimited')`);
  }

  // --- Facts -------------------------------------------------------------
  await c.run(`CREATE TABLE fact_listing AS
    SELECT
      CAST(hash(l.storeId || CAST(l.variantId AS VARCHAR) ||
                strftime(CAST(l.retrievedAt AS DATE), '%Y%m%d')) / 2 AS BIGINT) AS listing_key,
      CAST(strftime(CAST(l.retrievedAt AS DATE), '%Y%m%d') AS INTEGER) AS snapshot_date_key,
      st.store_key,
      sp.species_key,
      CAST(l.productId AS BIGINT) AS product_id,
      CAST(l.variantId AS BIGINT) AS variant_id,
      l.title, l.url, l.productType AS product_type,
      CAST(l.price AS DOUBLE) AS price,
      CAST(l.compareAtPrice AS DOUBLE) AS compare_at_price,
      l.currency,
      -- Every size normalized to inches at load time, so no consumer needs to
      -- know which unit a given vendor happened to use.
      ${SIZE_IN_SQL} AS size_in,
      l.sizeLabel AS size_label,
      CAST(floor(${SIZE_IN_SQL}) AS INTEGER) AS size_band_in,
      l.available,
      CAST(strftime(CAST(l.publishedAt AS DATE), '%Y%m%d') AS INTEGER) AS published_date_key,
      l.matchMethod AS match_method,
      l.scientificNameInTitle AS scientific_in_title
    FROM stg_listing l
    LEFT JOIN dim_store   st ON st.store_id = l.storeId
    LEFT JOIN dim_species sp ON sp.species_id = l.speciesId AND sp.is_current`);

  /**
   * GRAIN: one row per (branch, sku, snapshot_date).
   *
   * Separate from fact_listing because it is a different kind of fact. A
   * listing is a price the vendor publishes nationally and freezes; this is a
   * count in one building that changes hourly. Same reason fact_price_
   * observation is separate: pooling them would let a stale count read as a
   * price, and the grain of fact_listing would stop being true.
   *
   * on_hand NULL with carried FALSE is the vendor saying the branch does not
   * stock the sku at all, which is not the same as stocking it and having none
   * today (on_hand 0, carried TRUE).
   */
  await c.run(`CREATE TABLE fact_store_inventory (
    inventory_key BIGINT, snapshot_date_key INTEGER, local_store_key BIGINT,
    store_key BIGINT, species_key BIGINT, sku VARCHAR,
    on_hand INTEGER, carried BOOLEAN)`);

  if (existsSync(STORE_INVENTORY) && readFileSync(STORE_INVENTORY, 'utf8').trim()) {
    const rows: StoreInventory[] = readFileSync(STORE_INVENTORY, 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    writeFileSync(
      '/tmp/_store_inventory.jsonl',
      rows.map((r) => JSON.stringify({
        inventory_key: surrogateKey(r.vendorId, r.storeNumber, r.sku, r.retrievedAt.slice(0, 10)).toString(),
        snapshot_date_key: dateKey(r.retrievedAt),
        local_store_key: surrogateKey(r.vendorId, r.storeNumber).toString(),
        store_key: surrogateKey(r.vendorId).toString(),
        sku: r.sku,
        on_hand: r.onHand,
        carried: r.carried,
      })).join('\n'),
    );
    // The species is joined through the listing that shares the sku, so an
    // on-hand count inherits whatever the listing resolved to - including
    // resolving to nothing, which is the common case for trade names.
    await c.run(`INSERT INTO fact_store_inventory
      SELECT CAST(i.inventory_key AS BIGINT), CAST(i.snapshot_date_key AS INTEGER),
             CAST(i.local_store_key AS BIGINT), CAST(i.store_key AS BIGINT),
             f.species_key, i.sku, CAST(i.on_hand AS INTEGER), i.carried
      FROM read_json_auto('/tmp/_store_inventory.jsonl', format='newline_delimited') i
      LEFT JOIN (SELECT DISTINCT CAST(variant_id AS VARCHAR) AS sku, store_key, species_key
                 FROM fact_listing) f
        ON f.sku = i.sku AND f.store_key = CAST(i.store_key AS BIGINT)`);
  }

  await c.run(`CREATE TABLE fact_price_observation (
    observation_key BIGINT, date_key INTEGER, species_key BIGINT, place_name VARCHAR,
    asking_price DOUBLE, member_price DOUBLE, paid_price DOUBLE, currency VARCHAR,
    basis VARCHAR, package_qty INTEGER, size_in DOUBLE, source VARCHAR)`);

  // --- Write -------------------------------------------------------------
  const written: string[] = [];
  for (const t of ['dim_store', 'dim_species', 'dim_date', 'dim_image', 'dim_local_store'] as const) {
    written.push(await writeTable(c, t, 'dim'));
  }
  for (const t of ['fact_listing', 'fact_store_inventory', 'fact_price_observation'] as const) {
    written.push(await writeTable(c, t, 'fact'));
  }

  // --- Report ------------------------------------------------------------
  console.log('─── warehouse ───');
  for (const t of [
    'dim_store', 'dim_species', 'dim_date', 'dim_image', 'dim_local_store',
    'fact_listing', 'fact_store_inventory', 'fact_price_observation',
  ]) {
    const r = await c.runAndReadAll(`SELECT count(*) AS n FROM ${t}`);
    console.log(`  ${t.padEnd(24)} ${String(r.getRowObjects()[0]!.n).padStart(7)} rows`);
  }

  const q = await c.runAndReadAll(`
    SELECT f.size_band_in, count(*) AS listings, median(f.price) AS median_price
    FROM fact_listing f JOIN dim_species s ON s.species_key = f.species_key
    WHERE s.scientific_name = 'Parachromis managuensis' AND f.size_band_in IS NOT NULL
    GROUP BY 1 ORDER BY 1`);
  console.log('\n  sample query - jaguar cichlid ladder, straight from the warehouse:');
  for (const row of q.getRowObjects()) {
    console.log(
      `    ${String(row.size_band_in).padStart(3)}in  $${Number(row.median_price).toFixed(2).padStart(7)}  (${row.listings} listings)`,
    );
  }
  const local = await c.runAndReadAll(`
    SELECT s.vendor_id, s.name, s.has_aquatics,
           count(i.sku) FILTER (WHERE i.carried) AS skus_carried,
           coalesce(sum(i.on_hand), 0) AS fish_on_hand
    FROM dim_local_store s
    LEFT JOIN fact_store_inventory i ON i.local_store_key = s.local_store_key
    GROUP BY 1, 2, 3 ORDER BY 1, fish_on_hand DESC`);
  const branches = local.getRowObjects();
  if (branches.length) {
    console.log('\n  sample query - what the sampled Chicago branches actually hold:');
    for (const row of branches) {
      const aquatics = row.has_aquatics === null ? 'not published' : row.has_aquatics ? 'aquatics' : 'no aquatics';
      console.log(
        `    ${String(row.vendor_id).padEnd(9)} ${String(row.name).slice(0, 34).padEnd(35)}` +
        `${aquatics.padEnd(14)} ${String(row.skus_carried).padStart(4)} skus  ${String(row.fish_on_hand).padStart(5)} on hand`,
      );
    }
  }

  console.log(`\n  wrote ${written.length} parquet files under ${WAREHOUSE}/`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
