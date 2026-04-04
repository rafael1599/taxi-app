import { create } from 'zustand';
import type { Ride } from '../api/client';

interface RideState {
  activeRide: Ride | null;
  pendingRides: Ride[];
  history: Ride[];
  setActiveRide: (ride: Ride | null) => void;
  setPendingRides: (rides: Ride[]) => void;
  setHistory: (rides: Ride[]) => void;
}

export const useRideStore = create<RideState>((set) => ({
  activeRide: null,
  pendingRides: [],
  history: [],
  setActiveRide: (ride) => set({ activeRide: ride }),
  setPendingRides: (rides) => set({ pendingRides: rides }),
  setHistory: (rides) => set({ history: rides }),
}));
