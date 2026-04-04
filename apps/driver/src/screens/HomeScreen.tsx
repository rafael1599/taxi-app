import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { TabParamList } from '../navigation';
import { driverApi, type DriverProfile } from '../api/client';
import { useRideStore } from '../store/rideStore';
import { useAuthStore } from '../store/authStore';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { usePendingRides } from '../hooks/usePendingRides';

type Props = { navigation: BottomTabNavigationProp<TabParamList, 'Home'> };

export function HomeScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [online, setOnline] = useState(false);
  const [toggling, setToggling] = useState(false);
  const pendingRides = useRideStore((s) => s.pendingRides);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  useLocationTracking(online);
  usePendingRides(online);

  useEffect(() => {
    driverApi
      .me()
      .then(({ data }) => {
        setProfile(data);
        setOnline(data.isAvailable);
      })
      .catch(() => Alert.alert('Error', 'Could not load profile.'));
  }, []);

  const toggleOnline = async (value: boolean) => {
    setToggling(true);
    try {
      await driverApi.setAvailability(value);
      setOnline(value);
    } catch {
      Alert.alert('Error', 'Could not update availability.');
    } finally {
      setToggling(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            Hi, {profile?.fullName?.split(' ')[0] ?? '…'}
          </Text>
          <Text style={[styles.status, online ? styles.statusOnline : styles.statusOffline]}>
            {online ? '● Online' : '○ Offline'}
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

      {/* Pending ride requests */}
      {online ? (
        <>
          <Text style={styles.sectionTitle}>
            Ride Requests {pendingRides.length > 0 ? `(${pendingRides.length})` : ''}
          </Text>
          {pendingRides.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Waiting for ride requests…</Text>
            </View>
          ) : (
            <FlatList
              data={pendingRides}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.rideCard}
                  onPress={() =>
                    navigation.navigate('RideRequest' as never, { rideId: item.id } as never)
                  }
                >
                  <Text style={styles.rideAddress}>📍 {item.pickupAddress}</Text>
                  <Text style={styles.rideDest}>🏁 {item.dropoffAddress}</Text>
                  <View style={styles.rideFooter}>
                    <Text style={styles.rideFare}>${item.fareEstimate}</Text>
                    <Text style={styles.rideDist}>{item.distanceKm?.toFixed(1)} km</Text>
                  </View>
                </TouchableOpacity>
              )}
              contentContainerStyle={{ paddingBottom: 20 }}
            />
          )}
        </>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Toggle online to start receiving rides.</Text>
        </View>
      )}
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
  status: { fontSize: 13, marginTop: 2 },
  statusOnline: { color: '#4caf50' },
  statusOffline: { color: '#888' },
  headerRight: { alignItems: 'flex-end', gap: 8 },
  logoutBtn: { marginTop: 4 },
  logoutText: { color: '#f5c518', fontSize: 12 },
  sectionTitle: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  rideCard: {
    backgroundColor: '#2a2a42',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    padding: 16,
  },
  rideAddress: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  rideDest: { color: '#bbb', fontSize: 14, marginBottom: 10 },
  rideFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  rideFare: { color: '#f5c518', fontWeight: '700', fontSize: 16 },
  rideDist: { color: '#888', fontSize: 14 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#555', fontSize: 15 },
});
