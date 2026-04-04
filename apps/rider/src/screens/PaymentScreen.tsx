import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { paymentApi, type PaymentMethod } from '../api/client';

const CARD_BRAND_ICON: Record<string, string> = {
  visa: '💳',
  mastercard: '💳',
  amex: '💳',
  discover: '💳',
};

export function PaymentScreen() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const load = useCallback(async () => {
    try {
      const { data } = await paymentApi.listMethods();
      setMethods(data);
    } catch {
      Alert.alert('Error', 'Could not load payment methods.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAddCard = async () => {
    setAdding(true);
    try {
      const { data } = await paymentApi.createSetupIntent();
      const { error: initError } = await initPaymentSheet({
        setupIntentClientSecret: data.clientSecret,
        merchantDisplayName: 'Rockland Taxi',
        style: 'alwaysDark',
      });
      if (initError) {
        Alert.alert('Error', initError.message);
        return;
      }
      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') {
          Alert.alert('Error', presentError.message);
        }
        return;
      }
      // Reload methods after successful setup
      await load();
    } catch {
      Alert.alert('Error', 'Could not add payment method.');
    } finally {
      setAdding(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await paymentApi.setDefault(id);
      setMethods((prev) =>
        prev.map((m) => ({ ...m, isDefault: m.id === id }))
      );
    } catch {
      Alert.alert('Error', 'Could not update default payment method.');
    }
  };

  const handleRemove = (id: string) => {
    Alert.alert('Remove Card', 'Remove this payment method?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await paymentApi.remove(id);
            setMethods((prev) => prev.filter((m) => m.id !== id));
          } catch {
            Alert.alert('Error', 'Could not remove payment method.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5c518" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Payment Methods</Text>

      {methods.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No payment methods saved.</Text>
        </View>
      ) : (
        <FlatList
          data={methods}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardLeft}>
                <Text style={styles.cardIcon}>
                  {CARD_BRAND_ICON[item.brand.toLowerCase()] ?? '💳'}
                </Text>
                <View>
                  <Text style={styles.cardBrand}>
                    {item.brand.charAt(0).toUpperCase() + item.brand.slice(1)} •••• {item.last4}
                  </Text>
                  <Text style={styles.cardExpiry}>
                    Expires {item.expMonth}/{item.expYear}
                  </Text>
                </View>
              </View>
              <View style={styles.cardActions}>
                {item.isDefault ? (
                  <View style={styles.defaultBadge}>
                    <Text style={styles.defaultBadgeText}>Default</Text>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => handleSetDefault(item.id)}>
                    <Text style={styles.setDefaultText}>Set Default</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => handleRemove(item.id)} style={styles.removeBtn}>
                  <Text style={styles.removeText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={handleAddCard}
          disabled={adding}
        >
          {adding ? (
            <ActivityIndicator color="#1a1a2e" />
          ) : (
            <Text style={styles.addBtnText}>+ Add Payment Method</Text>
          )}
        </TouchableOpacity>
      </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardIcon: { fontSize: 28 },
  cardBrand: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardExpiry: { color: '#888', fontSize: 12, marginTop: 2 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  defaultBadge: {
    backgroundColor: '#3a3a52',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  defaultBadgeText: { color: '#4caf50', fontSize: 11, fontWeight: '700' },
  setDefaultText: { color: '#f5c518', fontSize: 12 },
  removeBtn: { padding: 4 },
  removeText: { color: '#e57373', fontSize: 16, fontWeight: '700' },
  footer: { padding: 20, paddingBottom: 36 },
  addBtn: {
    backgroundColor: '#f5c518',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  addBtnText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
});
