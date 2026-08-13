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
| [Performance](./performance.md) | Profiles, the governor, thermal ladder, app size |
| [Photos and video files](./files.md) | Landmarks from a file, and painted copies of one |
| [What you can build](./recipes.md) | Trigger syntax, feasibility, honest limits |
| [Troubleshooting](./troubleshooting.md) | When something doesn't work, and the log channel |

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

Everything else, the delegate, the frame rate, the resolutions and the thermal response, is
measured and chosen for you, and every one of those choices can still be overridden per axis.
