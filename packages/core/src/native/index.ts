import { requireNativeModule, requireNativeView } from 'expo';
import type { ComponentType } from 'react';

import type { NativePoseCameraView, NativePoseModule } from './contract';

export const nativeModule = requireNativeModule<NativePoseModule>('PoseDetection');

/**
 * The view is resolved lazily. Requiring it at import time would make merely importing a type
 * from this package throw in an app that has not rebuilt its native project yet, and the error
 * that produces says nothing useful about the real problem.
 */
let cachedView: ComponentType<Record<string, unknown>> | null = null;

export function getNativeView(): ComponentType<Record<string, unknown>> {
  cachedView ??= requireNativeView<Record<string, unknown>>('PoseDetection');
  return cachedView;
}

export type { NativePoseCameraView, NativePoseModule };
