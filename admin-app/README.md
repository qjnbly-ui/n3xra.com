# N3XRA Admin mobile app

This is the Expo/React Native admin companion app. It currently provides:

- Supabase admin sign-in
- Push notification permission and device-token registration
- Admin notification inbox with unread/read state

## Local setup

```sh
npm install
cp .env.example .env
npx expo start
```

Replace the Expo project ID in `app.json` before building with EAS. The app intentionally reuses the existing `admin_notifications` table and `platform-admin` Edge Function.

## First iPhone build

From this directory, after joining the Apple Developer Program:

```sh
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform ios --profile preview
```

EAS will guide you through Apple signing and return a TestFlight/internal distribution build link. A production App Store build uses `--profile production`.
