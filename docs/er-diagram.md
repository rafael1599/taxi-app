# Entity-Relationship Diagram

## Core Entities

```
┌─────────────────────┐        ┌─────────────────────────┐
│       riders        │        │        drivers          │
├─────────────────────┤        ├─────────────────────────┤
│ id          UUID PK │        │ id             UUID PK  │
│ full_name   TEXT    │        │ full_name      TEXT     │
│ phone       TEXT UQ │        │ phone          TEXT UQ  │
│ email       TEXT UQ │        │ email          TEXT UQ  │
│ avatar_url  TEXT    │        │ license_number TEXT UQ  │
│ stripe_cust TEXT    │        │ tlc_license    TEXT     │
│ is_active   BOOL    │        │ stripe_acct    TEXT     │
│ created_at  TS      │        │ is_active      BOOL     │
│ updated_at  TS      │        │ is_available   BOOL     │
└────────┬────────────┘        │ current_lat    FLOAT8   │
         │                     │ current_lng    FLOAT8   │
         │                     │ location_at    TS       │
         │                     │ created_at     TS       │
         │                     │ updated_at     TS       │
         │                     └──────────┬──────────────┘
         │                                │
         │                     ┌──────────┴──────────────┐
         │                     │        vehicles         │
         │                     ├─────────────────────────┤
         │                     │ id          UUID PK     │
         │                     │ driver_id   UUID FK     │
         │                     │ make        TEXT        │
         │                     │ model       TEXT        │
         │                     │ year        INT         │
         │                     │ color       TEXT        │
         │                     │ plate       TEXT UQ     │
         │                     │ is_active   BOOL        │
         │                     │ created_at  TS          │
         │                     └─────────────────────────┘
         │
         │         ┌────────────────────────────────────────────┐
         │         │                   rides                    │
         ├─────────┤────────────────────────────────────────────┤
         │ rider   │ id               UUID PK                   │
         │         │ rider_id         UUID FK → riders          │
         │         │ driver_id        UUID FK → drivers (NULL)  │
         │         │ vehicle_id       UUID FK → vehicles (NULL) │
         │         │ status           ride_status ENUM          │
         │         │ pickup_lat       FLOAT8                    │
         │         │ pickup_lng       FLOAT8                    │
         │         │ pickup_address   TEXT                      │
         │         │ dropoff_lat      FLOAT8                    │
         │         │ dropoff_lng      FLOAT8                    │
         │         │ dropoff_address  TEXT                      │
         │         │ pickup_geog      GEOGRAPHY(Point,4326)     │
         │         │ dropoff_geog     GEOGRAPHY(Point,4326)     │
         │         │ distance_km      FLOAT8                    │
         │         │ duration_min     INT                       │
         │         │ fare_estimate    NUMERIC(8,2)              │
         │         │ fare_final       NUMERIC(8,2)              │
         │         │ requested_at     TS                        │
         │         │ accepted_at      TS                        │
         │         │ picked_up_at     TS                        │
         │         │ dropped_off_at   TS                        │
         │         │ cancelled_at     TS                        │
         │         │ cancel_reason    TEXT                      │
         │         │ created_at       TS                        │
         │         │ updated_at       TS                        │
         │         └───────────────────────┬────────────────────┘
         │                                 │
         │                      ┌──────────┴──────────────┐
         │                      │        payments         │
         │                      ├─────────────────────────┤
         │                      │ id            UUID PK   │
         │                      │ ride_id       UUID FK   │
         │                      │ rider_id      UUID FK   │
         │                      │ amount        NUMERIC   │
         │                      │ currency      CHAR(3)   │
         │                      │ status        pay_status│
         │                      │ stripe_pi_id  TEXT      │
         │                      │ stripe_pm_id  TEXT      │
         │                      │ captured_at   TS        │
         │                      │ refunded_at   TS        │
         │                      │ created_at    TS        │
         │                      └─────────────────────────┘

```

## Enum Types

```sql
CREATE TYPE ride_status AS ENUM (
  'requested',   -- rider requested, looking for driver
  'accepted',    -- driver accepted, en route to pickup
  'arrived',     -- driver at pickup location
  'in_progress', -- rider in vehicle, en route to dropoff
  'completed',   -- ride finished, awaiting payment capture
  'cancelled'    -- cancelled by rider or driver
);

CREATE TYPE payment_status AS ENUM (
  'pending',    -- payment intent created
  'authorized', -- card authorized (hold placed)
  'captured',   -- funds captured after ride completion
  'refunded',   -- full or partial refund issued
  'failed'      -- payment failed
);
```

## Key Indexes

```sql
-- Fast driver proximity search for dispatch
CREATE INDEX rides_pickup_geog_idx ON rides USING GIST (pickup_geog);
CREATE INDEX rides_dropoff_geog_idx ON rides USING GIST (dropoff_geog);

-- Driver location for nearest-driver queries
CREATE INDEX drivers_location_idx ON drivers (current_lat, current_lng)
  WHERE is_available = true AND is_active = true;

-- Ride status filter (hot path for dispatch)
CREATE INDEX rides_status_idx ON rides (status) WHERE status IN ('requested', 'accepted', 'in_progress');

-- Rider ride history
CREATE INDEX rides_rider_id_idx ON rides (rider_id, created_at DESC);

-- Driver ride history
CREATE INDEX rides_driver_id_idx ON rides (driver_id, created_at DESC);
```

## Relationships Summary

| From | To | Type | Notes |
|---|---|---|---|
| `drivers` | `vehicles` | 1:N | A driver can have multiple registered vehicles |
| `riders` | `rides` | 1:N | A rider can have many rides |
| `drivers` | `rides` | 1:N | A driver can complete many rides |
| `vehicles` | `rides` | 1:N | A vehicle appears on many rides |
| `rides` | `payments` | 1:1 | One payment per completed ride |
