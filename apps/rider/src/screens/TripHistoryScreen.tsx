import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { rideApi, type Ride, type RideStatus } from '../api/client';

const STATUS_COLOR: Record<RideStatus, string> = {
  requested: '#aaa',
  accepted: '#42a5f5',
  arrived: '#42a5f5',
  in_progress: '#f5c518',
  completed: '#4caf50',
  cancelled: '#e57373',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TripHistoryScreen() {
  const [trips, setTrips] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await rideApi.history();
      setTrips(data);
    } catch {
      Alert.alert('Error', 'Could not load trip history.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5c518" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Trip History</Text>
      {trips.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No trips yet.</Text>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#f5c518" />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={[styles.statusBadge, { color: STATUS_COLOR[item.status] }]}>
                  {item.status.replace('_', ' ').toUpperCase()}
                </Text>
                <Text style={styles.date}>{formatDate(item.requestedAt)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.icon}>📍</Text>
                <Text style={styles.address}>{item.pickupAddress}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.icon}>🏁</Text>
                <Text style={styles.address}>{item.dropoffAddress}</Text>
              </View>
              <View style={styles.cardFooter}>
                {item.fareFinal || item.fareEstimate ? (
                  <Text style={styles.fare}>${item.fareFinal ?? item.fareEstimate}</Text>
                ) : null}
                {item.distanceKm ? (
                  <Text style={styles.meta}>{item.distanceKm.toFixed(1)} km</Text>
                ) : null}
                {item.durationMin ? (
                  <Text style={styles.meta}>{item.durationMin} min</Text>
                ) : null}
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    backgroundColor: '#2a2a42',
  },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#555', fontSize: 15 },
  card: {
    backgroundColor: '#2a2a42',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 16,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusBadge: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  date: { color: '#666', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  icon: { fontSize: 15, marginRight: 8 },
  address: { color: '#bbb', fontSize: 14, flex: 1 },
  cardFooter: { flexDirection: 'row', gap: 16, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#3a3a52' },
  fare: { color: '#f5c518', fontWeight: '700', fontSize: 18 },
  meta: { color: '#888', fontSize: 14, alignSelf: 'flex-end' },
});
