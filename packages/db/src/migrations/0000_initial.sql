-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enums
CREATE TYPE ride_status AS ENUM (
  'requested',
  'accepted',
  'arrived',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TYPE payment_status AS ENUM (
  'pending',
  'authorized',
  'captured',
  'refunded',
  'failed'
);

-- Riders
CREATE TABLE riders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  avatar_url  TEXT,
  stripe_cust TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Riders auth (password stored separately)
CREATE TABLE riders_auth (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id      UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drivers
CREATE TABLE drivers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       TEXT NOT NULL,
  phone           TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  license_number  TEXT NOT NULL UNIQUE,
  tlc_license     TEXT,
  stripe_acct     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_available    BOOLEAN NOT NULL DEFAULT FALSE,
  current_lat     FLOAT8,
  current_lng     FLOAT8,
  location_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX drivers_available_idx ON drivers (is_available, is_active)
  WHERE is_available = TRUE AND is_active = TRUE;

-- Vehicles
CREATE TABLE vehicles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  make        TEXT NOT NULL,
  model       TEXT NOT NULL,
  year        INT NOT NULL,
  color       TEXT NOT NULL,
  plate       TEXT NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rides
CREATE TABLE rides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id         UUID NOT NULL REFERENCES riders(id),
  driver_id        UUID REFERENCES drivers(id),
  vehicle_id       UUID REFERENCES vehicles(id),
  status           ride_status NOT NULL DEFAULT 'requested',
  pickup_lat       FLOAT8 NOT NULL,
  pickup_lng       FLOAT8 NOT NULL,
  pickup_address   TEXT NOT NULL,
  dropoff_lat      FLOAT8 NOT NULL,
  dropoff_lng      FLOAT8 NOT NULL,
  dropoff_address  TEXT NOT NULL,
  pickup_geog      GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                     ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography
                   ) STORED,
  dropoff_geog     GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                     ST_SetSRID(ST_MakePoint(dropoff_lng, dropoff_lat), 4326)::geography
                   ) STORED,
  distance_km      FLOAT8,
  duration_min     INT,
  fare_estimate    NUMERIC(8, 2),
  fare_final       NUMERIC(8, 2),
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at      TIMESTAMPTZ,
  picked_up_at     TIMESTAMPTZ,
  dropped_off_at   TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX rides_pickup_geog_idx  ON rides USING GIST (pickup_geog);
CREATE INDEX rides_dropoff_geog_idx ON rides USING GIST (dropoff_geog);
CREATE INDEX rides_status_idx       ON rides (status)
  WHERE status IN ('requested', 'accepted', 'in_progress');
CREATE INDEX rides_rider_id_idx     ON rides (rider_id, created_at DESC);
CREATE INDEX rides_driver_id_idx    ON rides (driver_id, created_at DESC);

-- Payments
CREATE TABLE payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id      UUID NOT NULL REFERENCES rides(id),
  rider_id     UUID NOT NULL REFERENCES riders(id),
  amount       NUMERIC(10, 2) NOT NULL,
  currency     CHAR(3) NOT NULL DEFAULT 'USD',
  status       payment_status NOT NULL DEFAULT 'pending',
  stripe_pi_id TEXT,
  stripe_pm_id TEXT,
  captured_at  TIMESTAMPTZ,
  refunded_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
