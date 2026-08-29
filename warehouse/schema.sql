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
  PRIMARY KEY (store_key)
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
