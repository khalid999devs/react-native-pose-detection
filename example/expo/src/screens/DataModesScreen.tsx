import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PoseCamera } from 'react-native-pose-detection';
import type { DataMode, PoseFrame } from 'react-native-pose-detection';

import { Button, CameraGate, Panel, Row, Segmented, Stat, Stepper, Toggle } from '../components';
import { theme } from '../theme';

const MODES: readonly DataMode[] = ['off', 'throttled', 'batched', 'live'];

const EXPLANATION: Record<DataMode, string> = {
  off: 'No frames cross to JavaScript. Triggers and the overlay still run, because both are native.',
  throttled: 'One frame per throttleMs, dropping anything in between. The usual choice for a HUD.',
  batched: 'Everything, delivered every flushMs. One crossing per flush instead of one per frame.',
  live: 'Every frame. The highest crossing rate this package can produce, and the reason the ring buffer counts drops.',
};

/**
 * The four delivery modes with what they actually cost, measured. Crossings per second is the
 * number that matters: `batched` at 500 ms delivers the same frames as `live` over two crossings
 * a second instead of thirty.
 */
export function DataModesScreen() {
  const [mode, setMode] = React.useState<DataMode>('throttled');
  const [throttleMs, setThrottleMs] = React.useState(100);
  const [flushMs, setFlushMs] = React.useState(500);
  const [worldLandmarks, setWorldLandmarks] = React.useState(false);

  const [crossings, setCrossings] = React.useState(0);
  const [frames, setFrames] = React.useState(0);
  const [dropped, setDropped] = React.useState(0);
  const [bytes, setBytes] = React.useState(0);
  const [rate, setRate] = React.useState({ crossings: 0, frames: 0 });

  // Counted in refs and sampled once a second: a setState per frame at `live` would make this
  // screen a measurement of React, not of the package.
  const crossingCount = React.useRef(0);
  const frameCount = React.useRef(0);

  const data = React.useMemo(
    () => ({ mode, throttleMs, flushMs, landmarks: true, worldLandmarks }),
    [mode, throttleMs, flushMs, worldLandmarks],
  );

  React.useEffect(() => {
    const timer = setInterval(() => {
      setRate({ crossings: crossingCount.current, frames: frameCount.current });
      crossingCount.current = 0;
      frameCount.current = 0;
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const record = React.useCallback((batch: readonly PoseFrame[]) => {
    crossingCount.current += 1;
    frameCount.current += batch.length;
    setCrossings((n) => n + 1);
    setFrames((n) => n + batch.length);

    const first = batch[0];
    if (first) setBytes(first.landmarks.byteLength + (first.worldLandmarks?.byteLength ?? 0));
  }, []);

  const onPose = React.useCallback((frame: PoseFrame) => record([frame]), [record]);

  const reset = () => {
    setCrossings(0);
    setFrames(0);
    setDropped(0);
    setBytes(0);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <CameraGate>
          <PoseCamera
            style={StyleSheet.absoluteFill}
            overlay={{ connections: true }}
            data={data}
            onPose={onPose}
            onPoseBatch={record}
            onFramesDropped={(count) => setDropped((n) => n + count)}
          />
        </CameraGate>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.stats}>
          <Stat label="crossings/s" value={String(rate.crossings)} />
          <Stat label="frames/s" value={String(rate.frames)} />
          <Stat label="dropped" value={String(dropped)} tone={dropped > 0 ? 'bad' : undefined} />
          <Stat label="bytes/frame" value={String(bytes)} />
        </View>

        <Panel title="Mode">
          <Segmented options={MODES} value={mode} onChange={setMode} />
          <Text style={styles.blurb}>{EXPLANATION[mode]}</Text>
        </Panel>

        <Panel title="Timing">
          <Stepper
            label="throttleMs"
            value={throttleMs}
            step={25}
            min={25}
            max={1000}
            suffix=" ms"
            onChange={setThrottleMs}
          />
          <Stepper
            label="flushMs"
            value={flushMs}
            step={100}
            min={100}
            max={3000}
            suffix=" ms"
            onChange={setFlushMs}
          />
          <Toggle
            label="worldLandmarks"
            on={worldLandmarks}
            onPress={() => setWorldLandmarks((v) => !v)}
          />
        </Panel>

        <Panel title="Totals">
          <Row label="crossings" value={String(crossings)} />
          <Row label="frames" value={String(frames)} />
          <Row label="frames dropped" value={String(dropped)} />
          <Button label="Reset" onPress={reset} />
        </Panel>

        <Panel title="Dropped frames">
          <Text style={styles.blurb}>
            The native ring buffer holds 64 frames and drops the oldest when this consumer cannot
            keep up, counting what it dropped so the next delivery reports it. A steady trickle here
            means the callback is doing too much work, not that the camera is struggling.
          </Text>
        </Panel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  blurb: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  list: { gap: 12, paddingBottom: 24 },
  preview: { borderRadius: 16, height: 200, overflow: 'hidden' },
  screen: { flex: 1, gap: 12 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
