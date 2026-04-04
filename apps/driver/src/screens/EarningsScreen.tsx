import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { rideApi, type Ride } from '../api/client';

interface EarningsStats {
  todayEarnings: number;
  weekEarnings: number;
  totalTrips: number;
  completedTrips: number;
}

function computeStats(rides: Ride[]): EarningsStats {
  const completed = rides.filter((r) => r.status === 'completed');
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

  const todayEarnings = completed
    .filter((r) => r.droppedOffAt && new Date(r.droppedOffAt).getTime() >= todayStart)
    .reduce((sum, r) => sum + parseFloat(r.fareFinal ?? r.fareEstimate ?? '0'), 0);

  const weekEarnings = completed
    .filter((r) => r.droppedOffAt && new Date(r.droppedOffAt).getTime() >= weekStart)
    .reduce((sum, r) => sum + parseFloat(r.fareFinal ?? r.fareEstimate ?? '0'), 0);

  return {
    todayEarnings,
    weekEarnings,
    totalTrips: rides.length,
    completedTrips: completed.length,
  };
}

function RideHistoryItem({ ride }: { ride: Ride }) {
  const fare = parseFloat(ride.fareFinal ?? ride.fareEstimate ?? '0');
  const date = new Date(ride.requestedAt);
  const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const isCompleted = ride.status === 'completed';

  return (
    <View style={styles.historyCard}>
      <View style={styles.historyLeft}>
        <Text style={styles.historyFrom} numberOfLines={1}>{ride.pickupAddress}</Text>
        <Text style={styles.historyTo} numberOfLines={1}>→ {ride.dropoffAddress}</Text>
        <Text style={styles.historyDate}>{label}</Text>
      </View>
      <View style={styles.historyRight}>
        <Text style={[styles.historyFare, !isCompleted && styles.cancelled]}>
          {isCompleted ? `$${fare.toFixed(2)}` : 'Cancelled'}
        </Text>
        <Text style={styles.historyDist}>{ride.distanceKm?.toFixed(1)} km</Text>
      </View>
    </View>
  );
}

export function EarningsScreen() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const { data } = await rideApi.list();
      setRides(data.filter((r) => r.status === 'completed' || r.status === 'cancelled'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const stats = computeStats(rides);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5c518" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Earnings summary */}
      <View style={styles.statsCard}>
        <Text style={styles.statsTitle}>Earnings Summary</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statAmount}>${stats.todayEarnings.toFixed(2)}</Text>
            <Text style={styles.statBoxLabel}>Today</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.statBox}>
            <Text style={styles.statAmount}>${stats.weekEarnings.toFixed(2)}</Text>
            <Text style={styles.statBoxLabel}>This Week</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.statBox}>
            <Text style={styles.statAmount}>{stats.completedTrips}</Text>
            <Text style={styles.statBoxLabel}>Completed</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Trip History</Text>

      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RideHistoryItem ride={item} />}
        contentContainerStyle={{ paddingBottom: 20 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor="#f5c518"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No trips yet. Start driving to earn!</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  statsCard: {
    backgroundColor: '#2a2a42',
    margin: 16,
    borderRadius: 16,
    padding: 20,
  },
  statsTitle: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.8 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statBox: { flex: 1, alignItems: 'center' },
  statAmount: { color: '#f5c518', fontSize: 22, fontWeight: '700' },
  statBoxLabel: { color: '#888', fontSize: 12, marginTop: 4 },
  divider: { width: 1, height: 40, backgroundColor: '#3a3a52' },
  sectionTitle: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  historyCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#2a2a42',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
  },
  historyLeft: { flex: 1, marginRight: 12 },
  historyFrom: { color: '#fff', fontSize: 14, fontWeight: '600' },
  historyTo: { color: '#bbb', fontSize: 13, marginVertical: 2 },
  historyDate: { color: '#666', fontSize: 12, marginTop: 4 },
  historyRight: { alignItems: 'flex-end', justifyContent: 'center' },
  historyFare: { color: '#f5c518', fontWeight: '700', fontSize: 16 },
  cancelled: { color: '#888' },
  historyDist: { color: '#666', fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 15 },
});
