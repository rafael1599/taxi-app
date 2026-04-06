import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const CREDENTIALS_KEY = 'rockland_driver_credentials';

// Expo Go doesn't support native modules like expo-local-authentication / expo-secure-store
const isExpoGo = Constants.appOwnership === 'expo';

export type BiometricType = 'fingerprint' | 'facial' | 'iris';

export interface SavedCredentials {
  email: string;
  password: string;
}

// ── Lazy-load native modules (crash-safe for Expo Go) ───────────────────────

let LocalAuthentication: typeof import('expo-local-authentication') | null = null;
let SecureStore: typeof import('expo-secure-store') | null = null;

if (!isExpoGo) {
  try {
    LocalAuthentication = require('expo-local-authentication');
  } catch {
    // not available
  }
  try {
    SecureStore = require('expo-secure-store');
  } catch {
    // not available
  }
}

// ── Biometric helpers ───────────────────────────────────────────────────────

/** Check if device supports any form of biometric auth */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!LocalAuthentication) return false;
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return false;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return enrolled;
}

/** Get available biometric types (fingerprint, facial, iris) */
export async function getBiometricTypes(): Promise<BiometricType[]> {
  if (!LocalAuthentication) return [];
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  return types.map((t) => {
    switch (t) {
      case LocalAuthentication.AuthenticationType.FINGERPRINT:
        return 'fingerprint';
      case LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION:
        return 'facial';
      case LocalAuthentication.AuthenticationType.IRIS:
        return 'iris';
      default:
        return 'fingerprint';
    }
  });
}

/** Get enrolled security level (NONE, SECRET=PIN, BIOMETRIC) */
export async function getSecurityLevel(): Promise<number> {
  if (!LocalAuthentication) return 0;
  return LocalAuthentication.getEnrolledLevelAsync();
}

/** Get a user-friendly label for the biometric button */
export async function getBiometricLabel(): Promise<string> {
  const types = await getBiometricTypes();
  if (types.includes('facial')) return 'Face ID';
  if (types.includes('fingerprint')) return 'Fingerprint';
  if (types.includes('iris')) return 'Iris';
  return 'Biometric';
}

/** Prompt user for biometric authentication */
export async function authenticateWithBiometric(): Promise<boolean> {
  if (!LocalAuthentication) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Sign in to Rockland Taxi',
    fallbackLabel: 'Use PIN',
    disableDeviceFallback: false, // allows PIN/password fallback
  });
  return result.success;
}

// ── Credential storage (SecureStore when available, fallback to AsyncStorage) ─

/** Save credentials (encrypted via SecureStore, or AsyncStorage in Expo Go) */
export async function saveCredentials(email: string, password: string): Promise<void> {
  const data: SavedCredentials = { email, password };
  const json = JSON.stringify(data);

  if (SecureStore) {
    await SecureStore.setItemAsync(CREDENTIALS_KEY, json);
  } else {
    await AsyncStorage.setItem(CREDENTIALS_KEY, json);
  }
}

/** Load saved credentials */
export async function loadCredentials(): Promise<SavedCredentials | null> {
  try {
    let raw: string | null = null;
    if (SecureStore) {
      raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
    } else {
      raw = await AsyncStorage.getItem(CREDENTIALS_KEY);
    }
    if (!raw) return null;
    return JSON.parse(raw) as SavedCredentials;
  } catch {
    return null;
  }
}

/** Delete saved credentials */
export async function clearCredentials(): Promise<void> {
  try {
    if (SecureStore) {
      await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
    } else {
      await AsyncStorage.removeItem(CREDENTIALS_KEY);
    }
  } catch {
    // ignore if nothing to delete
  }
}

/** Check if there are saved credentials */
export async function hasSavedCredentials(): Promise<boolean> {
  const creds = await loadCredentials();
  return creds !== null;
}
