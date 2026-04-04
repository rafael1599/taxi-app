import 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AppNavigator } from './src/navigation';

const stripeKey =
  (Constants.expoConfig?.extra?.stripePublishableKey as string | undefined) ?? '';

export default function App() {
  return (
    <StripeProvider publishableKey={stripeKey}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AppNavigator />
      </SafeAreaProvider>
    </StripeProvider>
  );
}
