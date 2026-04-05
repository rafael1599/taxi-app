export const FARE = {
  BASE_FARE_USD: 3.0,
  PER_KM_USD: 1.75,
  PER_MIN_USD: 0.35,
  MINIMUM_FARE_USD: 7.0,
  SURGE_MULTIPLIER_DEFAULT: 1.0,
} as const;

export const RIDE_STATUS_LABELS: Record<string, string> = {
  requested: 'Ride requested',
  searching_driver: 'Finding driver…',
  driver_assigned: 'Driver assigned',
  accepted: 'Driver on the way',
  arrived: 'Driver arrived',
  en_route: 'En route to destination',
  in_progress: 'On your way',
  picked_up: 'Picked up',
  completed: 'Ride complete',
  cancelled: 'Cancelled',
};

export const DISPATCH = {
  OFFER_TIMEOUT_SEC: 60,
  SEARCH_TIMEOUT_SEC: 120,
  AUTO_ARRIVAL_DISTANCE_METERS: 50,
  MAX_NEARBY_DRIVERS: 10,
} as const;

export const MAP_DEFAULTS = {
  // Rockland County, NY center
  LATITUDE: 41.1495,
  LONGITUDE: -74.0232,
  LATITUDE_DELTA: 0.15,
  LONGITUDE_DELTA: 0.15,
  NEARBY_DRIVER_RADIUS_KM: 10,
} as const;

export const JWT_EXPIRY_SEC = 60 * 60 * 24 * 7; // 7 days

export const DRIVER_LOCATION_TTL_SEC = 30;
