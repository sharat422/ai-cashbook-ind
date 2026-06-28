# Smart CashBook — Auth Flow

A React Native (TypeScript) authentication & onboarding flow:

```
Splash → Login (mobile) → OTP → Create Business → Dashboard
```

## Tech stack

| Concern        | Library                                        |
| -------------- | ---------------------------------------------- |
| Navigation     | `@react-navigation/native` + native-stack      |
| Global state   | `zustand` (persisted to `AsyncStorage`)         |
| Server state   | `@tanstack/react-query`                         |
| Styling        | `nativewind` (Tailwind CSS for RN)              |
| Language       | TypeScript (strict)                             |

## How the flow is driven

There is **no manual screen-to-screen navigation for auth transitions**. The
`useAuthStore` exposes a derived `status`:

| Store state            | `status`            | Stack shown            |
| ---------------------- | ------------------- | ---------------------- |
| no token               | `unauthenticated`   | `AuthNavigator`        |
| token, no business     | `pending-business`  | `OnboardingNavigator`  |
| token + business       | `authenticated`     | `AppNavigator`         |

`RootNavigator` renders the right stack for the current `status`, so logging
in (sets a token) or creating a business (sets a business) advances the user
automatically. Logout clears the store and drops back to Login. State is
persisted, so a returning user skips straight to the right screen after the
splash.

## Project structure

```
src/
├── api/                 # fetch client + (mocked) auth endpoints
│   ├── client.ts
│   └── auth.api.ts
├── components/ui/       # reusable, app-agnostic UI primitives
│   ├── Button.tsx  Input.tsx  Select.tsx  SegmentedControl.tsx
│   ├── OtpInput.tsx  Screen.tsx  Text.tsx  index.ts
├── config/
│   └── constants.ts     # app config, business types, Indian states
├── features/            # feature-first modules
│   ├── auth/
│   │   ├── hooks/        # React Query mutations (request/verify OTP, create biz)
│   │   ├── screens/      # Splash, Login, Otp, CreateBusiness
│   │   └── types.ts
│   └── dashboard/
│       └── screens/
├── navigation/          # Root + Auth/Onboarding/App stacks, param types
├── providers/           # QueryProvider
├── store/               # Zustand auth store (persisted)
├── theme/               # color tokens shared with tailwind.config.js
└── utils/               # validation helpers
```

The `features/*` layout scales: each feature owns its screens, hooks, and types,
while `components/ui` and `store` stay shared. Path aliases (`@components`,
`@features`, `@store`, …) are configured in both `tsconfig.json` and
`babel.config.js`.

## Mock backend

`src/api/auth.api.ts` simulates the backend so the flow runs end-to-end with no
server. **Use OTP `123456`** to pass verification. Each function has a comment
showing the equivalent real `apiRequest(...)` call — swap them in to integrate a
live API; the rest of the app is unchanged.

## Getting it running

This repo contains the **application source** (TypeScript, config). It does not
include the generated native `android/` and `ios/` folders. To produce a
runnable app:

1. Generate a fresh RN 0.76 shell with the **same app name**, then overlay this
   source:

   ```bash
   npx @react-native-community/cli@latest init AI_Smart_CashBook --version 0.76.5
   # copy this repo's App.tsx, index.js, src/, and config files over the shell,
   # keeping the generated android/ and ios/ folders
   ```

2. Install dependencies:

   ```bash
   npm install
   cd ios && pod install && cd ..   # iOS only
   ```

3. Run:

   ```bash
   npm start            # Metro
   npm run android      # or: npm run ios
   ```

> NativeWind requires the `nativewind/babel` preset, the `withNativeWind` Metro
> wrapper, and importing `./global.css` in `App.tsx` — all already configured.
> `react-native-reanimated/plugin` must remain the **last** entry in
> `babel.config.js`.

## Type-check & lint

```bash
npm run tsc
npm run lint
```
