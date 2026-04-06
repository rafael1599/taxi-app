import { calculateFare, haversineDistanceKm } from '@drivly/shared';

export interface FareEstimate {
  distanceKm: number;
  durationMin: number;
  fareUsd: number;
}

export function estimateFare(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
  surgeMultiplier = 1.0,
): FareEstimate {
  const distanceKm = haversineDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  // Rough speed estimate: 30 km/h average in service area
  const durationMin = Math.ceil((distanceKm / 30) * 60);
  const fareUsd = calculateFare(distanceKm, durationMin, surgeMultiplier);
  return { distanceKm, durationMin, fareUsd };
}
