import type { NativePoseModule } from './contract';

// The level and the ring buffer both live natively, so with no native module attached there is
// nothing to hold. Silence is the correct behavior here, not a throw: logging is diagnostic and
// must never be the reason an app fails to start.
export const stubNativeModule: NativePoseModule = {
  setLogLevel() {
    return;
  },
  startLogStream() {
    return;
  },
  stopLogStream() {
    return;
  },
};
