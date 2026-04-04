import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { riderApi, type RiderProfile } from '../api/client';
import { useRideStore } from '../store/rideStore';
import { useAuthStore } from '../store/authStore';

// Rockland County, NY default center
const ROCKLAND_REGION = {
  latitude: 41.1489,
  longitude: -74.0148,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
};

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

export function HomeScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const activeRide = useRideStore((s) => s.activeRide);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    riderApi.me().then(({ data }) => setProfile(data)).catch(() => {});
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then((loc) => {
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUserLocation(coords);
        mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 800);
      });
    });
  }, []);

  // If there's an active ride in a non-terminal state, prompt rider to view it
  const hasActiveRide =
    activeRide &&
    activeRide.status !== 'completed' &&
    activeRide.status !== 'cancelled';

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={ROCKLAND_REGION}
        showsUserLocation
      >
        {userLocation && <Marker coordinate={userLocation} title="You" pinColor="#f5c518" />}
      </MapView>

      {/* Header overlay */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            Hi, {profile?.fullName?.split(' ')[0] ?? '…'}
          </Text>
          <Text style={styles.subGreeting}>Where are you going?</Text>
        </View>
        <TouchableOpacity onPress={clearAuth}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom action */}
      <View style={styles.sheet}>
        {hasActiveRide ? (
          <>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>● Ride in progress</Text>
            </View>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => navigation.navigate('ActiveRide', { rideId: activeRide!.id })}
            >
              <Text style={styles.primaryBtnText}>Track My Ride</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('BookRide')}
          >
            <Text style={styles.primaryBtnText}>Book a Ride</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(26,26,46,0.88)',
  },
  greeting: { fontSize: 20, fontWeight: '700', color: '#fff' },
  subGreeting: { fontSize: 13, color: '#aaa', marginTop: 2 },
  signOut: { color: '#f5c518', fontSize: 13 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#2a2a42',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  activeBadge: {
    backgroundColor: '#3a3a52',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  activeBadgeText: { color: '#4caf50', fontWeight: '600', fontSize: 14 },
  primaryBtn: {
    backgroundColor: '#f5c518',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
});
