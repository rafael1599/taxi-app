import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation';
import { ratingApi } from '../api/client';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RateRide'>;
  route: RouteProp<RootStackParamList, 'RateRide'>;
};

const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

export function RateRideScreen({ navigation, route }: Props) {
  const { rideId, fare } = route.params;
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (score === 0) {
      Alert.alert('Rating Required', 'Please tap a star to rate your ride.');
      return;
    }
    setSubmitting(true);
    try {
      await ratingApi.submit(rideId, score, comment.trim() || undefined);
      navigation.replace('Tabs');
    } catch {
      Alert.alert('Error', 'Could not submit rating. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    navigation.replace('Tabs');
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.checkmark}>&#10003;</Text>
        <Text style={styles.title}>Ride Complete</Text>

        {fare ? (
          <View style={styles.fareBox}>
            <Text style={styles.fareLabel}>Total Fare</Text>
            <Text style={styles.fareValue}>${fare}</Text>
          </View>
        ) : null}

        <Text style={styles.subtitle}>How was your ride?</Text>

        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((s) => (
            <TouchableOpacity key={s} onPress={() => setScore(s)} style={styles.starBtn}>
              <Text style={[styles.star, s <= score && styles.starActive]}>
                {s <= score ? '\u2605' : '\u2606'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {score > 0 && <Text style={styles.starLabel}>{STAR_LABELS[score]}</Text>}

        <TextInput
          style={styles.commentInput}
          placeholder="Leave a comment (optional)"
          placeholderTextColor="#666"
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={500}
        />

        <TouchableOpacity
          style={[styles.submitBtn, score === 0 && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting || score === 0}
        >
          {submitting ? (
            <ActivityIndicator color="#1a1a2e" />
          ) : (
            <Text style={styles.submitBtnText}>Submit Rating</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
          <Text style={styles.skipBtnText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#2a2a42',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
  },
  checkmark: {
    fontSize: 48,
    color: '#4caf50',
    marginBottom: 8,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  fareBox: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginVertical: 16,
  },
  fareLabel: {
    color: '#888',
    fontSize: 13,
    marginBottom: 4,
  },
  fareValue: {
    color: '#f5c518',
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    color: '#ccc',
    fontSize: 16,
    marginBottom: 16,
  },
  stars: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  starBtn: {
    padding: 4,
  },
  star: {
    fontSize: 36,
    color: '#3a3a52',
  },
  starActive: {
    color: '#f5c518',
  },
  starLabel: {
    color: '#f5c518',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
  },
  commentInput: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 14,
    width: '100%',
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  submitBtn: {
    backgroundColor: '#f5c518',
    borderRadius: 12,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#1a1a2e',
    fontWeight: '700',
    fontSize: 16,
  },
  skipBtn: {
    marginTop: 16,
    padding: 8,
  },
  skipBtnText: {
    color: '#666',
    fontSize: 14,
  },
});
