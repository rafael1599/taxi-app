import 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AppNavigator } from './src/navigation';
import { useAuthStore } from './src/store/authStore';

const stripeKey = (Constants.expoConfig?.extra?.stripePublishableKey as string | undefined) ?? '';

function SplashScreen() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator color="#f5c518" size="large" />
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    useAuthStore
      .getState()
      .hydrate()
      .then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SplashScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <StripeProvider publishableKey={stripeKey}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AppNavigator />
      </SafeAreaProvider>
    </StripeProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
