import type { ProfileState, ReadyEvent } from 'react-native-pose-detection';

/**
 * What the most recent camera session resolved, so Home can show a device summary without
 * mounting a camera to get one. Starting the camera on launch would put a permission dialog in
 * front of the menu, which is the wrong first thing to see.
 */
let ready: ReadyEvent | null = null;
let profile: ProfileState | null = null;

export function recordSession(next: { ready?: ReadyEvent; profile?: ProfileState }): void {
  if (next.ready) ready = next.ready;
  if (next.profile) profile = next.profile;
}

export function lastSession(): { ready: ReadyEvent | null; profile: ProfileState | null } {
  return { ready, profile };
}
