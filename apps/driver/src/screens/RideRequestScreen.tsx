import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Vibration,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation';
import { tripApi, rideApi } from '../api/client';
import { useRideStore } from '../store/rideStore';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RideRequest'>;
  route: RouteProp<RootStackParamList, 'RideRequest'>;
};

export function RideRequestScreen({ navigation, route }: Props) {
  const { offerId } = route.params;
  const currentOffer = useRideStore((s) => s.currentOffer);
  const setCurrentOffer = useRideStore((s) => s.setCurrentOffer);
  const setActiveRide = useRideStore((s) => s.setActiveRide);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Find the offer data
  const offer = currentOffer?.offerId === offerId ? currentOffer : null;

  // Calculate initial seconds from expiresAt
  useEffect(() => {
    if (!offer) return;
    const expiresAt = new Date(offer.expiresAt).getTime();
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
    setSecondsLeft(remaining);
  }, [offer]);

  // Vibrate on mount to alert driver
  useEffect(() => {
    Vibration.vibrate([0, 500, 200, 500]);
  }, []);

  // Countdown timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Auto-dismiss when timer expires or offer is cleared
  useEffect(() => {
    if (secondsLeft === 0) {
      setCurrentOffer(null);
      navigation.goBack();
    }
  }, [secondsLeft, setCurrentOffer, navigation]);

  useEffect(() => {
    if (!currentOffer) {
      navigation.goBack();
    }
  }, [currentOffer, navigation]);

  const handleAccept = useCallback(async () => {
    if (!offer) return;
    setAccepting(true);
    try {
      await tripApi.acceptOffer(offer.offerId);
      setCurrentOffer(null);
      // Active ride will be set via SSE trip_confirmed event
      // But also fetch it directly as a fallback
      const { data } = await rideApi.get(offer.rideId);
      setActiveRide(data);
      navigation.replace('ActiveRide', { rideId: offer.rideId });
    } catch {
      Alert.alert('Unavailable', 'This offer is no longer available.');
      setCurrentOffer(null);
      navigation.goBack();
    } finally {
      setAccepting(false);
    }
  }, [offer, setCurrentOffer, setActiveRide, navigation]);

  const handleReject = useCallback(async () => {
    if (!offer) return;
    setRejecting(true);
    try {
      await tripApi.rejectOffer(offer.offerId);
    } catch {
      // already expired or rejected, that's fine
    }
    setCurrentOffer(null);
    setRejecting(false);
    navigation.goBack();
  }, [offer, setCurrentOffer, navigation]);

  if (!offer) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5c518" size="large" />
      </View>
    );
  }

  const progress = secondsLeft / 60;
  const urgentColor = secondsLeft <= 15 ? '#ff4444' : '#f5c518';

  return (
    <View style={styles.container}>
      {/* Countdown timer */}
      <View style={styles.timerContainer}>
        <View style={[styles.timerRing, { borderColor: urgentColor }]}>
          <Text style={[styles.timerText, { color: urgentColor }]}>{secondsLeft}</Text>
          <Text style={styles.timerLabel}>sec</Text>
        </View>
      </View>

      {/* Ride info */}
      <View style={styles.sheet}>
        <Text style={styles.label}>New Trip Request</Text>

        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: '#4caf50' }]} />
          <View style={styles.addressContainer}>
            <Text style={styles.addressLabel}>PICKUP</Text>
            <Text style={styles.address}>{offer.pickupAddress}</Text>
          </View>
        </View>

        <View style={styles.connector} />

        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: '#ff4444' }]} />
          <View style={styles.addressContainer}>
            <Text style={styles.addressLabel}>DROP-OFF</Text>
            <Text style={styles.address}>{offer.dropoffAddress}</Text>
          </View>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>${offer.fareEstimate ?? '—'}</Text>
            <Text style={styles.statLabel}>Fare</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{offer.distanceKm?.toFixed(1) ?? '—'} km</Text>
            <Text style={styles.statLabel}>Distance</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%`, backgroundColor: urgentColor },
            ]}
          />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.declineBtn}
            onPress={handleReject}
            disabled={rejecting || accepting}
          >
            {rejecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.declineText}>Decline</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.acceptBtn, { backgroundColor: urgentColor }]}
            onPress={handleAccept}
            disabled={accepting || rejecting}
          >
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  timerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2a2a42',
  },
  timerText: { fontSize: 48, fontWeight: '700' },
  timerLabel: { fontSize: 14, color: '#888', marginTop: -4 },
  sheet: {
    backgroundColor: '#2a2a42',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  label: { color: '#f5c518', fontWeight: '700', fontSize: 18, marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
    marginRight: 12,
  },
  connector: {
    width: 2,
    height: 20,
    backgroundColor: '#3a3a52',
    marginLeft: 5,
    marginVertical: 4,
  },
  addressContainer: { flex: 1, marginBottom: 4 },
  addressLabel: {
    fontSize: 10,
    color: '#888',
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 2,
  },
  address: { color: '#fff', fontSize: 14 },
  stats: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 20,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: '#fff', fontWeight: '700', fontSize: 22 },
  statLabel: { color: '#888', fontSize: 12, marginTop: 4 },
  statDivider: { width: 1, height: 36, backgroundColor: '#3a3a52' },
  progressBar: {
    height: 4,
    backgroundColor: '#3a3a52',
    borderRadius: 2,
    marginBottom: 20,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2 },
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
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  acceptText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
});
