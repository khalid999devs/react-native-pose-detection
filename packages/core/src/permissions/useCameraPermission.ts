import * as React from 'react';

import { getCameraPermission, requestCameraPermission } from './permissions';
import type { CameraPermission } from './permissions';

export type UseCameraPermission = CameraPermission & {
  /** True while the first read, or a prompt, is in flight. */
  readonly pending: boolean;
  /** Prompt again. Returns the outcome, and is also written to the hook's state. */
  readonly request: () => Promise<CameraPermission>;
  /**
   * Set when the native module could not answer, which today means iOS: there is no module there
   * yet. `status` stays `undetermined` in that case, so an app that ignores this still refuses to
   * open the camera rather than opening one it has no permission for.
   */
  readonly error?: Error;
};

const UNDETERMINED: CameraPermission = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
};

/**
 * The camera permission, asked for on mount.
 *
 * ```tsx
 * const { granted } = useCameraPermission();
 * return granted ? <PoseCamera style={StyleSheet.absoluteFill} /> : <Explain />;
 * ```
 *
 * Pass `{ ask: false }` to read the status without prompting, for an app that wants to choose the
 * moment. Nothing else in this package prompts: `<PoseCamera>` reports `PERMISSION_DENIED` and
 * stops, because when to ask is a product decision and a dialog at mount is rarely the answer.
 */
export function useCameraPermission(options?: { ask?: boolean }): UseCameraPermission {
  const ask = options?.ask ?? true;

  const [state, setState] = React.useState<CameraPermission>(UNDETERMINED);
  const [pending, setPending] = React.useState(true);
  const [error, setError] = React.useState<Error | undefined>(undefined);

  const mounted = React.useRef(true);
  // A second prompt while one is open is rejected by the system, and StrictMode runs effects
  // twice, so the in-flight call is shared rather than started again.
  const inFlight = React.useRef<Promise<CameraPermission> | null>(null);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = React.useCallback(
    (read: () => Promise<CameraPermission>): Promise<CameraPermission> => {
      const existing = inFlight.current;
      if (existing) return existing;

      setPending(true);
      const promise = read()
        .then((result) => {
          if (mounted.current) {
            setState(result);
            setError(undefined);
          }
          return result;
        })
        .catch((cause: unknown) => {
          const failure = cause instanceof Error ? cause : new Error(String(cause));
          if (mounted.current) setError(failure);
          return UNDETERMINED;
        })
        .finally(() => {
          inFlight.current = null;
          if (mounted.current) setPending(false);
        });

      inFlight.current = promise;
      return promise;
    },
    [],
  );

  const request = React.useCallback(() => run(requestCameraPermission), [run]);

  React.useEffect(() => {
    void run(ask ? requestCameraPermission : getCameraPermission);
  }, [ask, run]);

  return { ...state, pending, request, ...(error ? { error } : {}) };
}
