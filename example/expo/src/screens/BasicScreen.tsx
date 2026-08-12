import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PoseCamera } from 'react-native-pose-detection';
import type {
  CameraChangeEvent,
  ErrorEvent,
  PoseCameraRef,
  ReadyEvent,
} from 'react-native-pose-detection';

import { Panel, Row, Toggle } from '../components';
import { theme } from '../theme';

export function BasicScreen() {
  const camera = React.useRef<PoseCameraRef>(null);
  const [detection, setDetection] = React.useState(true);
  const [overlay, setOverlay] = React.useState(true);
  const [facing, setFacing] = React.useState<'front' | 'back'>('front');
  const [ready, setReady] = React.useState<ReadyEvent | null>(null);
  const [error, setError] = React.useState<ErrorEvent | null>(null);

  const onReady = React.useCallback((event: ReadyEvent) => {
    setReady(event);
    setError(null);
  }, []);

  const onCameraChange = React.useCallback((event: CameraChangeEvent) => {
    setFacing(event.facing);
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <PoseCamera
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          detection={detection}
          overlay={overlay}
          onReady={onReady}
          onError={setError}
          onCameraChange={onCameraChange}
        />
      </View>

      <View style={styles.controls}>
        <Toggle label="Detection" on={detection} onPress={() => setDetection((on) => !on)} />
        <Toggle label="Overlay" on={overlay} onPress={() => setOverlay((on) => !on)} />
        <Toggle
          label={facing === 'front' ? 'Front' : 'Back'}
          on
          onPress={() => setFacing((current) => (current === 'front' ? 'back' : 'front'))}
        />
      </View>

      {error ? (
        <Panel title="Error">
          <Text style={styles.error}>
            {error.code}
            {error.fatal ? ' (fatal)' : ''}
          </Text>
          <Text style={styles.errorMessage}>{error.message}</Text>
        </Panel>
      ) : null}

      <Panel title="Session">
        {ready ? (
          <>
            <Row label="Model" value={ready.model} />
            <Row label="Delegate" value={`${ready.delegate} (asked ${ready.delegateRequested})`} />
            <Row label="Device tier" value={ready.deviceTier} />
            <Row label="Preview" value={`${ready.resolution.width} x ${ready.resolution.height}`} />
            <Row
              label="Analysis"
              value={`${ready.analysisResolution.width} x ${ready.analysisResolution.height}`}
            />
          </>
        ) : (
          <Text style={styles.waiting}>Waiting for the camera to report ready.</Text>
        )}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: 10 },
  error: { color: theme.danger, fontSize: 14, fontWeight: '700' },
  errorMessage: { color: theme.text, fontSize: 13 },
  preview: {
    backgroundColor: '#000',
    borderRadius: 16,
    flex: 1,
    overflow: 'hidden',
  },
  screen: { flex: 1, gap: 12 },
  waiting: { color: theme.muted, fontSize: 13 },
});
