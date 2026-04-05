import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation';
import { rideApi, tripApi, type Ride } from '../api/client';
import { useRideStore } from '../store/rideStore';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ActiveRide'>;
  route: RouteProp<RootStackParamList, 'ActiveRide'>;
};

type TripPhase = 'accepted' | 'en_route' | 'arrived' | 'picked_up';

interface LatLng {
  latitude: number;
  longitude: number;
}

const PHASE_CONFIG: Record<
  TripPhase,
  { label: string; nextAction: string; nextStatus: string; color: string }
> = {
  accepted: {
    label: 'Heading to Pickup',
    nextAction: 'Start Navigation',
    nextStatus: 'en_route',
    color: '#2196f3',
  },
  en_route: {
    label: 'En Route to Pickup',
    nextAction: 'Arrived at Pickup',
    nextStatus: 'arrived',
    color: '#ff9800',
  },
  arrived: {
    label: 'Waiting for Rider',
    nextAction: 'Rider Picked Up',
    nextStatus: 'picked_up',
    color: '#4caf50',
  },
  picked_up: {
    label: 'Trip in Progress',
    nextAction: 'Complete Trip',
    nextStatus: 'completed',
    color: '#f5c518',
  },
};

export function ActiveRideScreen({ navigation, route }: Props) {
  const { rideId } = route.params;
  const [ride, setRide] = useState<Ride | null>(null);
  const [phase, setPhase] = useState<TripPhase>('accepted');
  const [driverPos, setDriverPos] = useState<LatLng | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const mapRef = useRef<MapView>(null);
  const setActiveRide = useRideStore((s) => s.setActiveRide);
  const storeActiveRide = useRideStore((s) => s.activeRide);

  // Sync from store when SSE updates the ride
  useEffect(() => {
    if (storeActiveRide && storeActiveRide.id === rideId) {
      setRide(storeActiveRide);
      const status = storeActiveRide.status as TripPhase;
      if (['accepted', 'en_route', 'arrived', 'picked_up'].includes(status)) {
        setPhase(status);
      }
    }
  }, [storeActiveRide, rideId]);

  // Load ride on mount
  useEffect(() => {
    rideApi.get(rideId).then(({ data }) => {
      setRide(data);
      const status = data.status as TripPhase;
      if (['accepted', 'en_route', 'arrived', 'picked_up'].includes(status)) {
        setPhase(status);
      }
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

  const advanceStatus = useCallback(async () => {
    if (!ride) return;
    const config = PHASE_CONFIG[phase];
    const nextStatus = config.nextStatus;

    if (nextStatus === 'completed') {
      Alert.alert('Complete Trip', 'Confirm drop-off and end the trip?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete',
          onPress: async () => {
            setActionLoading(true);
            try {
              await tripApi.updateStatus(ride.id, 'completed');
              setActiveRide(null);
              navigation.replace('Tabs');
            } catch {
              Alert.alert('Error', 'Could not complete trip.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]);
      return;
    }

    setActionLoading(true);
    try {
      const { data } = await tripApi.updateStatus(ride.id, nextStatus);
      setRide(data);
      setPhase(nextStatus as TripPhase);
      setActiveRide(data);
    } catch {
      Alert.alert('Error', `Could not update status to ${nextStatus}.`);
    } finally {
      setActionLoading(false);
    }
  }, [ride, phase, setActiveRide, navigation]);

  const openNavigation = useCallback(() => {
    if (!ride) return;
    const target =
      phase === 'picked_up'
        ? { lat: ride.dropoffLat, lng: ride.dropoffLng }
        : { lat: ride.pickupLat, lng: ride.pickupLng };
    const url = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
    Linking.openURL(url);
  }, [ride, phase]);

  const callCustomer = useCallback(() => {
    // In a real app, you'd have the rider's phone from the ride data
    Alert.alert(
      'Call Customer',
      'Customer contact will be available once backend provides rider phone number.',
    );
  }, []);

  const cancelTrip = useCallback(() => {
    if (!ride) return;
    Alert.alert('Cancel Trip', 'Are you sure you want to cancel?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(true);
          try {
            await rideApi.cancel(ride.id, 'Driver cancelled');
            setActiveRide(null);
            navigation.replace('Tabs');
          } catch {
            Alert.alert('Error', 'Could not cancel trip.');
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  }, [ride, setActiveRide, navigation]);

  if (!ride) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5c518" size="large" />
      </View>
    );
  }

  const config = PHASE_CONFIG[phase];
  const isPickedUp = phase === 'picked_up';
  const target: LatLng = isPickedUp
    ? { latitude: ride.dropoffLat, longitude: ride.dropoffLng }
    : { latitude: ride.pickupLat, longitude: ride.pickupLng };

  const region = {
    latitude: driverPos?.latitude ?? target.latitude,
    longitude: driverPos?.longitude ?? target.longitude,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  };

  // Status progression dots
  const phases: TripPhase[] = ['accepted', 'en_route', 'arrived', 'picked_up'];
  const currentIndex = phases.indexOf(phase);

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
        <Marker
          coordinate={target}
          title={isPickedUp ? 'Drop-off' : 'Pickup'}
          pinColor={isPickedUp ? 'red' : 'green'}
        />
        {driverPos && (
          <Polyline coordinates={[driverPos, target]} strokeColor={config.color} strokeWidth={3} />
        )}
      </MapView>

      <View style={styles.sheet}>
        {/* Status badge and progress */}
        <View style={styles.statusRow}>
          <View style={[styles.phaseBadge, { backgroundColor: config.color + '20' }]}>
            <View style={[styles.phaseDot, { backgroundColor: config.color }]} />
            <Text style={[styles.phaseText, { color: config.color }]}>{config.label}</Text>
          </View>
        </View>

        {/* Progress dots */}
        <View style={styles.progressDots}>
          {phases.map((p, i) => (
            <React.Fragment key={p}>
              <View
                style={[
                  styles.progressDot,
                  {
                    backgroundColor: i <= currentIndex ? config.color : '#3a3a52',
                  },
                ]}
              />
              {i < phases.length - 1 && (
                <View
                  style={[
                    styles.progressLine,
                    {
                      backgroundColor: i < currentIndex ? config.color : '#3a3a52',
                    },
                  ]}
                />
              )}
            </React.Fragment>
          ))}
        </View>

        {/* Address info */}
        <View style={styles.addressRow}>
          <View style={[styles.dot, { backgroundColor: isPickedUp ? '#ff4444' : '#4caf50' }]} />
          <Text style={styles.address}>
            {isPickedUp ? ride.dropoffAddress : ride.pickupAddress}
          </Text>
        </View>

        {/* Fare info */}
        <View style={styles.fareRow}>
          <Text style={styles.fareLabel}>Fare</Text>
          <Text style={styles.fareValue}>${ride.fareEstimate}</Text>
        </View>

        {/* Quick actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickBtn} onPress={openNavigation}>
            <Text style={styles.quickBtnIcon}>{'Nav'}</Text>
            <Text style={styles.quickBtnLabel}>Navigate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickBtn} onPress={callCustomer}>
            <Text style={styles.quickBtnIcon}>{'Call'}</Text>
            <Text style={styles.quickBtnLabel}>Customer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickBtn]} onPress={cancelTrip}>
            <Text style={[styles.quickBtnIcon, { color: '#ff4444' }]}>{'X'}</Text>
            <Text style={[styles.quickBtnLabel, { color: '#ff4444' }]}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* Main action button */}
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: config.color }]}
          onPress={advanceStatus}
          disabled={actionLoading}
        >
          {actionLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{config.nextAction}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  map: { flex: 1 },
  sheet: {
    backgroundColor: '#2a2a42',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  statusRow: { marginBottom: 12 },
  phaseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  phaseDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  phaseText: { fontWeight: '600', fontSize: 14 },
  progressDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  progressDot: { width: 10, height: 10, borderRadius: 5 },
  progressLine: { width: 40, height: 2 },
  addressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  address: { color: '#fff', fontSize: 14, flex: 1 },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  fareLabel: { color: '#888', fontSize: 14 },
  fareValue: { color: '#f5c518', fontWeight: '700', fontSize: 20 },
  quickActions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  quickBtn: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  quickBtnIcon: { fontSize: 14, color: '#f5c518', fontWeight: '700' },
  quickBtnLabel: { color: '#888', fontSize: 11, marginTop: 4 },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
