# Example apps

The reference implementation, the manual QA harness, and the demo, as two real applications.
They are never published to npm: `files` in `packages/core/package.json` leaves them out of the
tarball, so they can be as large and as well built as they need to be.

## Two apps, not one

```text
example/
├── expo/    installed through the Expo config plugin
└── bare/    installed through the CLI, no prebuild
```

Both are required because they exercise the two install paths, and those paths share almost no
code. The Expo app proves `npx expo prebuild` puts the model in place, writes the permissions
and registers the resource in the Xcode target. The bare app proves
`npx react-native-pose-detection fetch-model` does the same job against native projects that
already exist, and that autolinking finds the module without a plugin. A bug that appears in
only one of them is the common case, not the rare one.

CI builds both apps on both platforms on every commit, so four install cells stay proven:
see [testing](../docs/testing.md#ci-matrix).

## What is inside

The two apps share the same screens, one copy each, so each app's build proves its own install
path end to end.

| Screen | What it shows |
| --- | --- |
| **Overview** | What the package is, entry points to the other screens, device summary |
| **Capture** | The live camera: skeleton overlay, lens switching, and panels exposing every prop, with a stat readout of measured fps, target, delegate and analysis size |
| **Studio** | Pick a photo or clip, paint it, keep the file. Shows size, frames and poses found, and a history of previous exports to reopen or delete |
| **Diagnostics** | Stress scenarios: repeated camera switches, remounts, detection toggles, pause and resume cycles, each awaited on a real signal and reporting pass or fail |
| **About** | The feature list and package information |

```text
expo/ (bare/ mirrors it)
├── App.tsx                  three tabs and two modals, nothing else
├── app.json                 plugin configured with model: "full"
└── src/
    ├── screens/             one file per screen above
    ├── components/          the small control kit: buttons, choices, sheets, glass panels
    ├── scenarios/           stress runners, each returning a pass/fail report
    ├── theme.ts             one palette and scale for everything
    └── memory.ts            the JS heap where the runtime offers it
```

`bare/ios` and `bare/android` are committed on purpose: a bare app has no prebuild, so the CLI
must work against native projects that already exist, which is exactly the case the config
plugin never sees.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22 or newer | everything |
| JDK | 17 | Android builds |
| Android Studio + SDK | API 24 or newer | Android builds, any OS |
| Xcode | 16 or newer | iOS builds, **macOS only** |
| CocoaPods | current | the bare app's iOS build |

Android builds work the same on Windows, macOS and Linux. iOS builds require macOS, because
only Xcode can produce them; on Windows or Linux, run the Android side and everything still
applies.

## Setup

From the repository root, once:

```bash
npm install
npm run build          # builds the package the examples consume
```

The model file is deliberately never committed, so fetching it is the first per-app step on a
fresh clone.

### Expo app

```bash
cd example/expo
npx expo prebuild      # downloads and installs the model, writes permissions
npm run ios            # macOS only
npm run android        # any OS
```

### Bare app

```bash
cd example/bare
npm run fetch-model    # downloads and installs the model through the CLI
npm run doctor         # verifies the install; every line should be a tick
cd ios && pod install && cd ..    # macOS only, iOS only
npm run ios            # macOS only
npm run android        # any OS
```

## Simulator or a real phone

Both apps launch in a simulator or emulator, and the Studio screen is fully usable there: pick
a file, paint it, browse the history. The live camera is where a real device matters. A
simulator delivers no camera frames, and the GPU delegate is deliberately disabled there, so
frame rates, heat behavior and the tuning governor can only be judged on hardware.

On a physical iPhone, the first launch of a development build asks you to trust the developer
profile under Settings, General, VPN and Device Management. On Android, enable USB debugging
and accept the computer's key.

## When to update it

Adding a prop, event or trigger condition means adding a control for it in the Capture panels
in the same pull request. A feature with no way to exercise it in the example app is a feature
nobody will find. Screen changes are copied to the bare app in the same change, so the two
stay identical by construction.
