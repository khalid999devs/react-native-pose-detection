# Debugging

The library ships a diagnostic channel that is **completely off by default** and costs nothing
until you turn it on.

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

Or scoped to one camera:

```tsx
<PoseCamera logLevel="debug" onLog={(entries) => setLogs((l) => [...l, ...entries])} />
```

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

## Entry shape

```ts
type LogEntry = {
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  category: string;
  message: string;
  timestamp: number;   // same clock as PoseFrame.timestamp
  data?: Record<string, number | string | boolean>;
};
```

Entries arrive **batched**. An array every ~250 ms, not one call per line. If your listener
can't keep up, the oldest entries are dropped and reported as `droppedCount` rather than
growing memory.

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
console.log(cam.current.getProfile());
```

Include the `getProfile()` output, the log entries around the failure, your device model, and
OS version. Performance reports without `getProfile()` can't be acted on.

## Production

Leave it `off`. It is off unless you call `setLogLevel` or pass `logLevel`, and while off the
cost is a single integer comparison, no strings are built and nothing crosses to JavaScript.
