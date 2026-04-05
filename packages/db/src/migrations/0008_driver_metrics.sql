-- 0008_driver_metrics.sql
-- Track driver performance metrics (cancellation rate, completion rate)

CREATE TABLE IF NOT EXISTS driver_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('cancellation', 'completion', 'timeout', 'rejection')),
  ride_id UUID REFERENCES rides(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_driver_metrics_driver ON driver_metrics(driver_id);
CREATE INDEX idx_driver_metrics_company ON driver_metrics(company_id);
CREATE INDEX idx_driver_metrics_created ON driver_metrics(created_at);
CREATE INDEX idx_driver_metrics_driver_type_window ON driver_metrics(driver_id, event_type, created_at);
