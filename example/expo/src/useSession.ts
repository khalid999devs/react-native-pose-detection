import * as React from 'react';
import type {
  ErrorEvent,
  PerformanceEvent,
  PoseCameraRef,
  ProfileState,
  ReadyEvent,
} from 'react-native-pose-detection';

import { recordSession } from './lastSession';

export type Session = {
  ready: ReadyEvent | null;
  performance: PerformanceEvent | null;
  profile: ProfileState | null;
  error: ErrorEvent | null;
  onReady: (event: ReadyEvent) => void;
  onError: (event: ErrorEvent) => void;
  onPerformanceChange: (event: PerformanceEvent) => void;
};

/**
 * What the camera resolved, merged from the two events that carry it plus the one thing that is
 * only readable on demand.
 *
 * `getProfile()` is polled because the calibration phase and the measured p50 are on no event, so
 * there is nothing to mirror them from. One bridge call a second is fine for a debug screen and
 * would not be fine in an app, which is the reason `getState()` is the synchronous one.
 */
export function useSession(camera: React.RefObject<PoseCameraRef | null>): Session {
  const [ready, setReady] = React.useState<ReadyEvent | null>(null);
  const [performance, setPerformance] = React.useState<PerformanceEvent | null>(null);
  const [profile, setProfile] = React.useState<ProfileState | null>(null);
  const [error, setError] = React.useState<ErrorEvent | null>(null);

  const onReady = React.useCallback((event: ReadyEvent) => {
    setReady(event);
    setError(null);
    recordSession({ ready: event });
  }, []);

  React.useEffect(() => {
    let alive = true;

    const poll = () => {
      camera.current
        ?.getProfile()
        .then((next) => {
          if (!alive) return;
          setProfile(next);
          recordSession({ profile: next });
        })
        // Before the session exists this rejects, and that is not worth showing anybody.
        .catch(() => {});
    };

    poll();
    const timer = setInterval(poll, 1000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [camera]);

  return {
    ready,
    performance,
    profile,
    error,
    onReady,
    onError: setError,
    onPerformanceChange: setPerformance,
  };
}
