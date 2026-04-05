import { create } from 'zustand';
import type { Ride } from '../api/client';

export interface TripOffer {
  offerId: string;
  rideId: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  fareEstimate: string | null;
  distanceKm: number | null;
  expiresAt: string;
}

interface RideState {
  activeRide: Ride | null;
  currentOffer: TripOffer | null;
  history: Ride[];
  setActiveRide: (ride: Ride | null) => void;
  setCurrentOffer: (offer: TripOffer | null) => void;
  setHistory: (rides: Ride[]) => void;
}

export const useRideStore = create<RideState>((set) => ({
  activeRide: null,
  currentOffer: null,
  history: [],
  setActiveRide: (ride) => set({ activeRide: ride }),
  setCurrentOffer: (offer) => set({ currentOffer: offer }),
  setHistory: (rides) => set({ history: rides }),
}));
