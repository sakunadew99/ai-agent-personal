$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created apps/mobile/.env from the example. Set EXPO_PUBLIC_API_URL to your backend address, then run npm run build:apk again."
  exit 1
}

$env:EXPO_HOME = Join-Path $PSScriptRoot ".expo-local"
$env:EXPO_NO_TELEMETRY = "1"

# Prefer the installed JDK directly. On some Windows setups `java.exe` on PATH
# is an Oracle launcher shim that can hang when Gradle probes the Java version.
if (-not $env:JAVA_HOME) {
  $knownJdk = "C:\Program Files\Java\jdk-21"
  if (Test-Path (Join-Path $knownJdk "bin\java.exe")) {
    $env:JAVA_HOME = $knownJdk
  }
}
if ($env:JAVA_HOME) {
  $env:PATH = "$(Join-Path $env:JAVA_HOME 'bin');$env:PATH"
}

if (-not $env:ANDROID_HOME) {
  $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
if (-not $env:ANDROID_SDK_ROOT -and $env:ANDROID_HOME) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }

if ($env:ANDROID_HOME) {
  $sdkManager = Join-Path $env:ANDROID_HOME "cmdline-tools\latest\bin\sdkmanager.bat"
  if (-not (Test-Path $sdkManager)) {
    Write-Error "Android SDK Command-line Tools are missing at $sdkManager. Install/extract Google's command-line tools into cmdline-tools\latest, then run this build again."
  }

  $packageChecks = @(
    @{ Package = "platform-tools"; Path = "platform-tools\adb.exe" },
    @{ Package = "platforms;android-37.0"; Path = "platforms\android-37.0\android.jar" },
    @{ Package = "build-tools;37.0.0"; Path = "build-tools\37.0.0\aapt.exe" },
    @{ Package = "ndk;27.0.12077973"; Path = "ndk\27.0.12077973\source.properties" }
  )
  $missingPackages = @($packageChecks | Where-Object { -not (Test-Path (Join-Path $env:ANDROID_HOME $_.Path)) })
  if ($missingPackages.Count -gt 0) {
    $packageNames = @($missingPackages | ForEach-Object { $_.Package })
    & $sdkManager --sdk_root="$env:ANDROID_HOME" --channel=3 --install $packageNames
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Android SDK package installation failed. Run sdkmanager --licenses, accept the required licenses, then retry npm run build:apk."
    }
  }
}

if (-not (Test-Path ".\android\gradlew.bat")) {
  & ".\node_modules\.bin\expo.cmd" prebuild --platform android --no-install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Push-Location ".\android"
try {
  & ".\gradlew.bat" assembleDebug --max-workers=2 `
    "-Dorg.gradle.internal.http.connectionTimeout=120000" `
    "-Dorg.gradle.internal.http.socketTimeout=300000"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Host "APK created at: $PSScriptRoot\android\app\build\outputs\apk\debug\app-debug.apk"
