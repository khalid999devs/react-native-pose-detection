# Camera permission

One hook. It asks, it reports, and it tells you when asking again is pointless.

```tsx
import { PoseCamera, useCameraPermission } from 'react-native-pose-detection';

function Camera() {
  const { granted } = useCameraPermission();
  return granted ? <PoseCamera style={{ flex: 1 }} /> : null;
}
```

**Built on both platforms**, with one difference worth knowing: Android can tell `denied` from
`blocked`, and iOS cannot. iOS prompts once per install, so any refusal is permanent and the hook
reports `blocked` with `canAskAgain: false`. Sending the user to Settings is the only route back
on either platform; on iOS it is the only route at all.

## `useCameraPermission(options?)`

```ts
function useCameraPermission(options?: { ask?: boolean }): {
  status: 'granted' | 'denied' | 'blocked' | 'undetermined';
  granted: boolean;
  canAskAgain: boolean;
  pending: boolean;
  request: () => Promise<CameraPermission>;
  error?: Error;
};
```

`ask` defaults to `true`, which prompts once on mount. Set it to `false` to read the status
without a dialog and call `request()` at a moment of your choosing, which is what you want if the
camera lives behind a button rather than on the first screen.

`pending` is true while the first read or a prompt is in flight. Prompting twice at once is
rejected by the system, so a second `request()` while one is open returns the same promise rather
than starting another.

## The four states

| `status` | `granted` | `canAskAgain` | What to do |
| --- | --- | --- | --- |
| `undetermined` | false | true | Nobody has asked yet. Call `request()` |
| `granted` | true | false | Render the camera |
| `denied` | false | true | Refused, but the system will still prompt. Offer to ask again |
| `blocked` | false | false | The system will not prompt again. Offer `Linking.openSettings()` |

**`denied` and `blocked` are the distinction that matters.** Treat them the same and you show an
"Allow camera" button that opens no dialog and does nothing, which is the usual way this goes
wrong. On Android, `blocked` is what "Don't ask again" produces.

```tsx
const { granted, canAskAgain, request } = useCameraPermission();

if (granted) return <PoseCamera style={{ flex: 1 }} />;

return (
  <Button
    title={canAskAgain ? 'Allow camera' : 'Open settings'}
    onPress={canAskAgain ? request : Linking.openSettings}
  />
);
```

Opening Settings is `Linking.openSettings()` from React Native itself. This package does not wrap
it: it is not camera-specific and React Native already does it correctly.

## Without React

```ts
import { getCameraPermission, requestCameraPermission } from 'react-native-pose-detection';

const current = await getCameraPermission(); // never prompts
const after = await requestCameraPermission(); // prompts when the system still will
```

Same four states, same fields. `getCameraPermission()` is safe to call anywhere, including during
an effect, because it cannot put a dialog on screen.

## What the package does not do

`<PoseCamera>` never prompts. Without the permission it reports `PERMISSION_DENIED` through
`onError` and stops, because when to ask is a product decision: a dialog the moment a screen
mounts is rarely the right one, and a library cannot know where the good moment is.

Declaring the permission is separate from being granted it. Android is handled for you, this
package declares `android.permission.CAMERA` in its own manifest and the merger adds it to your
app. iOS has no manifest merging, so `NSCameraUsageDescription` in `Info.plist` is yours. See
[installation](../installation.md).
