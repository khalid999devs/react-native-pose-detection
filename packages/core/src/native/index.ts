import type { NativePoseModule } from './contract';
import { stubNativeModule } from './stub';

// Phase 3 replaces this binding with requireNativeModule('PoseDetection').
export const nativeModule: NativePoseModule = stubNativeModule;

export type { NativePoseModule };
