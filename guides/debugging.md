# Debugging

The library ships a diagnostic channel that is **completely off by default** and costs nothing
until you turn it on.

*Half built: `setLogLevel()` reaches native and takes effect, and native writes to Logcat.
The batched stream back to JavaScript is not built, so `addLogListener` and the `onLog` prop
receive nothing yet. Read the entries with `adb logcat` until it lands.*

## Turning it on

```ts
import { setLogLevel, addLogListener } from 'react-native-pose-detection';

setLogLevel('debug');

const sub = addLogListener((entries) => {
  entries.forEach((e) => console.log(`[${e.category}] ${e.message}`));
});

// later
sub.remove();
setLogLevel('off');
```

An unknown level or category **throws** `PoseConfigError` rather than doing nothing quietly. A
level that silently failed to apply looks exactly like the bug you were trying to diagnose.

Listeners are a multiset, not a set. Registering the same function twice takes two `remove()`
calls, because two independent callers passing the same handler must not be able to unsubscribe
each other.

Or scoped to one camera:

```tsx
<PoseCamera logLevel="debug" onLog={(entries) => setLogs((l) => [...l, ...entries])} />
```

The per-camera `logLevel` prop is not read natively yet either. `setLogLevel()` is, and it is
global, so it is the one that works today.

## Levels

| Level | Shows |
| --- | --- |
| `off` *(default)* | nothing |
| `error` | failures |
| `warn` | degraded but running: GPU fallback, dropped frames |
| `info` | lifecycle: camera opened, model loaded, calibration settled |
| `debug` | state transitions: camera switch phases, trigger phases, thermal steps |
| `trace` | per-frame timings. Very noisy. |

## Per-category levels

Turn up only what you're investigating:

```ts
setLogLevel({ triggers: 'trace', camera: 'debug', engine: 'off' });
```

Categories: `camera` · `detector` · `engine` · `triggers` · `calibration` · `overlay`

`LOG_LEVELS` and `LOG_CATEGORIES` are exported if you are building a level picker.

## Entry shape

```ts
type LogEntry = {
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  category: LogCategory;
  message: string;
  timestamp: number;   // same clock as PoseFrame.timestamp
  data?: Record<string, number | string | boolean>;
};
```

`level` cannot be `'off'`, that is a setting, never something an entry carries.

Entries arrive **batched**. An array every ~250 ms, not one call per line. If your listener
can't keep up, the oldest entries are dropped rather than growing memory, and the next batch
opens with a `warn` entry carrying the count:

```ts
{ level: 'warn', category: 'engine', message: 'log entries dropped',
  timestamp: 1712, data: { droppedCount: 214 } }
```

## What to look at

| Problem | Category | Level |
| --- | --- | --- |
| Trigger fires twice, or never | `triggers` | `trace` |
| Frame rate lower than expected | `calibration` | `debug` |
| Crash or freeze on camera switch | `camera` | `debug` |
| Model won't load | `detector` | `info` |
| Overlay misaligned | `overlay` | `debug` |
| Phone gets hot | `calibration` | `debug` |

## Correlating with frames

`LogEntry.timestamp` uses the same monotonic clock as `PoseFrame.timestamp`, so a log line can
be matched to the exact frame that produced it.

## Before filing a bug

```ts
setLogLevel('debug');
console.log(cam.current.getState());
```

Include the `getState()` output, the Logcat entries around the failure, your device model, and
OS version. `getProfile()` is the call that will carry the useful half of this, the resolved
delegate, frame rate and resolutions and the measured inference time, and it throws until
calibration lands. Until then say which props you set and what you observed instead.

## Production

Leave it `off`. It is off unless you call `setLogLevel` or pass `logLevel`, and while off the
cost is a single integer comparison, no strings are built and nothing crosses to JavaScript.
