import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { driverApi } from '../api/client';

const TASK_NAME = 'DRIVLY_BACKGROUND_LOCATION';

interface LocationTaskBody {
  locations: Location.LocationObject[];
  error: TaskManager.TaskManagerError | null;
}

// ── Task definition (must be top-level, outside any component) ─────────────
TaskManager.defineTask<LocationTaskBody>(TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.warn('[BgLocation] Task error:', error.message);
    return;
  }

  const location = data?.locations?.[0];
  if (!location) return;

  try {
    await driverApi.updateLocation(location.coords.latitude, location.coords.longitude);
  } catch {
    // Network error while backgrounded — location will be sent on next tick
  }
});

/**
 * Starts background location tracking.
 * Requires both foreground and background location permissions.
 * Sends GPS updates to the backend every ~10 seconds.
 */
export async function startBackgroundLocation(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return false;

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') {
    console.warn('[BgLocation] Background permission denied — falling back to foreground only');
    return false;
  }

  const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
  if (isRunning) return true;

  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 10_000,
    distanceInterval: 10,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Drivly',
      notificationBody: 'Sharing your location with riders',
      notificationColor: '#f5c518',
    },
  });

  return true;
}

/**
 * Stops background location tracking.
 */
export async function stopBackgroundLocation(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(TASK_NAME);
  }
}
