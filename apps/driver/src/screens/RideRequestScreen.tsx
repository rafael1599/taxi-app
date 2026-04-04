import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation';
import { rideApi, type Ride } from '../api/client';
import { useRideStore } from '../store/rideStore';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RideRequest'>;
  route: RouteProp<RootStackParamList, 'RideRequest'>;
};

export function RideRequestScreen({ navigation, route }: Props) {
  const { rideId } = route.params;
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const setActiveRide = useRideStore((s) => s.setActiveRide);

  useEffect(() => {
    rideApi
      .get(rideId)
      .then(({ data }) => setRide(data))
      .catch(() => {
        Alert.alert('Error', 'Could not load ride.');
        navigation.goBack();
      })
      .finally(() => setLoading(false));
  }, [rideId, navigation]);

  const handleAccept = async () => {
    if (!ride) return;
    setAccepting(true);
    try {
      const { data } = await rideApi.accept(ride.id);
      setActiveRide(data);
      navigation.replace('ActiveRide', { rideId: data.id });
    } catch {
      Alert.alert('Unavailable', 'This ride was already taken.');
      navigation.goBack();
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = () => navigation.goBack();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5c518" size="large" />
      </View>
    );
  }

  if (!ride) return null;

  const pickupRegion = {
    latitude: ride.pickupLat,
    longitude: ride.pickupLng,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  };

  return (
    <View style={styles.container}>
      <MapView style={styles.map} provider={PROVIDER_GOOGLE} initialRegion={pickupRegion}>
        <Marker coordinate={{ latitude: ride.pickupLat, longitude: ride.pickupLng }} title="Pickup" pinColor="green" />
        <Marker coordinate={{ latitude: ride.dropoffLat, longitude: ride.dropoffLng }} title="Drop-off" pinColor="red" />
      </MapView>

      <View style={styles.sheet}>
        <Text style={styles.label}>New Ride Request</Text>

        <View style={styles.row}>
          <Text style={styles.icon}>📍</Text>
          <Text style={styles.address}>{ride.pickupAddress}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.icon}>🏁</Text>
          <Text style={styles.address}>{ride.dropoffAddress}</Text>
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
          <View style={styles.stat}>
            <Text style={styles.statValue}>{ride.durationMin} min</Text>
            <Text style={styles.statLabel}>Est. time</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.declineBtn} onPress={handleDecline}>
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} disabled={accepting}>
            {accepting ? (
              <ActivityIndicator color="#1a1a2e" />
            ) : (
              <Text style={styles.acceptText}>Accept</Text>
            )}
          </TouchableOpacity>
        </View>
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
  label: { color: '#f5c518', fontWeight: '700', fontSize: 18, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  icon: { fontSize: 18, marginRight: 10 },
  address: { color: '#fff', fontSize: 14, flex: 1 },
  stats: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 20 },
  stat: { alignItems: 'center' },
  statValue: { color: '#fff', fontWeight: '700', fontSize: 20 },
  statLabel: { color: '#888', fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12 },
  declineBtn: {
    flex: 1,
    backgroundColor: '#3a3a52',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  declineText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  acceptBtn: {
    flex: 2,
    backgroundColor: '#f5c518',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  acceptText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
});
