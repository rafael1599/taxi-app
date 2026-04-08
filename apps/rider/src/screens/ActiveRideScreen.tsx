import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation';
import { rideApi, type Ride, type RideStatus } from '../api/client';
import { useRideStore } from '../store/rideStore';
import { useRideWebSocket } from '../hooks/useRideWebSocket';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ActiveRide'>;
  route: RouteProp<RootStackParamList, 'ActiveRide'>;
};

interface LatLng {
  latitude: number;
  longitude: number;
}

const STATUS_LABELS: Record<RideStatus, string> = {
  requested: '🔍 Finding your driver…',
  accepted: '🚕 Driver is on the way',
  arrived: '🚕 Driver arrived — please board',
  in_progress: '🏁 En route to destination',
  completed: '✅ Ride completed',
  cancelled: '❌ Ride cancelled',
};

export function ActiveRideScreen({ navigation, route }: Props) {
  const { rideId } = route.params;
  const [ride, setRide] = useState<Ride | null>(null);
  const [driverPos, setDriverPos] = useState<LatLng | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const mapRef = useRef<MapView>(null);
  const setActiveRide = useRideStore((s) => s.setActiveRide);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── WebSocket: real-time driver location & status ────────────────────────
  const handleDriverLocation = useCallback((lat: number, lng: number) => {
    setDriverPos({ latitude: lat, longitude: lng });
  }, []);

  const handleStatusChange = useCallback(
    (status: string) => {
      setRide((prev) => (prev ? { ...prev, status: status as RideStatus } : prev));
      if (status === 'completed' || status === 'cancelled') {
        setActiveRide(null);
      }
    },
    [setActiveRide],
  );

  const handleDriverAssigned = useCallback(() => {
    // Re-fetch ride to get full driver info
    rideApi
      .get(rideId)
      .then(({ data }) => setRide(data))
      .catch(() => {});
  }, [rideId]);

  useRideWebSocket({
    rideId,
    onDriverLocation: handleDriverLocation,
    onStatusChange: handleStatusChange,
    onDriverAssigned: handleDriverAssigned,
  });

  // ── Fallback polling (lower frequency, covers reconnection gaps) ─────────
  const loadRide = async () => {
    try {
      const { data } = await rideApi.get(rideId);
      setRide(data);
      if (data.status === 'completed' || data.status === 'cancelled') {
        setActiveRide(null);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    } catch {
      // silently ignore polling errors
    }
  };

  useEffect(() => {
    loadRide();
    pollRef.current = setInterval(loadRide, 15_000); // reduced from 5s — WebSocket is primary
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [rideId]);

  const handleCancel = () => {
    Alert.alert('Cancel Ride', 'Are you sure you want to cancel?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancel Ride',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true);
          try {
            await rideApi.cancel(rideId);
            setActiveRide(null);
            navigation.replace('Tabs');
          } catch {
            Alert.alert('Error', 'Could not cancel ride.');
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  };

  const handleDone = () => {
    if (ride?.status === 'completed') {
      navigation.replace('RateRide', {
        rideId,
        fare: ride.fareFinal ?? ride.fareEstimate ?? undefined,
      });
    } else {
      navigation.replace('Tabs');
    }
  };

  if (!ride) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5c518" size="large" />
      </View>
    );
  }

  const isTerminal = ride.status === 'completed' || ride.status === 'cancelled';
  const pickupCoord: LatLng = { latitude: ride.pickupLat, longitude: ride.pickupLng };
  const dropoffCoord: LatLng = { latitude: ride.dropoffLat, longitude: ride.dropoffLng };

  const mapRegion = {
    latitude: driverPos?.latitude ?? ride.pickupLat,
    longitude: driverPos?.longitude ?? ride.pickupLng,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        region={mapRegion}
        showsUserLocation
      >
        {driverPos && <Marker coordinate={driverPos} title="Driver" pinColor="blue" />}
        <Marker coordinate={pickupCoord} title="Pickup" pinColor="green" />
        <Marker coordinate={dropoffCoord} title="Drop-off" pinColor="red" />
        {driverPos && (
          <Polyline coordinates={[driverPos, pickupCoord]} strokeColor="#4caf50" strokeWidth={3} />
        )}
        <Polyline
          coordinates={[pickupCoord, dropoffCoord]}
          strokeColor="#f5c518"
          strokeWidth={2}
          lineDashPattern={[6, 4]}
        />
      </MapView>

      <View style={styles.sheet}>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{STATUS_LABELS[ride.status]}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.icon}>📍</Text>
          <Text style={styles.address}>{ride.pickupAddress}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.icon}>🏁</Text>
          <Text style={styles.address}>{ride.dropoffAddress}</Text>
        </View>

        {ride.fareEstimate || ride.fareFinal ? (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>${ride.fareFinal ?? ride.fareEstimate}</Text>
              <Text style={styles.statLabel}>{ride.fareFinal ? 'Final Fare' : 'Estimated'}</Text>
            </View>
            {ride.distanceKm ? (
              <View style={styles.stat}>
                <Text style={styles.statValue}>{ride.distanceKm.toFixed(1)} km</Text>
                <Text style={styles.statLabel}>Distance</Text>
              </View>
            ) : null}
            {ride.durationMin ? (
              <View style={styles.stat}>
                <Text style={styles.statValue}>{ride.durationMin} min</Text>
                <Text style={styles.statLabel}>Duration</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {isTerminal ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleDone}>
            <Text style={styles.primaryBtnText}>
              {ride.status === 'completed' ? 'Rate Your Ride' : 'Back to Home'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, styles.cancelRideBtn]}
            onPress={handleCancel}
            disabled={cancelling || ride.status === 'in_progress'}
          >
            {cancelling ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.primaryBtnText, { color: '#fff' }]}>
                {ride.status === 'in_progress' ? 'Ride In Progress' : 'Cancel Ride'}
              </Text>
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
    paddingBottom: 40,
  },
  statusBadge: {
    backgroundColor: '#3a3a52',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  statusText: { color: '#f5c518', fontWeight: '600', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
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
  cancelRideBtn: { backgroundColor: '#c62828' },
  primaryBtnText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
});
