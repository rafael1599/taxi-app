import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { authApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import {
  authenticateWithBiometric,
  clearCredentials,
  getBiometricLabel,
  getSecurityLevel,
  isBiometricAvailable,
  loadCredentials,
  saveCredentials,
} from '../utils/biometrics';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Login'> };

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Biometric');
  const setAuth = useAuthStore((s) => s.setAuth);

  // On mount: restore saved credentials + check biometric/device auth availability
  useEffect(() => {
    (async () => {
      // Pre-fill fields if credentials were saved
      const creds = await loadCredentials();
      if (creds) {
        setEmail(creds.email);
        setPassword(creds.password);
        setRememberMe(true);
      }

      // Enable quick login button if saved creds exist + device has any security
      if (creds) {
        const bioAvailable = await isBiometricAvailable();
        if (bioAvailable) {
          setBiometricReady(true);
          const label = await getBiometricLabel();
          setBiometricLabel(label);
        } else {
          // No biometric hardware, but check if device has PIN/pattern/password
          // SecurityLevel: 0=NONE, 1=SECRET (PIN), 2=BIOMETRIC
          const securityLevel = await getSecurityLevel();
          console.log('[Auth] Device security level:', securityLevel);
          if (securityLevel >= 1) {
            setBiometricReady(true);
            setBiometricLabel('PIN / Password');
          }
        }
      }
    })();
  }, []);

  const doLogin = useCallback(
    async (loginEmail: string, loginPassword: string, shouldSave: boolean) => {
      setLoading(true);
      try {
        const { data } = await authApi.login(loginEmail, loginPassword);

        // Save or clear credentials based on checkbox
        if (shouldSave) {
          await saveCredentials(loginEmail, loginPassword);
        } else {
          await clearCredentials();
        }

        setAuth(data.token, data.driverId);
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Login failed. Please try again.';
        Alert.alert('Error', msg);
      } finally {
        setLoading(false);
      }
    },
    [setAuth],
  );

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Validation', 'Email and password are required.');
      return;
    }
    await doLogin(email.trim().toLowerCase(), password, rememberMe);
  };

  const handleBiometricLogin = async () => {
    const success = await authenticateWithBiometric();
    if (!success) return;

    const creds = await loadCredentials();
    if (!creds) {
      Alert.alert('Error', 'No saved credentials found. Please sign in manually.');
      setBiometricReady(false);
      return;
    }

    await doLogin(creds.email, creds.password, true);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>{'\u{1F696}'} Rockland Taxi</Text>
        <Text style={styles.subtitle}>Driver Portal</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#999"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {/* Remember me checkbox */}
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setRememberMe((v) => !v)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
            {rememberMe && <Text style={styles.checkmark}>{'\u2713'}</Text>}
          </View>
          <Text style={styles.checkboxLabel}>Remember my credentials</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Sign In</Text>
          )}
        </TouchableOpacity>

        {/* Biometric login button */}
        {biometricReady && (
          <TouchableOpacity
            style={styles.biometricBtn}
            onPress={handleBiometricLogin}
            disabled={loading}
          >
            <Text style={styles.biometricBtnText}>Sign in with {biometricLabel}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={() => navigation.navigate('Register')}>
          <Text style={styles.link}>New driver? Register here</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#f5c518',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 36,
  },
  input: {
    backgroundColor: '#2a2a42',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 14,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#666',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#f5c518',
    borderColor: '#f5c518',
  },
  checkmark: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    color: '#ccc',
    fontSize: 14,
  },
  btn: {
    backgroundColor: '#f5c518',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
  biometricBtn: {
    borderWidth: 1.5,
    borderColor: '#f5c518',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  biometricBtnText: {
    color: '#f5c518',
    fontWeight: '600',
    fontSize: 15,
  },
  link: { color: '#f5c518', textAlign: 'center', fontSize: 14 },
});
