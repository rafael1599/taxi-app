import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { rideApi, type FareEstimate, type RequestRideBody } from '../api/client';
import { useRideStore } from '../store/rideStore';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'BookRide'> };

export function BookRideScreen({ navigation }: Props) {
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [estimate, setEstimate] = useState<FareEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const setActiveRide = useRideStore((s) => s.setActiveRide);

  // Auto-fill pickup with current location
  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(async (loc) => {
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setPickupCoords(coords);
        // Reverse geocode for display label
        const [place] = await Location.reverseGeocodeAsync({
          latitude: coords.lat,
          longitude: coords.lng,
        });
        if (place) {
          const label = [place.streetNumber, place.street, place.city]
            .filter(Boolean)
            .join(' ');
          setPickupAddress(label || 'Current Location');
        } else {
          setPickupAddress('Current Location');
        }
      });
    });
  }, []);

  const handleEstimate = async () => {
    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      Alert.alert('Validation', 'Enter both pickup and drop-off addresses.');
      return;
    }
    // For demo: geocode drop-off as a fixed offset from pickup (real app would use a geocoding API)
    const pickup = pickupCoords ?? { lat: 41.1489, lng: -74.0148 };
    const dropoff = dropoffCoords ?? { lat: pickup.lat + 0.05, lng: pickup.lng + 0.05 };

    const body: RequestRideBody = {
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      pickupAddress: pickupAddress.trim(),
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      dropoffAddress: dropoffAddress.trim(),
    };

    setEstimating(true);
    try {
      const { data } = await rideApi.estimate(body);
      setEstimate(data);
    } catch {
      Alert.alert('Error', 'Could not get fare estimate. Please try again.');
    } finally {
      setEstimating(false);
    }
  };

  const handleRequest = async () => {
    if (!estimate) return;
    const pickup = pickupCoords ?? { lat: 41.1489, lng: -74.0148 };
    const dropoff = dropoffCoords ?? { lat: pickup.lat + 0.05, lng: pickup.lng + 0.05 };

    const body: RequestRideBody = {
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      pickupAddress: pickupAddress.trim(),
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      dropoffAddress: dropoffAddress.trim(),
    };

    setRequesting(true);
    try {
      const { data } = await rideApi.request(body);
      setActiveRide(data);
      navigation.replace('ActiveRide', { rideId: data.id });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not request ride. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        {/* Handle bar */}
        <View style={styles.handle} />

        <Text style={styles.title}>Book a Ride</Text>

        <Text style={styles.label}>Pickup</Text>
        <TextInput
          style={styles.input}
          placeholder="Pickup address"
          placeholderTextColor="#666"
          value={pickupAddress}
          onChangeText={(v) => { setPickupAddress(v); setEstimate(null); }}
        />

        <Text style={styles.label}>Drop-off</Text>
        <TextInput
          style={styles.input}
          placeholder="Drop-off address"
          placeholderTextColor="#666"
          value={dropoffAddress}
          onChangeText={(v) => { setDropoffAddress(v); setEstimate(null); }}
        />

        {/* Fare estimate */}
        {estimate ? (
          <View style={styles.estimateCard}>
            <Text style={styles.estimateTitle}>Fare Estimate</Text>
            <View style={styles.estimateRow}>
              <View style={styles.estimateStat}>
                <Text style={styles.estimateValue}>${estimate.fareEstimate}</Text>
                <Text style={styles.estimateLabel}>Estimated Fare</Text>
              </View>
              <View style={styles.estimateStat}>
                <Text style={styles.estimateValue}>{estimate.distanceKm.toFixed(1)} km</Text>
                <Text style={styles.estimateLabel}>Distance</Text>
              </View>
              <View style={styles.estimateStat}>
                <Text style={styles.estimateValue}>{estimate.durationMin} min</Text>
                <Text style={styles.estimateLabel}>Est. Time</Text>
              </View>
            </View>
          </View>
        ) : null}

        {!estimate ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleEstimate}
            disabled={estimating}
          >
            {estimating ? (
              <ActivityIndicator color="#1a1a2e" />
            ) : (
              <Text style={styles.primaryBtnText}>Get Fare Estimate</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleRequest}
            disabled={requesting}
          >
            {requesting ? (
              <ActivityIndicator color="#1a1a2e" />
            ) : (
              <Text style={styles.primaryBtnText}>Request Ride</Text>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  inner: { padding: 24, paddingBottom: 40 },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 24 },
  label: { color: '#aaa', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  input: {
    backgroundColor: '#2a2a42',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 18,
  },
  estimateCard: {
    backgroundColor: '#2a2a42',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  estimateTitle: { color: '#aaa', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14 },
  estimateRow: { flexDirection: 'row', justifyContent: 'space-around' },
  estimateStat: { alignItems: 'center' },
  estimateValue: { color: '#f5c518', fontWeight: '700', fontSize: 20 },
  estimateLabel: { color: '#888', fontSize: 12, marginTop: 4 },
  primaryBtn: {
    backgroundColor: '#f5c518',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#888', fontSize: 15 },
});
