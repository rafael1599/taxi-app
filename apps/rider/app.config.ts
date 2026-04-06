import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Drivly – Rider',
  slug: 'drivly-rider',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#1a1a2e',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.drivly.rider',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Drivly needs your location to find nearby drivers and auto-fill your pickup address.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#1a1a2e',
    },
    package: 'com.drivly.rider',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  plugins: [
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Drivly needs your location to show nearby drivers and auto-fill your pickup address.',
      },
    ],
  ],
  extra: {
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? 'pk_test_REPLACE_ME',
  },
});
