# Guides

Everything you need to use `react-native-pose-detection` in your app.

Building *on* the library? You're in the right place.
Working *on* the library? See [docs/](../docs/README.md).

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
| [Static input](./static-input.md) | Images and video files, no camera |
| [Recipes](./recipes/README.md) | Squat, push-up, jump, plank: copy-paste configs |
| [Debugging](./debugging.md) | Live log streaming, off by default |
| [Troubleshooting](./troubleshooting.md) | When something doesn't work |

## API reference

| | |
| --- | --- |
| [`<PoseCamera>` props](./reference/pose-camera.md) | Every prop and its default |
| [Ref methods](./reference/ref-methods.md) | `switchCamera`, `snapshot`, `getProfile`, … |
| [Events](./reference/events.md) | Every callback, payload, and error code |
| [Types](./reference/types.md) | `PoseFrame`, `JointName`, wire format |
| [Trigger schema](./reference/trigger-schema.md) | Conditions, emit modes, validation |
| [Config plugin](./reference/config-plugin.md) | `app.json` options |
| [CLI](./reference/cli.md) | `fetch-model`, `doctor` |

## Getting the best performance

The library auto-tunes itself, but four decisions are yours and they dominate everything else:

| Decision | Impact | Where |
| --- | --- | --- |
| **Keep `data.mode: 'off'`** and use triggers | 30 bridge crossings/sec → ~1 per event | [data delivery](./data-delivery.md) |
| **Pick the right model** | `lite` ~19.7 MB vs `heavy` ~43.4 MB installed | [performance](./performance.md#app-size) |
| **Use `select`** to trim what's computed | fewer angles computed per frame | [data delivery](./data-delivery.md#trimming-the-payload) |
| **Set `active={isFocused}`** | camera off when the screen isn't visible | [camera control](./camera-control.md#lifecycle) |

Everything else (delegate, frame rate, resolution, thermal response) is handled for you.
