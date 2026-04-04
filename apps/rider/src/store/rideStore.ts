import { create } from 'zustand';
import type { Ride } from '../api/client';

interface RideState {
  activeRide: Ride | null;
  setActiveRide: (ride: Ride | null) => void;
}

export const useRideStore = create<RideState>((set) => ({
  activeRide: null,
  setActiveRide: (ride) => set({ activeRide: ride }),
}));
