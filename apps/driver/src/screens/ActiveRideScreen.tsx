import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation';
import { rideApi, type Ride } from '../api/client';
import { useRideStore } from '../store/rideStore';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ActiveRide'>;
  route: RouteProp<RootStackParamList, 'ActiveRide'>;
};

type Phase = 'accepted' | 'in_progress';

interface LatLng { latitude: number; longitude: number }

export function ActiveRideScreen({ navigation, route }: Props) {
  const { rideId } = route.params;
  const [ride, setRide] = useState<Ride | null>(null);
  const [phase, setPhase] = useState<Phase>('accepted');
  const [driverPos, setDriverPos] = useState<LatLng | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const mapRef = useRef<MapView>(null);
  const setActiveRide = useRideStore((s) => s.setActiveRide);

  // Load ride
  useEffect(() => {
    rideApi.get(rideId).then(({ data }) => {
      setRide(data);
      setPhase(data.status === 'in_progress' ? 'in_progress' : 'accepted');
    });
  }, [rideId]);

  // Live GPS updates
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5 },
        (loc) => {
          setDriverPos({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        },
      ).then((s) => {
        sub = s;
      });
    });

    return () => {
      sub?.remove();
    };
  }, []);

  const handleStart = async () => {
    if (!ride) return;
    setActionLoading(true);
    try {
      const { data } = await rideApi.start(ride.id);
      setRide(data);
      setPhase('in_progress');
    } catch {
      Alert.alert('Error', 'Could not start ride.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!ride) return;
    Alert.alert('Complete Ride', 'Confirm drop-off?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Complete',
        onPress: async () => {
          setActionLoading(true);
          try {
            await rideApi.complete(ride.id);
            setActiveRide(null);
            navigation.replace('Tabs');
          } catch {
            Alert.alert('Error', 'Could not complete ride.');
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  if (!ride) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5c518" size="large" />
      </View>
    );
  }

  const target: LatLng =
    phase === 'accepted'
      ? { latitude: ride.pickupLat, longitude: ride.pickupLng }
      : { latitude: ride.dropoffLat, longitude: ride.dropoffLng };

  const region = {
    latitude: driverPos?.latitude ?? ride.pickupLat,
    longitude: driverPos?.longitude ?? ride.pickupLng,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        region={region}
        showsUserLocation
        followsUserLocation
      >
        {driverPos && <Marker coordinate={driverPos} title="You" pinColor="blue" />}
        <Marker coordinate={target} title={phase === 'accepted' ? 'Pickup' : 'Drop-off'} pinColor={phase === 'accepted' ? 'green' : 'red'} />
        {driverPos && (
          <Polyline
            coordinates={[driverPos, target]}
            strokeColor={phase === 'accepted' ? '#4caf50' : '#f5c518'}
            strokeWidth={3}
          />
        )}
      </MapView>

      <View style={styles.sheet}>
        <View style={styles.phaseBadge}>
          <Text style={styles.phaseText}>
            {phase === 'accepted' ? '🚗 Heading to Pickup' : '🏁 En Route to Destination'}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.icon}>{phase === 'accepted' ? '📍' : '🏁'}</Text>
          <Text style={styles.address}>
            {phase === 'accepted' ? ride.pickupAddress : ride.dropoffAddress}
          </Text>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>${ride.fareEstimate}</Text>
            <Text style={styles.statLabel}>Fare</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{ride.distanceKm?.toFixed(1)} km</Text>
            <Text style={styles.statLabel}>Distance</Text>
          </View>
        </View>

        {phase === 'accepted' ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleStart}
            disabled={actionLoading}
          >
            {actionLoading ? (
              <ActivityIndicator color="#1a1a2e" />
            ) : (
              <Text style={styles.primaryBtnText}>Rider Picked Up — Start Ride</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#4caf50' }]}
            onPress={handleComplete}
            disabled={actionLoading}
          >
            {actionLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.primaryBtnText, { color: '#fff' }]}>Complete Ride</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  map: { flex: 1 },
  sheet: {
    backgroundColor: '#2a2a42',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
  },
  phaseBadge: {
    backgroundColor: '#3a3a52',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  phaseText: { color: '#f5c518', fontWeight: '600', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  icon: { fontSize: 18, marginRight: 10 },
  address: { color: '#fff', fontSize: 14, flex: 1 },
  stats: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 16 },
  stat: { alignItems: 'center' },
  statValue: { color: '#fff', fontWeight: '700', fontSize: 20 },
  statLabel: { color: '#888', fontSize: 12, marginTop: 4 },
  primaryBtn: {
    backgroundColor: '#f5c518',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
});
