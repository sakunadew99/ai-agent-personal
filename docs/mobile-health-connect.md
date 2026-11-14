# Mobile health integration status

The backend accepts normalized records at `POST /api/v1/health/records`, `/health/sleep`, and `/health/workouts`. The Android client has a Health Connect integration in `apps/mobile/src/health/health-connect.ts`, configured with `react-native-health-connect` and manifest read permissions for Steps, HeartRate and SleepSession.

The current app can request user permission, aggregate today's steps, read the latest heart-rate sample for today, and read the latest completed sleep session within a 36-hour lookback. The user must initiate sync from the app; background sync is not implemented. Only granted record types are queried. The app should report a metric as synced only after the API accepts the normalized record.

This native integration requires an Android custom/development build; Expo Go cannot load it. Android Health Connect provider availability, Mi Fitness data export, and the full permission/read/upload flow still need verification on the target phone and wearable. Mi Fitness may not write every metric (including all-day heart rate) on every version or region. iOS integration is not implemented. Keep manual health entry available when Health Connect is unavailable or permission is declined.
