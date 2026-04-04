import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { RideRequestScreen } from '../screens/RideRequestScreen';
import { ActiveRideScreen } from '../screens/ActiveRideScreen';

// ── Tab navigator (main app) ──────────────────────────────────────────────────

export type TabParamList = {
  Home: undefined;
  Earnings: undefined;
};

const Tab = createBottomTabNavigator();

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#2a2a42', borderTopColor: '#3a3a52' },
        tabBarActiveTintColor: '#f5c518',
        tabBarInactiveTintColor: '#666',
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Rides',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🚖</Text>,
        }}
      />
      <Tab.Screen
        name="Earnings"
        component={EarningsScreen}
        options={{
          tabBarLabel: 'Earnings',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>💰</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

// ── Root stack ────────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Tabs: undefined;
  RideRequest: { rideId: string };
  ActiveRide: { rideId: string };
};

const Stack = createNativeStackNavigator();

export function AppNavigator() {
  const token = useAuthStore((s) => s.token);

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#1a1a2e' } }}
      >
        {token ? (
          <>
            <Stack.Screen name="Tabs" component={TabNavigator} />
            <Stack.Screen
              name="RideRequest"
              component={RideRequestScreen}
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="ActiveRide" component={ActiveRideScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
