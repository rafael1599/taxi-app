import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useRideStore } from '../store/rideStore';
import { useActiveRide } from '../hooks/useActiveRide';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { BookRideScreen } from '../screens/BookRideScreen';
import { ActiveRideScreen } from '../screens/ActiveRideScreen';
import { TripHistoryScreen } from '../screens/TripHistoryScreen';
import { PaymentScreen } from '../screens/PaymentScreen';
import { RateRideScreen } from '../screens/RateRideScreen';

// ── Tab navigator ─────────────────────────────────────────────────────────────

export type TabParamList = {
  Home: undefined;
  History: undefined;
  Payment: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

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
          tabBarLabel: 'Ride',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🚕</Text>,
        }}
      />
      <Tab.Screen
        name="History"
        component={TripHistoryScreen}
        options={{
          tabBarLabel: 'Trips',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🕓</Text>,
        }}
      />
      <Tab.Screen
        name="Payment"
        component={PaymentScreen}
        options={{
          tabBarLabel: 'Payment',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>💳</Text>,
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
  BookRide: undefined;
  ActiveRide: { rideId: string };
  RateRide: { rideId: string; fare?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function AuthenticatedNavigator() {
  const activeRide = useRideStore((s) => s.activeRide);

  // If rider has an in-flight ride, push directly into ActiveRide
  const initialRoute: keyof RootStackParamList =
    activeRide && activeRide.status !== 'completed' && activeRide.status !== 'cancelled'
      ? 'ActiveRide'
      : 'Tabs';

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#1a1a2e' } }}
    >
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen
        name="BookRide"
        component={BookRideScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name="ActiveRide" component={ActiveRideScreen} />
      <Stack.Screen
        name="RateRide"
        component={RateRideScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}

export function AppNavigator() {
  const token = useAuthStore((s) => s.token);
  useActiveRide();

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#1a1a2e' } }}
      >
        {token ? (
          <Stack.Screen name="Tabs" component={AuthenticatedNavigator} />
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
