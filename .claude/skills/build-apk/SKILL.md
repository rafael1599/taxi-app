---
name: build-apk
description: "Build release APK for Rockland Taxi driver app (React Native / Expo SDK 55, pnpm monorepo). Covers JS bundling, Gradle build, device install, and all known pitfalls from real debugging sessions."
trigger: "User asks to build APK, create release build, export Android app, install on device, or debug APK build failures for the driver app."
---

> ⚠️ **Desactualizaciones conocidas** (revisión del 29 ago 2026 contra el repo, sin ejecutar el build):
> el paquete Android es ahora `com.drivly.driver` (`apps/driver/app.config.ts`), no `com.rocklandtaxi.driver`;
> `apps/driver/android/` no está versionado (`.gitignore`), hay que regenerarlo con `expo prebuild` antes de
> cualquier paso de Gradle; la rama Unix de `scripts/build-apk.sh` invoca `gradlew.bat` y usa `sed -i` estilo
> GNU (falla en macOS); `build-apk.ps1` asume `C:\Users\user\Documents\Projects\confi-tec\taxi-app`.
> El build se hace desde la PC Windows: este Mac no tiene toolchain de Android. Lo que sigue vigente:
> `metro.config.js` (dedup de React), `index.js` como entry, `extra.apiBaseUrl`, Expo ~55 / RN 0.83.


# Build APK — Rockland Taxi Driver App

## Prerequisites

- **JAVA_HOME:** `C:/Program Files/Android/Android Studio/jbr`
- **ANDROID_HOME:** `C:/Users/user/AppData/Local/Android/Sdk`
- **ADB:** `C:/Users/user/AppData/Local/Android/Sdk/platform-tools/adb.exe`
- **Working directory:** `apps/driver/` within the monorepo

## Critical Environment Variables

- **`EXPO_NO_METRO_WORKSPACE_ROOT=1`** — Prevents Expo CLI from auto-detecting monorepo root as project root during `export:embed`. Without this, Metro resolves `./index.js` from the monorepo root instead of `apps/driver/`.
- **`API_BASE_URL=http://<LAN_IP>:3000`** — Must be set during BOTH bundle and Gradle build steps. This value gets embedded into `app.config.ts` via `expoConfig.extra.apiBaseUrl`. If not set, defaults to `localhost:3000` which won't work on real devices.

## Step 1: Bundle JS

```bash
cd apps/driver
EXPO_NO_METRO_WORKSPACE_ROOT=1 API_BASE_URL=http://<LAN_IP>:3000 \
  npx expo export:embed \
  --platform android \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res \
  --dev false \
  --reset-cache
```

## Step 2: Build APK

```bash
API_BASE_URL=http://<LAN_IP>:3000 \
  JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" \
  ANDROID_HOME="C:/Users/user/AppData/Local/Android/Sdk" \
  android/gradlew.bat -p android app:assembleRelease \
  -x lint -x test --configure-on-demand --build-cache
```

Note: `createBundleReleaseJsAndAssets` task must be disabled in `build.gradle` since we pre-bundle JS in step 1.

## Step 3: Install on device

```bash
adb -s <DEVICE_SERIAL> install -r android/app/build/outputs/apk/release/app-release.apk
```

## Step 4: Verify

```bash
adb -s <DEVICE_SERIAL> logcat -c
adb -s <DEVICE_SERIAL> shell am start -n com.rocklandtaxi.driver/com.rocklandtaxi.driver.MainActivity
sleep 5
adb -s <DEVICE_SERIAL> logcat -d | grep "ReactNativeJS\|FATAL\|AndroidRuntime"
```

Expected good output:

```
[API] BASE_URL resolved to: http://<LAN_IP>:3000
[API] __DEV__: false
Running "main"
```

## Known Issues & Fixes

### 1. "TypeError: Cannot read property 'useRef' of null" (crash on launch)

**Cause:** Multiple copies of React in the monorepo (react@19.2.0 at root + react@18.2.0 nested in 11+ packages like react-dom, zustand, react-freeze, use-latest-callback, etc.)

**Fix:** `metro.config.js` uses `resolveRequest` to intercept ALL `react` and `react/*` imports and redirect them to the single root copy at `<monorepo>/node_modules/react/index.js`. The blockList regex alone is NOT sufficient.

**Verify:** `grep -c "react.production" android/app/src/main/assets/index.android.bundle` should return `1`.

### 2. Network Error on real device (HTTP blocked)

**Cause:** Android 9+ blocks cleartext HTTP traffic by default.

**Fix:**
- Created `android/app/src/main/res/xml/network_security_config.xml` with allowed domains (10.0.2.2, localhost, LAN IP)
- Added `android:networkSecurityConfig="@xml/network_security_config"` to `<application>` in AndroidManifest.xml

### 3. "Unable to resolve module ./index.js" during bundle

**Cause:** `expo export:embed` resolves monorepo root as project root.

**Fix:** Set `EXPO_NO_METRO_WORKSPACE_ROOT=1` before bundling.

### 4. SDK location not found

**Fix:** Create `android/local.properties` with `sdk.dir=C:\\Users\\user\\AppData\\Local\\Android\\Sdk`

### 5. Gradle version issues

- AGP requires minimum Gradle 8.13
- Set in `android/gradle/wrapper/gradle-wrapper.properties`

### 6. Port 3000 not accessible from phone on same WiFi

**Cause:** Windows Firewall blocks incoming connections.

**Fix:** Run as admin: `netsh advfirewall firewall add rule name="Rockland Taxi API (port 3000)" dir=in action=allow protocol=tcp localport=3000`

### 7. Custom entry point for pnpm hoisted monorepo

- `package.json` uses `"main": "./index.js"` instead of `"expo/AppEntry"`
- Custom `index.js` at project root: `import { registerRootComponent } from 'expo'; import App from './App'; registerRootComponent(App);`

## Key Files

- `apps/driver/metro.config.js` — React dedup via resolveRequest + monorepo watchFolders
- `apps/driver/index.js` — Custom entry point
- `apps/driver/android/app/src/main/res/xml/network_security_config.xml` — Cleartext HTTP config
- `apps/driver/android/app/src/main/AndroidManifest.xml` — References network security config
- `apps/driver/android/app/build.gradle` — Has createBundleReleaseJsAndAssets disabled
- `apps/driver/android/local.properties` — SDK path

## Device Info

- Samsung phone serial: `R5CY13HXBVP`
- Emulator: `emulator-5554`
- Package name: `com.rocklandtaxi.driver`
- Main activity: `com.rocklandtaxi.driver.MainActivity`
