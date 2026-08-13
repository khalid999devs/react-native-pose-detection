# Guides

Everything you need to use `react-native-pose-detection` in your app.

Building *on* the library? You're in the right place.
Working *on* the library? See [docs/](../docs/README.md).

## What works today

The package is pre-1.0. Both platforms are written and build: a live camera, the native skeleton
and angle overlay, camera switching, the GPU-to-CPU fallback, trigger evaluation, frame delivery
to JavaScript, smoothing, calibration and the thermal response, in Kotlin on CameraX and in Swift
on AVFoundation.

**None of it has run on a physical device.** Every number in [performance](./performance.md) is a
target rather than a measurement, and that is the one caveat worth carrying into every page below.

## Start here

| | |
| --- | --- |
| **1.** [Getting started](./getting-started.md) | Install → live skeleton in five minutes |
| **2.** [Installation](./installation.md) | Expo, bare RN, EAS, release builds |
| **3.** [Camera control](./camera-control.md) | Switching, pausing, the three toggles |
| **4.** [Data delivery](./data-delivery.md) | Getting landmarks out without paying for them |
| **5.** [Triggers](./triggers.md) | Business logic that runs natively |

## Going further

| | |
| --- | --- |
| [Performance](./performance.md) | Profiles, calibration, memory budgets, app size |
| [Static input](./static-input.md) | Images and video files. Planned, not yet shipped |
| [Recipes](./recipes/README.md) | Squat, push-up, jump, plank: copy-paste configs |
| [Debugging](./debugging.md) | Live log streaming, off by default |
| [Troubleshooting](./troubleshooting.md) | When something doesn't work |

## API reference

| | |
| --- | --- |
| [`<PoseCamera>` props](./reference/pose-camera.md) | Every prop and its default |
| [Ref methods](./reference/ref-methods.md) | `switchCamera`, `snapshot`, `getState`, … |
| [Events](./reference/events.md) | Every callback, payload, and error code |
| [Types](./reference/types.md) | `PoseFrame`, `JointName`, wire format |
| [Camera permission](./reference/permissions.md) | `useCameraPermission`, and why blocked is not denied |
| [Trigger schema](./reference/trigger-schema.md) | Conditions, emit modes, validation |
| [Config plugin](./reference/config-plugin.md) | `app.json` options |
| [CLI](./reference/cli.md) | `fetch-model`, `doctor` |

## Getting the best performance

Four decisions are yours and they dominate everything else:

| Decision | Impact | Where |
| --- | --- | --- |
| **Keep `data.mode: 'off'`** and use triggers | 60 bridge crossings/sec → ~1 per event | [data delivery](./data-delivery.md) |
| **Pick the right model** | `lite` adds ~5.5 MB, `heavy` ~29.2 MB | [performance](./performance.md#app-size) |
| **Use `select`** to trim the payload | three joints is 48 bytes a frame, not 528 | [data delivery](./data-delivery.md#trimming-the-payload) |
| **Set `active={isFocused}`** | camera off when the screen isn't visible | [camera control](./camera-control.md#lifecycle) |

The delegate is chosen for you, GPU where it works and CPU where it doesn't. Frame rate,
resolution and thermal response are meant to be too, once calibration lands.
