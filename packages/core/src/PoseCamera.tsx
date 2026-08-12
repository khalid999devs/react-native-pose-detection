import * as React from 'react';

import { decodeFrames } from './decodeFrames';
import { getNativeView } from './native';
import type { NativePoseCameraView } from './native';
import type { AngleJointName, JointName } from './types/joints';
import type { CameraState } from './types/camera';
import type { PoseCameraProps, PoseCameraRef } from './types/props';
import type { CameraChangeEvent, ErrorEvent, PerformanceEvent, ReadyEvent } from './types/events';
import type { LogEntry } from './types/logging';
import type { TriggerEvent } from './types/triggers';
import { assertValidTriggers } from './validation';
import { collectReferencedJoints, jointsRequiredForAngles, resolveAngleJoints } from './wire';

type NativeEvent<T> = { nativeEvent: T };

/**
 * Every joint the configuration mentions, from any of the three places that can mention one.
 * This drives both the lazy angle pass and what the landmark buffer carries.
 */
function referencedJoints(props: PoseCameraProps): Set<string> {
  const fromTriggers: string[] = [];
  for (const trigger of props.triggers ?? []) {
    collectFromCondition(trigger.enter, fromTriggers);
    if (trigger.exit) collectFromCondition(trigger.exit, fromTriggers);
  }

  const fromOverlay =
    typeof props.overlay === 'object' && props.overlay?.angles
      ? props.overlay.angles.map((angle) => angle.joint)
      : [];

  return collectReferencedJoints([fromTriggers, fromOverlay, props.data?.select]);
}

function collectFromCondition(condition: object, into: string[]): void {
  const record = condition as Record<string, unknown>;

  for (const key of ['angle', 'landmarkX', 'landmarkY', 'visibility'] as const) {
    const value = record[key];
    if (typeof value === 'string') into.push(value);
  }
  for (const key of ['velocityX', 'velocityY'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value !== 'centerOfMass') into.push(value);
  }
  // A joint-relative bound names a second joint, and it has to be in the buffer too.
  for (const key of ['below', 'above'] as const) {
    const value = record[key];
    if (typeof value === 'string') into.push(value);
  }
  for (const key of ['all', 'any'] as const) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const member of value) collectFromCondition(member as object, into);
    }
  }
}

export const PoseCamera = React.forwardRef<PoseCameraRef, PoseCameraProps>(function PoseCamera(
  props,
  ref,
) {
  const NativeView = getNativeView();
  const nativeRef = React.useRef<NativePoseCameraView | null>(null);

  const { triggers, data, onPose, onPoseBatch, onTrigger } = props;

  // Bad configs fail here with a path, rather than becoming a trigger that never fires.
  React.useEffect(() => {
    if (triggers && triggers.length > 0) assertValidTriggers(triggers);
  }, [triggers]);

  if (__DEV__ && data?.mode === 'batched' && onPose && !onPoseBatch) {
    console.warn(
      "react-native-pose-detection: data.mode is 'batched', which delivers onPoseBatch. " +
        'onPose will not fire.',
    );
  }
  if (__DEV__ && data && data.mode !== 'batched' && data.mode !== 'off' && onPoseBatch) {
    console.warn(
      `react-native-pose-detection: data.mode is '${data.mode}', which delivers onPose. ` +
        'onPoseBatch will not fire.',
    );
  }

  // Derived from the props on both sides of the bridge by the same rule, so neither has to
  // tell the other what the layout is.
  const angleJoints: readonly AngleJointName[] = React.useMemo(
    () => resolveAngleJoints(referencedJoints(props)),
    [props.triggers, props.data?.select, props.overlay],
  );

  const selection: readonly JointName[] | undefined = React.useMemo(() => {
    const select = props.data?.select;
    if (!select || select.length === 0) return undefined;
    const required = new Set<JointName>(select);
    for (const joint of jointsRequiredForAngles(angleJoints)) required.add(joint);
    return Object.freeze([...required]);
  }, [props.data?.select, angleJoints]);

  const handleFrames = React.useCallback(async () => {
    const view = nativeRef.current;
    if (!view) return;
    if (!onPose && !onPoseBatch) return;

    const buffer = await view.drainFrames();
    const { frames } = decodeFrames(buffer, {
      ...(selection ? { selection } : {}),
      angleJoints,
    });
    if (frames.length === 0) return;

    if (onPoseBatch) {
      onPoseBatch(frames);
      return;
    }
    // Throttled and live deliver one at a time; a drain can still carry more than one if the
    // JS thread was busy, and dropping the older ones would be a silent lie.
    for (const frame of frames) onPose?.(frame);
  }, [onPose, onPoseBatch, selection, angleJoints]);

  // `getState()` and `getProfile()` are synchronous in the public contract, so the last known
  // values are mirrored here from the events that carry them rather than fetched on call.
  const state = React.useRef<CameraState>({
    facing: 'front',
    active: false,
    detecting: false,
    fps: 0,
    delegate: 'CPU',
    deviceTier: 'medium',
  });

  React.useImperativeHandle(
    ref,
    (): PoseCameraRef => ({
      switchCamera: async () => {
        await nativeRef.current?.switchCamera();
      },
      setFacing: async (facing) => {
        await nativeRef.current?.setFacing(facing);
      },
      pause: () => void nativeRef.current?.pause(),
      resume: () => void nativeRef.current?.resume(),
      startDetection: () => void nativeRef.current?.startDetection(),
      stopDetection: () => void nativeRef.current?.stopDetection(),
      setOverlayEnabled: (enabled) => void nativeRef.current?.setOverlayEnabled(enabled),
      setProfile: () => {
        throw new Error('setProfile arrives with calibration, in the same phase as profiles.');
      },
      getProfile: () => {
        throw new Error('getProfile arrives with calibration, in the same phase as profiles.');
      },
      getState: () => state.current,
      snapshot: async () => {
        const view = nativeRef.current;
        if (!view) return null;
        const buffer = await view.snapshotFrame();
        const { frames } = decodeFrames(buffer, {
          ...(selection ? { selection } : {}),
          angleJoints,
        });
        return frames[0] ?? null;
      },
    }),
    [selection, angleJoints],
  );

  return (
    <NativeView
      {...(props as unknown as Record<string, unknown>)}
      ref={nativeRef as unknown as React.Ref<unknown>}
      angleJoints={angleJoints}
      selection={selection}
      onFrames={handleFrames}
      onReady={(event: NativeEvent<ReadyEvent>) => {
        const ready = event.nativeEvent;
        state.current = {
          ...state.current,
          facing: ready.facing,
          active: true,
          detecting: props.detection !== false,
          delegate: ready.delegate,
          deviceTier: ready.deviceTier,
        };
        props.onReady?.(ready);
      }}
      onError={(event: NativeEvent<ErrorEvent>) => props.onError?.(event.nativeEvent)}
      onCameraChange={(event: NativeEvent<CameraChangeEvent>) => {
        state.current = { ...state.current, facing: event.nativeEvent.facing };
        props.onCameraChange?.(event.nativeEvent);
      }}
      onPerformanceChange={(event: NativeEvent<PerformanceEvent>) => {
        const performance = event.nativeEvent;
        state.current = {
          ...state.current,
          fps: performance.actualFps,
          delegate: performance.delegate,
        };
        props.onPerformanceChange?.(performance);
      }}
      onTrigger={(event: NativeEvent<TriggerEvent>) => onTrigger?.(event.nativeEvent)}
      onLog={(event: NativeEvent<{ entries: LogEntry[] }>) =>
        props.onLog?.(event.nativeEvent.entries)
      }
    />
  );
});
