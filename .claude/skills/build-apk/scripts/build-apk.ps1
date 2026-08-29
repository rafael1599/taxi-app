#
# build-apk.ps1 — Genera APK release de Rockland Taxi Driver App (PowerShell)
#
# Uso:
#   .\scripts\build-apk.ps1              # Build completo (bundle + APK)
#   .\scripts\build-apk.ps1 -Bundle      # Solo generar JS bundle
#   .\scripts\build-apk.ps1 -Native      # Solo compilar nativo (requiere bundle previo)
#   .\scripts\build-apk.ps1 -Install     # Build completo + instalar en dispositivo
#
param(
    [switch]$Bundle,
    [switch]$Native,
    [switch]$Install
)

# ── Config ──────────────────────────────────────────────────────────────────
$MonorepoRoot = "C:\Users\user\Documents\Projects\confi-tec\taxi-app"
$DriverDir = "$MonorepoRoot\apps\driver"
$ApkOutput = "$DriverDir\android\app\build\outputs\apk\release\app-release.apk"
$BundleOutput = "$DriverDir\android\app\src\main\assets\index.android.bundle"
$AssetsDir = "$DriverDir\android\app\src\main\res"

$env:EXPO_NO_METRO_WORKSPACE_ROOT = "1"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "C:\Users\user\AppData\Local\Android\Sdk"

# ── Functions ───────────────────────────────────────────────────────────────

function Build-JsBundle {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [1/2] Generating JS bundle..." -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    Set-Location $DriverDir

    if (-not (Test-Path "android\app\src\main\assets")) {
        New-Item -ItemType Directory -Path "android\app\src\main\assets" -Force | Out-Null
    }

    npx expo export:embed `
        --platform android `
        --entry-file index.js `
        --bundle-output $BundleOutput `
        --assets-dest $AssetsDir `
        --dev false

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] JS bundle generation failed" -ForegroundColor Red
        exit 1
    }

    $size = (Get-Item $BundleOutput).Length / 1KB
    Write-Host ""
    Write-Host "[OK] JS bundle generated ($([math]::Round($size)) KB)" -ForegroundColor Green
}

function Build-NativeApk {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [2/2] Building native APK..." -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    Set-Location $DriverDir

    # Verificar bundle existe
    if (-not (Test-Path $BundleOutput)) {
        Write-Host "[ERROR] JS bundle not found. Run with -Bundle first." -ForegroundColor Red
        exit 1
    }

    # Verificar local.properties
    if (-not (Test-Path "android\local.properties")) {
        "sdk.dir=C:\\Users\\user\\AppData\\Local\\Android\\Sdk" | Out-File -FilePath "android\local.properties" -Encoding UTF8
        Write-Host "[INFO] Created android\local.properties" -ForegroundColor Yellow
    }

    # Build con Gradle (skip JS bundling ya que tenemos bundle pre-generado)
    & android\gradlew.bat -p android app:assembleRelease `
        -x lint -x test -x createBundleReleaseJsAndAssets `
        --configure-on-demand --build-cache

    # Nota: -x createBundleReleaseJsAndAssets puede fallar si Gradle
    # tiene dependencias estrictas. En ese caso, deshabilitar el task
    # en build.gradle temporalmente.

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] Gradle skip failed, trying with task disabled in build.gradle..." -ForegroundColor Yellow

        $buildGradle = "android\app\build.gradle"
        $content = Get-Content $buildGradle -Raw
        $skipBlock = @"
// AUTO-SKIP-BUNDLE
tasks.configureEach { task ->
    if (task.name == 'createBundleReleaseJsAndAssets') {
        task.enabled = false
    }
}

"@
        if ($content -notmatch "AUTO-SKIP-BUNDLE") {
            $content = $content -replace "dependencies \{", "${skipBlock}dependencies {"
            $content | Set-Content $buildGradle -Encoding UTF8
        }

        & android\gradlew.bat -p android app:assembleRelease `
            -x lint -x test `
            --configure-on-demand --build-cache

        # Restaurar build.gradle
        $content = Get-Content $buildGradle -Raw
        $content = $content -replace "// AUTO-SKIP-BUNDLE\r?\ntasks\.configureEach \{ task ->\r?\n\s+if \(task\.name == 'createBundleReleaseJsAndAssets'\) \{ task\.enabled = false \}\r?\n\}\r?\n\r?\n", ""
        $content | Set-Content $buildGradle -Encoding UTF8
    }

    if (Test-Path $ApkOutput) {
        $apkSize = (Get-Item $ApkOutput).Length / 1MB
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  APK READY!" -ForegroundColor Green
        Write-Host "  Size: $([math]::Round($apkSize)) MB" -ForegroundColor Green
        Write-Host "  Path: $ApkOutput" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] APK not found" -ForegroundColor Red
        exit 1
    }
}

function Install-Apk {
    Write-Host ""
    Write-Host "[INSTALL] Installing APK on connected device..." -ForegroundColor Cyan
    adb install -r $ApkOutput
    Write-Host "[OK] APK installed" -ForegroundColor Green
}

# ── Main ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  Rockland Taxi Driver - APK Builder" -ForegroundColor Yellow
Write-Host "  ===================================" -ForegroundColor Yellow
Write-Host ""

if ($Bundle) {
    Build-JsBundle
} elseif ($Native) {
    Build-NativeApk
} elseif ($Install) {
    Build-JsBundle
    Build-NativeApk
    Install-Apk
} else {
    # Default: build all
    Build-JsBundle
    Build-NativeApk
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
