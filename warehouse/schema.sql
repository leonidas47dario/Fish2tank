-- Fish2Tank analytical warehouse - portable DDL.
--
-- This file is the migration contract. The Parquet files under warehouse/
-- conform to it exactly, so moving to Athena, BigQuery, Snowflake, Databricks
-- or Postgres is "copy the files, run this DDL, repoint the ETL's load step".
-- Nothing here depends on GitHub, on git, or on the local filesystem layout.
--
-- Conventions
--   *_key      surrogate key: a stable hash of the natural key, NOT an
--              autoincrement, so rebuilding on another machine yields the same
--              keys and git diffs stay small
--   *_id       the natural/business key as it exists in the source system
--   snapshot_date  the day the ETL observed the row. Part of the fact grain.

-- ─────────────────────────────────────────────────────────────────────────
-- DIMENSIONS
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE dim_store (
  store_key      BIGINT      NOT NULL,  -- hash(store_id)
  store_id       VARCHAR     NOT NULL,  -- 'predatory-fins'
  name           VARCHAR     NOT NULL,
  host           VARCHAR     NOT NULL,
  -- Currency lives on the store, not the fact. Pooling prices across stores is
  -- only valid because every tracked store declares one.
  currency       VARCHAR     NOT NULL,
  region         VARCHAR,
  -- Which reader the vendor needs: 'shopify' | 'petsmart' | 'petco'.
  platform       VARCHAR     NOT NULL,
  -- 'listings' or 'store-locations'. Stated so a vendor contributing no
  -- listings reads as a deliberate scope rather than a failed run. Petco is
  -- the only 'store-locations' case: its storefront answers 403 to every
  -- automated request, robots.txt included, so there is no permitted route to
  -- its catalogue and none is invented.
  data_scope     VARCHAR     NOT NULL,
  PRIMARY KEY (store_key)
);

-- A physical branch of a vendor - the first rows here that are not mail order.
--
-- Every vendor before the big-box two answered "can this be shipped to me". A
-- branch answers "is it in a tank I can drive to", which is the question the
-- product was built around.
CREATE TABLE dim_local_store (
  local_store_key BIGINT  NOT NULL,     -- hash(vendor_id, store_number)
  store_key       BIGINT  NOT NULL REFERENCES dim_store(store_key),
  vendor_id       VARCHAR NOT NULL,     -- 'petsmart' | 'petco'
  store_number    VARCHAR NOT NULL,     -- the vendor's own number, unpadded
  name            VARCHAR NOT NULL,
  street          VARCHAR,
  city            VARCHAR,
  state           VARCHAR,
  postal_code     VARCHAR,
  phone           VARCHAR,
  latitude        DOUBLE,
  longitude       DOUBLE,
  url             VARCHAR NOT NULL,     -- the page the row was read from
  departments     VARCHAR,              -- pipe-delimited, verbatim
  -- NULLABLE ON PURPOSE. FALSE means the branch publishes a department list
  -- and fish are not on it. NULL means it publishes no list, so we did not
  -- check - which is not the same claim and must not be flattened into FALSE.
  has_aquatics    BOOLEAN,
  PRIMARY KEY (local_store_key)
);

-- Type 2 slowly-changing: re-identifying a fish opens a new row rather than
-- rewriting history, so a listing recorded under the old name keeps pointing
-- at what was believed at the time.
CREATE TABLE dim_species (
  species_key       BIGINT   NOT NULL,  -- hash(species_id, valid_from)
  species_id        VARCHAR  NOT NULL,  -- 'sp_jaguar_cichlid'
  common_name       VARCHAR  NOT NULL,
  scientific_name   VARCHAR,
  aliases           VARCHAR,            -- pipe-delimited; arrays are not portable
  adult_size_in     DOUBLE,
  min_volume_gal    DOUBLE,
  aggression        VARCHAR,
  temp_min_c        DOUBLE,
  temp_max_c        DOUBLE,
  predation_tags    VARCHAR,
  profile_version   INTEGER,
  source_label      VARCHAR,
  source_url        VARCHAR,
  valid_from        DATE     NOT NULL,
  valid_to          DATE,               -- NULL = current
  is_current        BOOLEAN  NOT NULL,
  PRIMARY KEY (species_key)
);

-- A 图鉴 image is unusable without its licence and author, so those are
-- columns, not an afterthought.
CREATE TABLE dim_image (
  image_key       BIGINT    NOT NULL,   -- hash(url)
  species_id      VARCHAR   NOT NULL,
  role            VARCHAR   NOT NULL,   -- 'portrait' | 'listing'
  source          VARCHAR   NOT NULL,   -- 'wikimedia' | 'store'
  url             VARCHAR   NOT NULL,
  license         VARCHAR,
  artist          VARCHAR,
  attribution_url VARCHAR,
  width           INTEGER,
  height          INTEGER,
  retrieved_at    TIMESTAMP NOT NULL,
  PRIMARY KEY (image_key)
);

CREATE TABLE dim_date (
  date_key   INTEGER NOT NULL,          -- 20260828
  date       DATE    NOT NULL,
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL,
  day        INTEGER NOT NULL,
  year_month VARCHAR NOT NULL,          -- '2026-08'
  PRIMARY KEY (date_key)
);

-- ─────────────────────────────────────────────────────────────────────────
-- FACTS
-- ─────────────────────────────────────────────────────────────────────────

-- GRAIN: one row per (store, product, variant, snapshot_date).
--
-- snapshot_date in the grain is the whole point. A listing's price is frozen
-- at whatever the store published, and no price-history API exists for these
-- vendors. But because every ETL run appends rows stamped with its own
-- snapshot date, re-running accumulates a genuine time series that no single
-- pull could ever contain.
CREATE TABLE fact_listing (
  listing_key        BIGINT   NOT NULL, -- hash(store_id, variant_id, snapshot_date)
  snapshot_date_key  INTEGER  NOT NULL REFERENCES dim_date(date_key),
  store_key          BIGINT   NOT NULL REFERENCES dim_store(store_key),
  species_key        BIGINT            REFERENCES dim_species(species_key),

  product_id         BIGINT   NOT NULL,
  variant_id         BIGINT   NOT NULL,
  title              VARCHAR  NOT NULL,
  url                VARCHAR  NOT NULL,
  product_type       VARCHAR,

  -- Measures
  price              DOUBLE   NOT NULL,
  compare_at_price   DOUBLE,
  currency           VARCHAR  NOT NULL,

  -- Degenerate attributes kept on the fact: they describe this listing, not a
  -- reusable entity worth its own dimension.
  size_in            DOUBLE,            -- NULL when the option carried no size
  size_label         VARCHAR,
  size_band_in       INTEGER,           -- floor(size_in), the price-ladder band
  available          BOOLEAN  NOT NULL,

  published_date_key INTEGER            REFERENCES dim_date(date_key),
  -- Match provenance, so a bad species match is traceable rather than silent.
  match_method       VARCHAR,           -- 'scientific-name' | 'common-name' | 'alias'
  scientific_in_title VARCHAR,
  PRIMARY KEY (listing_key)
);

-- GRAIN: one row per (branch, sku, snapshot_date).
--
-- Separate from fact_listing because it is a different kind of fact. A listing
-- is a price the vendor publishes nationally and then freezes; this is a count
-- in one building that changes hourly. Pooling them would let a stale count
-- read as a price and the grain of fact_listing would stop being true.
--
-- Only PetSmart populates this today: it is the one tracked vendor that
-- publishes per-store on-hand counts, through the inventory search endpoint
-- its robots.txt explicitly allows.
CREATE TABLE fact_store_inventory (
  inventory_key     BIGINT  NOT NULL,   -- hash(vendor, store_number, sku, snapshot_date)
  snapshot_date_key INTEGER NOT NULL REFERENCES dim_date(date_key),
  local_store_key   BIGINT  NOT NULL REFERENCES dim_local_store(local_store_key),
  store_key         BIGINT  NOT NULL REFERENCES dim_store(store_key),
  -- Inherited from the listing sharing this sku, so it is NULL whenever the
  -- listing itself resolved to no species. That is the common case for a
  -- big-box vendor, which titles by trade name rather than by binomial.
  species_key       BIGINT           REFERENCES dim_species(species_key),
  sku               VARCHAR NOT NULL,
  -- NULL means the vendor reported nothing for this sku at this branch, which
  -- is NOT zero - see carried.
  on_hand           INTEGER,
  -- FALSE = the branch does not stock the sku at all. TRUE with on_hand 0 =
  -- it stocks it and has none today. Different answers to "is it worth
  -- driving there".
  carried           BOOLEAN NOT NULL,
  PRIMARY KEY (inventory_key)
);

-- GRAIN: one row per price the USER personally recorded.
--
-- Deliberately separate from fact_listing. What Ryan saw on a tag in a Chicago
-- shop is a different kind of fact from what a mail-order vendor published,
-- and pooling them would destroy the distinction the price engine depends on.
CREATE TABLE fact_price_observation (
  observation_key BIGINT  NOT NULL,
  date_key        INTEGER NOT NULL REFERENCES dim_date(date_key),
  species_key     BIGINT           REFERENCES dim_species(species_key),
  place_name      VARCHAR,
  asking_price    DOUBLE,
  member_price    DOUBLE,
  paid_price      DOUBLE,
  currency        VARCHAR NOT NULL,
  basis           VARCHAR NOT NULL,     -- 'each' | 'pair' | 'lot'
  package_qty     INTEGER NOT NULL,
  size_in         DOUBLE,
  source          VARCHAR NOT NULL,     -- 'in-store' | 'online-manual' | 'import'
  PRIMARY KEY (observation_key)
);

-- ─────────────────────────────────────────────────────────────────────────
-- The query the grain exists for: price over time, per store, per size band.
-- Returns one snapshot today; a real trend line after a few more runs, with
-- no schema change.
-- ─────────────────────────────────────────────────────────────────────────
--
-- SELECT d.date, st.name, f.size_band_in, median(f.price) AS median_price
-- FROM fact_listing f
-- JOIN dim_date    d  ON d.date_key  = f.snapshot_date_key
-- JOIN dim_store   st ON st.store_key = f.store_key
-- JOIN dim_species s  ON s.species_key = f.species_key AND s.is_current
-- WHERE s.scientific_name = 'Parachromis managuensis'
-- GROUP BY 1, 2, 3
-- ORDER BY 1, 3;

-- ─────────────────────────────────────────────────────────────────────────
-- And the query the branch grain exists for: what is in a tank near you today.
-- ─────────────────────────────────────────────────────────────────────────
--
-- SELECT ls.name, ls.street, l.title, i.on_hand
-- FROM fact_store_inventory i
-- JOIN dim_local_store ls ON ls.local_store_key = i.local_store_key
-- JOIN fact_listing    l  ON CAST(l.variant_id AS VARCHAR) = i.sku
--                        AND l.store_key = i.store_key
-- WHERE ls.city = 'Chicago' AND i.on_hand > 0
-- ORDER BY ls.name, i.on_hand DESC;
