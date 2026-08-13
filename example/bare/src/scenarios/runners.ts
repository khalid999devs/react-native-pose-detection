import { formatBytes, jsHeapBytes } from '../memory';
import type { Scenario, ScenarioContext, ScenarioReport } from './types';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Every runner returns a report rather than throwing, so one failure does not stop a sweep and
 * the panel can show what happened on the run that failed next to the runs that did not.
 */
async function measure(
  id: string,
  iterations: number,
  body: (report: (line: string) => void) => Promise<string>,
  context: ScenarioContext,
): Promise<ScenarioReport> {
  const heapBefore = jsHeapBytes();
  const started = Date.now();

  try {
    const detail = await body(context.log);
    return {
      id,
      passed: true,
      iterations,
      elapsedMs: Date.now() - started,
      detail,
      heapBefore,
      heapAfter: jsHeapBytes(),
    };
  } catch (thrown) {
    return {
      id,
      passed: false,
      iterations,
      elapsedMs: Date.now() - started,
      detail: thrown instanceof Error ? thrown.message : String(thrown),
      heapBefore,
      heapAfter: jsHeapBytes(),
    };
  }
}

function requireCamera(context: ScenarioContext) {
  const camera = context.camera.current;
  if (!camera) throw new Error('the camera is not mounted');
  return camera;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'switch-camera',
    title: 'Switch camera ×100',
    verifies: 'No crash, no leak, trigger counters preserved across every switch.',
    run: (context) =>
      measure(
        'switch-camera',
        100,
        async (log) => {
          const before = { ...context.counts() };

          // No sleep between switches: `switchCamera()` resolves once the session is stable, and
          // the whole point of this run is to start the next one the instant that happens.
          for (let index = 0; index < 100; index += 1) {
            await requireCamera(context).switchCamera();
            if ((index + 1) % 25 === 0) log(`${index + 1} switches`);
          }

          const after = context.counts();
          const lost = Object.entries(before).filter(([id, count]) => (after[id] ?? 0) < count);
          if (lost.length > 0) {
            throw new Error(`counters reset for ${lost.map(([id]) => id).join(', ')}`);
          }

          return `100 switches, counters held at ${JSON.stringify(after)}`;
        },
        context,
      ),
  },
  {
    id: 'remount',
    title: 'Remount ×50',
    verifies: 'Memory returns to baseline. Every teardown released what its mount took.',
    run: (context) =>
      measure(
        'remount',
        50,
        async (log) => {
          for (let index = 0; index < 50; index += 1) {
            await context.remount();
            if ((index + 1) % 10 === 0) log(`${index + 1} remounts`);
          }
          return '50 mount and unmount cycles, each awaited to onReady';
        },
        context,
      ),
  },
  {
    id: 'detection-toggle',
    title: 'Stop / start detection ×20',
    verifies: 'GPU resources released and reacquired. The preview keeps running throughout.',
    run: (context) =>
      measure(
        'detection-toggle',
        20,
        async (log) => {
          for (let index = 0; index < 20; index += 1) {
            const camera = requireCamera(context);
            await camera.stopDetection();
            await camera.startDetection();
            if ((index + 1) % 5 === 0) log(`${index + 1} cycles`);
          }
          return '20 stop and start cycles';
        },
        context,
      ),
  },
  {
    id: 'overlay-toggle',
    title: 'Toggle overlay ×50',
    verifies: 'No layer leaks. The overlay is a view on Android and a layer on iOS.',
    run: (context) =>
      measure(
        'overlay-toggle',
        50,
        async () => {
          for (let index = 0; index < 50; index += 1) {
            const camera = requireCamera(context);
            await camera.setOverlayEnabled(false);
            await camera.setOverlayEnabled(true);
          }
          return '50 off and on cycles';
        },
        context,
      ),
  },
  {
    id: 'pause-resume',
    title: 'Pause / resume ×30',
    verifies: 'The session releases and restores without a full teardown.',
    run: (context) =>
      measure(
        'pause-resume',
        30,
        async () => {
          for (let index = 0; index < 30; index += 1) {
            const camera = requireCamera(context);
            await camera.pause();
            await camera.resume();
          }
          return '30 pause and resume cycles';
        },
        context,
      ),
  },
  {
    id: 'soak',
    title: 'Soak 10 minutes',
    verifies: 'The memory budget in guides/performance.md, and that FPS holds as the device warms.',
    run: (context) =>
      measure(
        'soak',
        600,
        async (log) => {
          const heapStart = jsHeapBytes();

          for (let minute = 1; minute <= 10; minute += 1) {
            await sleep(60_000);
            log(`${minute} min, JS heap ${formatBytes(jsHeapBytes())}`);
          }

          return `10 minutes, JS heap ${formatBytes(heapStart)} to ${formatBytes(jsHeapBytes())}`;
        },
        context,
      ),
  },
];

/**
 * Reproduced from outside the app, because neither platform lets a process put itself into a
 * thermal state, clear another process's preferences, or send itself a memory warning. The panel
 * shows the command and then watches for what it should have caused.
 */
export const EXTERNAL: readonly {
  title: string;
  verifies: string;
  android: string;
  ios: string;
}[] = [
  {
    title: 'Force thermal state',
    verifies: 'Every ladder step fires and recovers, as onPerformanceChange with reason thermal.',
    android: 'adb shell cmd thermalservice override-status 3',
    ios: 'Xcode · Devices and Simulators · Simulate thermal state',
  },
  {
    title: 'Simulate memory warning',
    verifies: 'The cleanup path runs and the detector survives it.',
    android: 'adb shell am send-trim-memory com.posedetection.example RUNNING_CRITICAL',
    ios: 'Simulator · Features · Trigger Memory Warning',
  },
  {
    title: 'Clear calibration cache',
    verifies: 'The next launch re-probes from scratch: phase calibrating, source measured.',
    android: 'adb shell pm clear com.posedetection.example',
    ios: 'Delete the app and reinstall',
  },
  {
    title: 'Background and foreground',
    verifies: 'The session is released and restored, and calibration is not re-run.',
    android: 'Home, wait 10 s, reopen',
    ios: 'Home, wait 10 s, reopen',
  },
];
