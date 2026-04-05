import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { driverApi, rideApi, type DriverProfile } from '../api/client';
import { useRideStore } from '../store/rideStore';
import { useAuthStore } from '../store/authStore';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { useSSE } from '../hooks/useSSE';

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [online, setOnline] = useState(false);
  const [toggling, setToggling] = useState(false);
  const currentOffer = useRideStore((s) => s.currentOffer);
  const activeRide = useRideStore((s) => s.activeRide);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  useLocationTracking(online);
  useSSE(online);

  // Load profile on mount
  useEffect(() => {
    driverApi
      .me()
      .then(({ data }) => {
        setProfile(data);
        setOnline(data.isAvailable);
      })
      .catch(() => Alert.alert('Error', 'Could not load profile.'));
  }, []);

  // Navigate to offer screen when a trip offer arrives
  useEffect(() => {
    if (currentOffer) {
      navigation.navigate('RideRequest', { offerId: currentOffer.offerId });
    }
  }, [currentOffer, navigation]);

  // Navigate to active ride when one is confirmed
  useEffect(() => {
    if (
      activeRide &&
      ['accepted', 'en_route', 'arrived', 'picked_up'].includes(activeRide.status)
    ) {
      navigation.navigate('ActiveRide', { rideId: activeRide.id });
    }
  }, [activeRide, navigation]);

  // Check for existing active ride on mount
  useEffect(() => {
    rideApi
      .list()
      .then(({ data }) => {
        const active = data.find((r) =>
          ['accepted', 'en_route', 'arrived', 'picked_up'].includes(r.status),
        );
        if (active) {
          useRideStore.getState().setActiveRide(active);
        }
      })
      .catch(() => {});
  }, []);

  const toggleOnline = useCallback(async (value: boolean) => {
    setToggling(true);
    try {
      if (value) {
        await driverApi.goOnline();
      } else {
        await driverApi.goOffline();
      }
      setOnline(value);
    } catch {
      Alert.alert('Error', 'Could not update status.');
    } finally {
      setToggling(false);
    }
  }, []);

  const statusColor = online ? '#4caf50' : '#888';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {profile?.fullName?.split(' ')[0] ?? '...'}</Text>
          <Text style={[styles.status, { color: statusColor }]}>
            {online ? 'Online' : 'Offline'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {toggling ? (
            <ActivityIndicator color="#f5c518" />
          ) : (
            <Switch
              value={online}
              onValueChange={toggleOnline}
              trackColor={{ false: '#444', true: '#f5c518' }}
              thumbColor={online ? '#fff' : '#888'}
            />
          )}
          <TouchableOpacity onPress={clearAuth} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main content */}
      <View style={styles.body}>
        {online ? (
          <View style={styles.waitingContainer}>
            <View style={styles.pulseOuter}>
              <View style={styles.pulseInner}>
                <Text style={styles.carIcon}>{'<car>'}</Text>
              </View>
            </View>
            <Text style={styles.waitingTitle}>Waiting for rides...</Text>
            <Text style={styles.waitingSubtitle}>You'll be notified when a trip is available</Text>
          </View>
        ) : (
          <View style={styles.waitingContainer}>
            <Text style={styles.offlineIcon}>{'<power>'}</Text>
            <Text style={styles.waitingTitle}>You're offline</Text>
            <Text style={styles.waitingSubtitle}>
              Toggle the switch above to start receiving rides
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 56,
    backgroundColor: '#2a2a42',
  },
  greeting: { fontSize: 20, fontWeight: '700', color: '#fff' },
  status: { fontSize: 13, marginTop: 2, fontWeight: '600' },
  headerRight: { alignItems: 'flex-end', gap: 8 },
  logoutBtn: { marginTop: 4 },
  logoutText: { color: '#f5c518', fontSize: 12 },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  waitingContainer: { alignItems: 'center', paddingHorizontal: 40 },
  pulseOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(245, 197, 24, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  pulseInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 197, 24, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  carIcon: { fontSize: 32, color: '#f5c518' },
  offlineIcon: { fontSize: 48, color: '#555', marginBottom: 24 },
  waitingTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  waitingSubtitle: { fontSize: 14, color: '#888', textAlign: 'center' },
});
