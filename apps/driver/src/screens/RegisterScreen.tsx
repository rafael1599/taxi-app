import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { authApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Register'> };

export function RegisterScreen({ navigation }: Props) {
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    licenseNumber: '',
    tlcLicense: '',
  });
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  const set = (key: keyof typeof form) => (val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const handleRegister = async () => {
    if (!form.fullName || !form.phone || !form.email || !form.password || !form.licenseNumber) {
      Alert.alert('Validation', 'Please fill in all required fields.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await authApi.register({
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        licenseNumber: form.licenseNumber.trim(),
        tlcLicense: form.tlcLicense.trim() || undefined,
      });
      setAuth(data.token, data.driverId);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Registration failed. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const fields: { label: string; key: keyof typeof form; keyboard?: 'email-address' | 'phone-pad'; secure?: boolean; required?: boolean }[] = [
    { label: 'Full Name *', key: 'fullName', required: true },
    { label: 'Phone *', key: 'phone', keyboard: 'phone-pad', required: true },
    { label: 'Email *', key: 'email', keyboard: 'email-address', required: true },
    { label: 'Password *', key: 'password', secure: true, required: true },
    { label: 'Driver License # *', key: 'licenseNumber', required: true },
    { label: 'TLC License # (optional)', key: 'tlcLicense' },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Register as a Rockland Taxi driver</Text>

        {fields.map(({ label, key, keyboard, secure }) => (
          <TextInput
            key={key}
            style={styles.input}
            placeholder={label}
            placeholderTextColor="#999"
            autoCapitalize="none"
            keyboardType={keyboard}
            secureTextEntry={secure}
            value={form[key]}
            onChangeText={set(key)}
          />
        ))}

        <TouchableOpacity style={styles.btn} onPress={handleRegister} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#1a1a2e" />
          ) : (
            <Text style={styles.btnText}>Register</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>Already have an account? Sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  inner: { paddingHorizontal: 28, paddingTop: 60, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', color: '#f5c518', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 28 },
  input: {
    backgroundColor: '#2a2a42',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: '#f5c518',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  btnText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
  link: { color: '#f5c518', textAlign: 'center', fontSize: 14 },
});
