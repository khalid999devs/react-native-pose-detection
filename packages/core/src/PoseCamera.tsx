import * as React from 'react';

import { decodeFrames } from './frames/decodeFrames';
import type { DecodeOptions } from './frames/decodeFrames';
import { getNativeView } from './native';
import type { NativePoseCameraView, NativeTriggerEvent } from './native';
import type { AngleJointName, JointName } from './types/joints';
import { ANGLE_JOINT_NAMES } from './types/joints';
import type { CameraState, ProfileState } from './types/camera';
import type { PoseCameraProps, PoseCameraRef } from './types/props';
import type { CameraChangeEvent, ErrorEvent, PerformanceEvent, ReadyEvent } from './types/events';
import type { LogEntry } from './types/logging';
import type { Condition, TriggerEvent } from './types/triggers';
import { emitLogEntries } from './logging';
import { assertValidTriggers } from './validation';
import { resolveAngleJoints } from './frames/wire';

type NativeEvent<T> = { nativeEvent: T };

const NO_ANGLES: readonly AngleJointName[] = Object.freeze([]);

/** Only an `angle` condition needs an angle. A joint used as a bound is a position. */
function collectAngleJoints(condition: Condition, into: Set<string>): void {
  const record = condition as Record<string, unknown>;

  const angle = record['angle'];
  if (typeof angle === 'string') into.add(angle);

  for (const key of ['all', 'any'] as const) {
    const members = record[key];
    if (Array.isArray(members)) {
      for (const member of members) collectAngleJoints(member as Condition, into);
    }
  }
}

/**
 * Holds one array instance while its contents are unchanged. These props are usually inline
 * literals, and memoizing on identity would reshape the wire format every render and break the
 * `WeakMap` accessor cache that keys on `PoseFrame.selection`.
 */
function useStableList<T extends string>(value: readonly T[] | undefined): readonly T[] {
  const key = value === undefined ? '' : value.join(' ');
  const held = React.useRef<{ key: string; list: readonly T[] } | null>(null);

  if (held.current === null || held.current.key !== key) {
    held.current = { key, list: Object.freeze(value === undefined ? [] : [...value]) };
  }
  return held.current.list;
}

export const PoseCamera = React.forwardRef<PoseCameraRef, PoseCameraProps>(function PoseCamera(
  props,
  ref,
) {
  const NativeView = getNativeView();
  const nativeRef = React.useRef<NativePoseCameraView | null>(null);

  const { triggers, data, overlay, active, detection } = props;

  // During render, before anything walks the conditions: a bad config fails at the call site
  // with a path. The validator's depth limit makes the walk below safe on a cyclic config.
  if (triggers && triggers.length > 0) assertValidTriggers(triggers);

  const requestedAngles = data?.angles;
  const angleJoints = useStableList<AngleJointName>(
    React.useMemo(() => {
      if (requestedAngles === true) return ANGLE_JOINT_NAMES;

      const referenced = new Set<string>(Array.isArray(requestedAngles) ? requestedAngles : []);
      for (const trigger of triggers ?? []) {
        collectAngleJoints(trigger.enter, referenced);
        if (trigger.exit) collectAngleJoints(trigger.exit, referenced);
      }
      if (typeof overlay === 'object' && overlay?.angles) {
        for (const arc of overlay.angles) referenced.add(arc.joint);
      }
      return referenced.size === 0 ? NO_ANGLES : resolveAngleJoints(referenced);
    }, [requestedAngles, triggers, overlay]),
  );

  // Exactly what `data.select` named. Angles are computed from the full landmark set before the
  // buffer is narrowed, so wanting one never widens the payload. See ADR 0005.
  const selected = useStableList<JointName>(data?.select);
  const selection = selected.length > 0 ? selected : undefined;

  const decodeOptions = React.useRef<DecodeOptions>({ angleJoints });
  const callbacks = React.useRef(props);
  const state = React.useRef<CameraState>({
    facing: 'front',
    active: active !== false,
    detecting: detection !== false,
    fps: 0,
    delegate: 'CPU',
    deviceTier: 'medium',
  });

  React.useEffect(() => {
    decodeOptions.current = { angleJoints, ...(selection ? { selection } : {}) };
    callbacks.current = props;
  });

  React.useEffect(() => {
    state.current = { ...state.current, active: active !== false, detecting: detection !== false };
  }, [active, detection]);

  React.useEffect(() => {
    if (!__DEV__) return;
    const { onPose, onPoseBatch } = callbacks.current;
    const mode = data?.mode ?? 'off';
    if (mode === 'batched' && onPose && !onPoseBatch) {
      console.warn(
        "react-native-pose-detection: data.mode is 'batched', which delivers onPoseBatch. " +
          'onPose will not fire.',
      );
    }
    if (mode !== 'batched' && mode !== 'off' && onPoseBatch && !onPose) {
      console.warn(
        `react-native-pose-detection: data.mode is '${mode}', which delivers onPose. ` +
          'onPoseBatch will not fire.',
      );
    }
  }, [data]);

  const reportDecodeError = React.useCallback((message: string) => {
    callbacks.current.onError?.({ code: 'DETECTION_FAILED', message, fatal: false });
  }, []);

  const draining = React.useRef(false);
  const drainAgain = React.useRef(false);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One drain at a time: overlapping drains resolve in bridge order and deliver older frames
  // after newer ones. A tick arriving mid-drain sets the flag instead of starting a second.
  const drain = React.useCallback(async (): Promise<void> => {
    if (draining.current) {
      drainAgain.current = true;
      return;
    }
    draining.current = true;
    try {
      do {
        drainAgain.current = false;
        const view = nativeRef.current;
        if (!view || !mounted.current) return;

        const buffer = await view.drainFrames();
        if (!mounted.current) return;

        const { frames, droppedCount, error } = decodeFrames(buffer, decodeOptions.current);
        if (error) {
          reportDecodeError(error);
          continue;
        }
        if (droppedCount > 0) callbacks.current.onFramesDropped?.(droppedCount);
        if (frames.length === 0) continue;

        const { onPose, onPoseBatch } = callbacks.current;
        if (onPoseBatch) {
          onPoseBatch(frames);
        } else if (onPose) {
          // A drain can carry more than one when the JavaScript thread was busy.
          for (const frame of frames) onPose(frame);
        }
      } while (drainAgain.current && mounted.current);
    } catch (cause) {
      reportDecodeError(cause instanceof Error ? cause.message : 'draining frames failed');
    } finally {
      draining.current = false;
    }
  }, [reportDecodeError]);

  const handleFrames = React.useCallback(() => {
    void drain();
  }, [drain]);

  const handleTrigger = React.useCallback((event: NativeEvent<NativeTriggerEvent>) => {
    const { snapshotId, ...rest } = event.nativeEvent;
    const deliver = (trigger: TriggerEvent): void => callbacks.current.onTrigger?.(trigger);

    const view = nativeRef.current;
    if (snapshotId === undefined || !view) {
      deliver(rest);
      return;
    }
    // The frame cannot ride the event. See ADR 0009.
    view
      .takeTriggerSnapshot(snapshotId)
      .then((buffer) => {
        if (!mounted.current) return;
        const { frames } = decodeFrames(buffer, decodeOptions.current);
        const frame = frames[0];
        deliver(frame ? { ...rest, snapshot: frame } : rest);
      })
      .catch(() => {
        if (mounted.current) deliver(rest);
      });
  }, []);

  React.useImperativeHandle(
    ref,
    (): PoseCameraRef => ({
      switchCamera: async () => {
        await nativeRef.current?.switchCamera();
      },
      setFacing: async (facing) => {
        await nativeRef.current?.setFacing(facing);
      },
      pause: async () => {
        await nativeRef.current?.pause();
        state.current = { ...state.current, active: false };
      },
      resume: async () => {
        await nativeRef.current?.resume();
        state.current = { ...state.current, active: true };
      },
      startDetection: async () => {
        await nativeRef.current?.startDetection();
        state.current = { ...state.current, detecting: true };
      },
      stopDetection: async () => {
        await nativeRef.current?.stopDetection();
        state.current = { ...state.current, detecting: false };
      },
      setOverlayEnabled: async (enabled) => {
        await nativeRef.current?.setOverlayEnabled(enabled);
      },
      setProfile: (profile) => {
        void nativeRef.current?.setProfile(profile);
      },
      getProfile: () => {
        const view = nativeRef.current;
        if (!view) throw new Error('The camera is not mounted yet.');
        return view.getProfile() as Promise<ProfileState>;
      },
      getState: () => state.current,
      snapshot: async () => {
        const view = nativeRef.current;
        if (!view) return null;
        const buffer = await view.snapshotFrame();
        const { frames, error } = decodeFrames(buffer, decodeOptions.current);
        if (error) throw new Error(error);
        return frames[0] ?? null;
      },
    }),
    [],
  );

  const handleReady = React.useCallback((event: NativeEvent<ReadyEvent>) => {
    const ready = event.nativeEvent;
    state.current = {
      ...state.current,
      facing: ready.facing,
      active: true,
      delegate: ready.delegate,
      deviceTier: ready.deviceTier,
    };
    callbacks.current.onReady?.(ready);
  }, []);

  const handleError = React.useCallback((event: NativeEvent<ErrorEvent>) => {
    if (event.nativeEvent.fatal) state.current = { ...state.current, active: false };
    callbacks.current.onError?.(event.nativeEvent);
  }, []);

  const handleCameraChange = React.useCallback((event: NativeEvent<CameraChangeEvent>) => {
    state.current = { ...state.current, facing: event.nativeEvent.facing };
    callbacks.current.onCameraChange?.(event.nativeEvent);
  }, []);

  const handlePerformanceChange = React.useCallback((event: NativeEvent<PerformanceEvent>) => {
    const performance = event.nativeEvent;
    state.current = {
      ...state.current,
      fps: performance.actualFps,
      delegate: performance.delegate,
    };
    callbacks.current.onPerformanceChange?.(performance);
  }, []);

  // One native stream feeds both the prop and the global `addLogListener()` registry.
  const handleLog = React.useCallback((event: NativeEvent<{ entries: LogEntry[] }>) => {
    const { entries } = event.nativeEvent;
    callbacks.current.onLog?.(entries);
    emitLogEntries(entries);
  }, []);

  // Listed rather than spread: `onPose`, `onPoseBatch` and `onFramesDropped` are JavaScript-only
  // and have no native counterpart.
  return (
    <NativeView
      style={props.style}
      profile={props.profile}
      facing={props.facing}
      delegate={props.delegate}
      targetFps={props.targetFps}
      resolution={props.resolution}
      analysisResolution={props.analysisResolution}
      thermalPolicy={props.thermalPolicy}
      maxPoses={props.maxPoses}
      smoothing={props.smoothing}
      active={active}
      detection={detection}
      overlay={overlay}
      data={data}
      triggers={triggers}
      logLevel={props.logLevel}
      angleJoints={angleJoints}
      selection={selection}
      ref={nativeRef as unknown as React.Ref<unknown>}
      onFrames={handleFrames}
      onReady={handleReady}
      onError={handleError}
      onCameraChange={handleCameraChange}
      onPerformanceChange={handlePerformanceChange}
      onTrigger={handleTrigger}
      onLog={handleLog}
    />
  );
});
