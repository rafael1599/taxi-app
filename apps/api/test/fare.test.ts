import { describe, it, expect } from 'vitest';
import { estimateFare } from '../src/services/fare.js';
import { haversineDistanceKm, calculateFare, FARE } from '@drivly/shared';

describe('haversineDistanceKm', () => {
  it('returns ~0 for same point', () => {
    expect(haversineDistanceKm(41.1, -74.0, 41.1, -74.0)).toBeCloseTo(0, 3);
  });

  it('returns positive distance between two distinct points', () => {
    const dist = haversineDistanceKm(41.1495, -74.0232, 40.7128, -74.006);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(100);
  });
});

describe('calculateFare', () => {
  it('never falls below minimum fare', () => {
    const fare = calculateFare(0.1, 1);
    expect(fare).toBeGreaterThanOrEqual(FARE.MINIMUM_FARE_USD);
  });

  it('increases with distance', () => {
    const short = calculateFare(2, 5);
    const long = calculateFare(20, 30);
    expect(long).toBeGreaterThan(short);
  });

  it('applies surge multiplier', () => {
    const normal = calculateFare(5, 10, 1.0);
    const surge = calculateFare(5, 10, 2.0);
    expect(surge).toBeGreaterThan(normal);
  });
});

describe('estimateFare', () => {
  it('returns non-zero values for a valid trip', () => {
    // Nyack to Spring Valley — realistic trip
    const result = estimateFare(41.0909, -73.9179, 41.1128, -74.0487);
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.durationMin).toBeGreaterThan(0);
    expect(result.fareUsd).toBeGreaterThanOrEqual(FARE.MINIMUM_FARE_USD);
  });
});
