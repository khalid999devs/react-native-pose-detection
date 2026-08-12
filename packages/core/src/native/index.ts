import { requireNativeModule, requireNativeView } from 'expo';
import type { ComponentType } from 'react';

import type { NativePoseModule } from './contract';

// Resolved lazily: requiring at import time makes importing a type throw in an app that has not
// rebuilt its native project yet, with an error that names nothing useful.
let cachedModule: NativePoseModule | null = null;
let cachedView: ComponentType<Record<string, unknown>> | null = null;

export function getNativeModule(): NativePoseModule {
  cachedModule ??= requireNativeModule<NativePoseModule>('PoseDetection');
  return cachedModule;
}

export function getNativeView(): ComponentType<Record<string, unknown>> {
  cachedView ??= requireNativeView<Record<string, unknown>>('PoseDetection');
  return cachedView;
}

export type {
  NativeCameraPermission,
  NativePoseCameraView,
  NativePoseModule,
  NativeTriggerEvent,
} from './contract';
