import { nativeModule } from './native';
import type { LogListener, LogLevelConfig, Subscription } from './types/logging';

const listeners = new Set<LogListener>();

/**
 * Sets the diagnostic level for every camera. Safe to call at any time, it writes one integer
 * natively and re-initializes nothing.
 */
export function setLogLevel(config: LogLevelConfig): void {
  nativeModule.setLogLevel(config);
}

/**
 * Entries arrive batched, not one call per line. The stream is only started while at least one
 * listener is attached.
 */
export function addLogListener(listener: LogListener): Subscription {
  listeners.add(listener);
  if (listeners.size === 1) nativeModule.startLogStream();

  return {
    remove() {
      if (listeners.delete(listener) && listeners.size === 0) {
        nativeModule.stopLogStream();
      }
    },
  };
}
