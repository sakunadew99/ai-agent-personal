# Sakuna AI Mobile

Expo app for the Sakuna daily workflow: Home, Plan, Capture, AI, Health, Focus, and Profile.

## Start

Use Node.js 22.13 or newer. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to the backend address reachable from your Android device. The Android emulator uses `http://10.0.2.2:8000`. A physical phone must use your computer's LAN IPv4 address, for example `http://192.168.1.25:8000`; keep the phone and computer on the same Wi-Fi and allow inbound TCP port 8000 in Windows Firewall. The backend must be running and publish port 8000.

### Build a debug APK

The Android SDK Command-line Tools must be installed at
`%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat`.
Download the Windows command-line tools from [Android Developers](https://developer.android.com/studio#command-line-tools),
extract the archive's inner `cmdline-tools` contents into that `latest` folder,
then accept the SDK licenses once:

```powershell
$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk"
& "$SdkRoot\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$SdkRoot" --licenses
```

The build script installs the required Android 37.0 platform, Build Tools 37.0.0,
platform tools, and NDK 27.0.12077973 when the command-line tools are available.
Use Node.js 22.13 or newer. From this directory, install dependencies and build the Android APK:

```powershell
npm install
npm run build:apk
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it on the phone with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, or copy the APK to the phone and open it. Expo embeds `EXPO_PUBLIC_API_URL` at build time; if you change `.env`, rebuild the APK.

### Connect the Mi Band 10

1. Pair the band with Mi Fitness and sync the band in Mi Fitness.
2. In Mi Fitness, open **Profile → App settings → Sync with the cloud** and enable it. Then open **Profile → Third-party data** and select the Health Connect/Google Health option. Xiaomi documents third-party sync for Smart Band 10; menu labels or available metrics can vary by region/app version.
3. In Sakuna, sign in, open **Health**, tap **Connect Health Connect**, and allow the data types you want to share.
4. Tap **Sync available Mi Band data to Sakuna**. This sends available steps, the latest heart-rate sample, and the most recent completed sleep session to the authenticated backend. It does not sync in the background.

Mi Fitness does not necessarily export every metric: Xiaomi/Google documentation currently lists heart rate during exercise, total steps, and sleep as shareable metrics; all-day heart-rate readings may not be available through this route. If Sakuna shows no data, open Mi Fitness and sync the band first, then check Health Connect → App permissions to confirm Mi Fitness is writing the data and Sakuna has read permission. Health Connect requires Android 9+; on Android 13 and below install Health Connect from Play Store. iOS has no Health Connect integration.

You stay signed in until you tap Sign out: the refresh token is kept in the phone's encrypted secure storage, the 15-minute access token is renewed automatically, and the server's sliding window is 90 days (open the app at least once in 90 days). The backend receives health records only after the explicit sync button is tapped. Use HTTPS for a deployed backend; the LAN HTTP address is for local development only.

## Sakuna Shield (Android APK only)

The Focus screen has an in-app timer and **Sakuna Shield** (`modules/sakuna-shield`, native Kotlin), with three tabs:

- **Blocking**: named blocklists of apps (grouped by category), websites (subdomains included) and URL keywords. Each list is *Quick block only*, *Always on* or *On a schedule* (days + hours, overnight allowed). Extra options per list: block newly installed apps, adult sites (built-in list + words, `AdultFilter.kt`), Google Play purchase screens (best effort), and browsers whose address bar can't be read.
- **Strict Mode**: locks the lists (add only; nothing removed, paused or deleted), stops a quick block from ending early, and blocks Sakuna's Accessibility and uninstall screens. Unlock methods: *Timer* (15-minute early-exit wait), *Follow schedules* (only while no schedule runs; schedules must leave free time each week), *Charger* (only while charging). *Approval* is planned.
- **Insights**: day and week screen time, hourly chart, pickups, longest phone-free stretch (06:00–23:00), longest continuous use, peak hour, and a Distracting / Neutral / Productive split from marks you set per app.

Setup on the phone: Settings → Accessibility → Sakuna Shield → On (blocking), and Usage access → Sakuna AI → Allow (insights). Everything runs and stays on the phone: rules, marks and a daily block count are stored in app preferences; usage is read from Android when Insights opens and is never uploaded. Blocking works in the browsers listed in `ShieldAccessibilityService.kt`; in-app browsers can slip through unless "Block unsupported browsers" is on. Lists from the older single-list version are moved into "My blocklist" automatically.
