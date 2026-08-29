#!/usr/bin/env bash
#
# build-apk.sh — Genera APK release de Rockland Taxi Driver App
#
# Uso:
#   ./scripts/build-apk.sh              # Build completo (bundle + APK)
#   ./scripts/build-apk.sh --bundle     # Solo generar JS bundle
#   ./scripts/build-apk.sh --native     # Solo compilar nativo (requiere bundle previo)
#   ./scripts/build-apk.sh --install    # Build completo + instalar en dispositivo
#
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
# Rutas detectadas por plataforma. Este script se usa desde el Mac y desde la PC
# Windows, asi que nada va cableado: se puede forzar con variables de entorno.

# Raiz del monorepo: $TAXI_APP_ROOT gana; si no, el primer candidato que exista.
MONOREPO_ROOT="${TAXI_APP_ROOT:-}"
if [ -z "$MONOREPO_ROOT" ]; then
  for candidato in \
    "$HOME/dev/confi-tec/taxi-app" \
    "$HOME/Documents/Projects/confi-tec/taxi-app" \
    "C:/Users/user/Documents/Projects/confi-tec/taxi-app"
  do
    if [ -d "$candidato" ]; then
      MONOREPO_ROOT="$candidato"
      break
    fi
  done
fi

if [ -z "$MONOREPO_ROOT" ] || [ ! -d "$MONOREPO_ROOT" ]; then
  echo "ERROR: no se encontro el monorepo de taxi-app." >&2
  echo "       Indicalo con: TAXI_APP_ROOT=/ruta/al/taxi-app $0" >&2
  exit 1
fi

DRIVER_DIR="${MONOREPO_ROOT}/apps/driver"
APK_OUTPUT="${DRIVER_DIR}/android/app/build/outputs/apk/release/app-release.apk"
BUNDLE_OUTPUT="${DRIVER_DIR}/android/app/src/main/assets/index.android.bundle"
ASSETS_DIR="${DRIVER_DIR}/android/app/src/main/res"

export EXPO_NO_METRO_WORKSPACE_ROOT=1

# JAVA_HOME y ANDROID_HOME: se respeta lo que ya venga del entorno (en el Mac,
# ANDROID_HOME lo exporta ~/.zshrc). Solo se rellena si faltan.
if [ -z "${JAVA_HOME:-}" ]; then
  for candidato in \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    "C:/Program Files/Android/Android Studio/jbr"
  do
    [ -d "$candidato" ] && export JAVA_HOME="$candidato" && break
  done
fi

if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "${ANDROID_HOME:-}" ]; then
  ANDROID_HOME=""
  for candidato in \
    "$HOME/Library/Android/sdk" \
    "C:/Users/user/AppData/Local/Android/Sdk"
  do
    [ -d "$candidato" ] && export ANDROID_HOME="$candidato" && break
  done
fi

# Sin toolchain de Android no tiene sentido seguir: mejor un error claro aqui
# que un fallo de Gradle treinta segundos despues.
if [ -z "${JAVA_HOME:-}" ] || [ -z "${ANDROID_HOME:-}" ]; then
  echo "ERROR: falta el toolchain de Android en esta maquina." >&2
  [ -z "${JAVA_HOME:-}"    ] && echo "       JAVA_HOME sin resolver (falta Android Studio o un JDK)." >&2
  [ -z "${ANDROID_HOME:-}" ] && echo "       ANDROID_HOME sin resolver (falta el SDK de Android)." >&2
  echo "       Este build se hace desde la PC Windows. Si quieres hacerlo aqui," >&2
  echo "       instala Android Studio + SDK, o exporta JAVA_HOME y ANDROID_HOME." >&2
  exit 1
fi

# ── Parse args ──────────────────────────────────────────────────────────────
MODE="${1:---all}"

# ── Functions ───────────────────────────────────────────────────────────────

bundle_js() {
  echo ""
  echo "========================================"
  echo "  [1/2] Generating JS bundle..."
  echo "========================================"
  echo ""

  cd "${DRIVER_DIR}"
  mkdir -p android/app/src/main/assets

  npx expo export:embed \
    --platform android \
    --entry-file index.js \
    --bundle-output "${BUNDLE_OUTPUT}" \
    --assets-dest "${ASSETS_DIR}" \
    --dev false

  local size
  size=$(wc -c < "${BUNDLE_OUTPUT}" 2>/dev/null || echo "0")
  echo ""
  echo "[OK] JS bundle generated ($(( size / 1024 )) KB)"
}

build_native() {
  echo ""
  echo "========================================"
  echo "  [2/2] Building native APK..."
  echo "========================================"
  echo ""

  cd "${DRIVER_DIR}"

  # Verificar que el bundle existe
  if [ ! -f "${BUNDLE_OUTPUT}" ]; then
    echo "[ERROR] JS bundle not found. Run with --bundle first."
    exit 1
  fi

  # Verificar local.properties
  if [ ! -f android/local.properties ]; then
    echo "sdk.dir=C:\\\\Users\\\\user\\\\AppData\\\\Local\\\\Android\\\\Sdk" > android/local.properties
    echo "[INFO] Created android/local.properties"
  fi

  # Temporalmente deshabilitar el task de bundling en Gradle
  # (ya tenemos el bundle pre-generado)
  local BUILD_GRADLE="android/app/build.gradle"
  local SKIP_MARKER="// AUTO-SKIP-BUNDLE"

  if ! grep -q "${SKIP_MARKER}" "${BUILD_GRADLE}"; then
    sed -i "s/^dependencies {/${SKIP_MARKER}\ntasks.configureEach { task -> if (task.name == 'createBundleReleaseJsAndAssets') { task.enabled = false } }\n\ndependencies {/" "${BUILD_GRADLE}"
  fi

  android/gradlew.bat -p android app:assembleRelease \
    -x lint -x test \
    --configure-on-demand --build-cache

  # Restaurar build.gradle (quitar skip)
  sed -i "/${SKIP_MARKER}/d" "${BUILD_GRADLE}"
  sed -i "/tasks.configureEach { task -> if (task.name == 'createBundleReleaseJsAndAssets') { task.enabled = false } }/d" "${BUILD_GRADLE}"

  if [ -f "${APK_OUTPUT}" ]; then
    local apk_size
    apk_size=$(wc -c < "${APK_OUTPUT}")
    echo ""
    echo "========================================"
    echo "  APK READY!"
    echo "  Size: $(( apk_size / 1048576 )) MB"
    echo "  Path: ${APK_OUTPUT}"
    echo "========================================"
  else
    echo "[ERROR] APK not found at expected location"
    exit 1
  fi
}

install_apk() {
  echo ""
  echo "[INSTALL] Installing APK on connected device..."
  adb install -r "${APK_OUTPUT}"
  echo "[OK] APK installed"
}

# ── Main ────────────────────────────────────────────────────────────────────

echo ""
echo "  Rockland Taxi Driver — APK Builder"
echo "  ==================================="
echo "  Mode: ${MODE}"
echo ""

case "${MODE}" in
  --bundle)
    bundle_js
    ;;
  --native)
    build_native
    ;;
  --install)
    bundle_js
    build_native
    install_apk
    ;;
  --all|*)
    bundle_js
    build_native
    ;;
esac

echo ""
echo "Done!"
