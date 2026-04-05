-- Add indexes for payments table
CREATE INDEX IF NOT EXISTS payments_ride_id_idx ON payments (ride_id);
CREATE INDEX IF NOT EXISTS payments_rider_id_idx ON payments (rider_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);

-- Add spatial GiST index for driver location proximity queries
CREATE INDEX IF NOT EXISTS drivers_location_gist_idx
  ON drivers USING gist (
    (ST_MakePoint(current_lng, current_lat)::geography)
  )
  WHERE current_lat IS NOT NULL AND current_lng IS NOT NULL;
