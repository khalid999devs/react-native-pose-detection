# Example app

A real application, not a smoke test. It is the **reference implementation**, the manual QA
harness, and the demo. And it is never published to npm.

Excluded from the tarball via `files` in `packages/core/package.json`, so it can be as large
and as well built as it needs to be.

## Goals

1. **Show every capability** with real UI, not a wall of debug text
2. **Exercise every prop** so regressions surface manually before CI catches them
3. **Reproduce hard scenarios on demand**, camera switching, thermal, memory, remount
4. **Be worth screenshotting**. This is what people see before they install

## Screens

| Screen | Purpose |
| --- | --- |
| **Home** | Navigation, device summary, resolved profile at a glance |
| **Basic** | The 5-line example from the README, nothing else. Proves the happy path. |
| **Playground** | Every prop with a live control. Change anything without a rebuild. |
| **Triggers** | Build and edit triggers live; fired events stream into a list |
| **Data modes** | Switch `off`/`throttled`/`batched`/`live`; shows measured crossings/sec |
| **Performance** | Live FPS, p50 inference, delegate, tier, thermal state, calibration phase, memory |
| **Recipes** | Squat, push-up, jump, plank running for real with rep counts |
| **Angles** | Angle overlay demo: pick joints, see arcs and degree labels |
| **Static input** | Pick an image or video from the library and run detection on it |
| **Console** | Live log stream with level and category filters |
| **Scenarios** | The stress and reset panel: see below |

## Playground controls

Every prop, live, with the resolved value shown next to the requested one:

| Group | Controls |
| --- | --- |
| Model | variant (read-only: build time), `maxPoses` |
| Performance | `profile`, `delegate`, `targetFps`, `resolution`, `analysisResolution`, `thermalPolicy` |
| Camera | `facing`, `active`, switch button |
| Detection | `detection`, `smoothing` (+ `minCutoff`/`beta` sliders) |
| Overlay | `overlay` on/off, landmarks, connections, color, `lineWidth`, `pointRadius`, `minVisibility`, `only[]`, `angles[]` |
| Data | `mode`, `throttleMs`, `flushMs`, `landmarks`, `worldLandmarks`, `angles`, `select[]` |
| Logging | level per category |

Showing **requested vs resolved** side by side is the point. It makes auto-calibration and
the thermal ladder visible instead of mysterious.

## Scenarios panel

The reset and stress toggles. Each one reproduces a failure mode that has actually happened.

| Action | Verifies |
| --- | --- |
| Switch camera ×100 rapidly | No crash, no leak, trigger counters preserved |
| Remount component ×50 | Memory returns to baseline |
| Stop / start detection ×20 | GPU resources released and reacquired |
| Toggle overlay ×50 | No layer leaks |
| Background / foreground | Session released and restored, calibration retained |
| Clear calibration cache | Next launch re-probes from scratch |
| Force thermal state | Each ladder step fires and recovers |
| Simulate memory warning | Cleanup path runs without tearing down the detector |
| Reset trigger counters | Counters zero without remounting |
| Reset everything | Full state reset in one tap |

Each stress action reports pass/fail with before/after memory, so a regression is obvious on
a device without attaching a profiler.

## Structure

```text
example/
├── App.tsx
├── app.json                  plugin configured with model: "full"
├── src/
│   ├── screens/              one file per screen above
│   ├── components/           controls: sliders, toggles, pickers, stat tiles
│   ├── scenarios/            stress runners, each returning a pass/fail report
│   └── theme/                shared UI so screens stay short
└── README.md
```

Keep the pose-related code in each screen short and obvious, someone reading `Basic.tsx`
should see the library's API, not the app's UI framework.

## Running

```bash
npm install
npm run build            # build the package first
cd example
npx expo prebuild
npx expo run:ios         # or run:android
```

A **physical device is required.** Simulators have no camera and the GPU delegate behaves
differently on them.

## When to update it

Adding a prop, event, or trigger condition means adding a control for it here in the same PR.
A feature with no way to exercise it in the example app is a feature nobody will find.
