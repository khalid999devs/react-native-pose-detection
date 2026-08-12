import type { LogLevelConfig } from '../types/logging';

/**
 * What the Expo module must implement for the module-level API. View props, ref methods, and
 * events are declared on the view contract in Phase 3, they are not module functions.
 *
 * This exists so the public surface compiles and is fully typed before either native project
 * exists. Phase 3 swaps the stub for `requireNativeModule()` without touching a call site.
 */
export type NativePoseModule = {
  setLogLevel(config: LogLevelConfig): void;
  /** Called when the first JS listener attaches, so the native ring buffer stays idle until then. */
  startLogStream(): void;
  /** Called when the last listener detaches. */
  stopLogStream(): void;
};
