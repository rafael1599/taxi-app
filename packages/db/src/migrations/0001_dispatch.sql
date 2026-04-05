-- Add rejected_driver_ids to track which drivers have already rejected this ride
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS rejected_driver_ids UUID[] NOT NULL DEFAULT '{}';
