# react-native-pose-detection

Real-time pose detection for React Native and Expo. 33 body landmarks, iOS and Android,
powered by MediaPipe.

> **Pre-release, not yet published.** Both platforms are complete: the camera, the detector, the
> native overlay, the trigger engine and the self-tuning performance governor. iOS runs on
> physical hardware; the Android device pass is what remains before `0.1.0`. This describes
> `0.1.0`, not what installs today.

## Install

```bash
npm i react-native-pose-detection
```

```json
{ "plugins": [["react-native-pose-detection", { "model": "full" }]] }
```

```bash
npx expo prebuild
```

## Use

```tsx
import { PoseCamera } from 'react-native-pose-detection';

export default function App() {
  return <PoseCamera style={{ flex: 1 }} />;
}
```

A live camera with a skeleton drawn natively, tuned to the device, with zero data crossing
to JavaScript.

## Why

- **No model files to hunt down**: the config plugin fetches, verifies, and installs one
- **Zero runtime dependencies**: nothing installed alongside it. The peers are `expo`, `react`
  and `react-native`, so no VisionCamera and no Reanimated; old and new architecture
- **Zero bridge cost by default**: data crossing to JS is opt-in
- **Logic runs natively**: declare thresholds, get called once per event
- **Tunes itself**: measures the device, settles on the fastest sustainable config, remembers it

## Requirements

React Native 0.74+ · Expo SDK 51+ · iOS 15.1+ · Android API 24+

**Expo Go is not supported**. This package contains native code.

## Documentation

Full documentation lives in the repository:

- [Guides](https://github.com/khalid999devs/react-native-pose-detection/tree/main/guides)
- [API reference](https://github.com/khalid999devs/react-native-pose-detection/tree/main/guides/reference)
- [Contributing](https://github.com/khalid999devs/react-native-pose-detection/tree/main/docs)

## License

MIT
