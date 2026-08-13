import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  ANGLE_JOINT_NAMES,
  detectOnImage,
  detectOnVideo,
  hasLandmark,
  landmark,
} from 'react-native-pose-detection';
import type { PoseFrame, VideoTask } from 'react-native-pose-detection';

import { Button, Panel, Row, Stat, Stepper, Toggle } from '../components';
import { theme } from '../theme';

/**
 * Detection with no camera involved. The same engine and the same wire format, reached through a
 * promise instead of a ring buffer, which is why the frames that come back are ordinary
 * `PoseFrame`s and read with the same accessors.
 */
export function StaticInputScreen() {
  const [uri, setUri] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<'image' | 'video' | null>(null);
  const [frames, setFrames] = React.useState<readonly PoseFrame[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [elapsedMs, setElapsedMs] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [fps, setFps] = React.useState(10);
  const [smoothing, setSmoothing] = React.useState(true);
  const [worldLandmarks, setWorldLandmarks] = React.useState(false);

  const task = React.useRef<VideoTask | null>(null);

  React.useEffect(() => () => task.current?.cancel(), []);

  const pick = async (media: 'image' | 'video') => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: media === 'image' ? ['images'] : ['videos'],
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;

    setUri(asset.uri);
    setKind(media);
    setFrames([]);
    setError(null);
    setElapsedMs(null);
  };

  const run = async () => {
    if (uri === null || kind === null) return;

    setBusy(true);
    setError(null);
    setProgress(0);
    const started = Date.now();

    try {
      if (kind === 'image') {
        setFrames(await detectOnImage(uri, { angles: true, worldLandmarks }));
      } else {
        const video = detectOnVideo(uri, {
          fps,
          smoothing,
          worldLandmarks,
          angles: true,
          onProgress: setProgress,
        });
        task.current = video;
        setFrames(await video.frames);
        task.current = null;
      }
      setElapsedMs(Date.now() - started);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  };

  const first = frames[0];

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Panel title="Source">
        <View style={styles.row}>
          <Button label="Pick image" onPress={() => void pick('image')} disabled={busy} />
          <Button label="Pick video" onPress={() => void pick('video')} disabled={busy} />
        </View>
        <Text style={styles.uri}>{uri ?? 'Nothing picked yet.'}</Text>
      </Panel>

      {kind === 'video' ? (
        <Panel title="Video options">
          <Stepper label="fps" value={fps} step={1} min={1} max={30} onChange={setFps} />
          <View style={styles.row}>
            <Toggle label="smoothing" on={smoothing} onPress={() => setSmoothing((v) => !v)} />
            <Toggle
              label="worldLandmarks"
              on={worldLandmarks}
              onPress={() => setWorldLandmarks((v) => !v)}
            />
          </View>
          <Text style={styles.note}>
            `fps` is how often the video is sampled, not its own frame rate. A 30 fps clip sampled
            at 10 gives you every third frame and a third of the work.
          </Text>
        </Panel>
      ) : null}

      <Panel title="Run">
        <View style={styles.row}>
          <Button
            label={busy ? 'Detecting' : 'Detect'}
            tone="primary"
            busy={busy}
            disabled={uri === null}
            onPress={() => void run()}
          />
          {busy && kind === 'video' ? (
            <Button label="Cancel" tone="danger" onPress={() => task.current?.cancel()} />
          ) : null}
        </View>
        {busy && kind === 'video' ? (
          <Row label="progress" value={`${Math.round(progress * 100)}%`} />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Panel>

      {frames.length > 0 ? (
        <>
          <View style={styles.stats}>
            <Stat label="frames" value={String(frames.length)} />
            <Stat label="elapsed" value={elapsedMs === null ? '--' : `${elapsedMs} ms`} />
            <Stat
              label="per frame"
              value={elapsedMs === null ? '--' : `${(elapsedMs / frames.length).toFixed(1)} ms`}
            />
          </View>

          <Panel title="First frame">
            {first ? (
              <>
                <Row label="landmark floats" value={String(first.landmarks.length)} />
                <Row label="bodySpan" value={first.bodySpan.toFixed(3)} />
                <Row
                  label="centerOfMass"
                  value={`${first.centerOfMass.x.toFixed(3)}, ${first.centerOfMass.y.toFixed(3)}`}
                />
                <Row label="nose" value={describeNose(first)} />
                <View style={styles.divider} />
                {ANGLE_JOINT_NAMES.map((joint) => {
                  const value = first.angles?.[joint];
                  return (
                    <Row
                      key={joint}
                      label={joint}
                      value={
                        value === undefined || Number.isNaN(value) ? '--' : `${value.toFixed(0)}°`
                      }
                    />
                  );
                })}
              </>
            ) : null}
          </Panel>
        </>
      ) : null}

      <Panel title="Note">
        <Text style={styles.note}>
          A video decodes on a background thread and reports progress as it goes. Cancelling stops
          the decode rather than throwing away finished work, so a cancelled task resolves with the
          frames it already had.
        </Text>
      </Panel>
    </ScrollView>
  );
}

function describeNose(frame: PoseFrame): string {
  // Guarded rather than caught: `landmark()` throws for a joint `data.select` left out, which is a
  // configuration mistake worth a stack trace in an app and not worth one here.
  if (!hasLandmark(frame, 'nose')) return 'not in the buffer';
  const nose = landmark(frame, 'nose');
  return `${nose.x.toFixed(3)}, ${nose.y.toFixed(3)}  vis ${nose.visibility.toFixed(2)}`;
}

const styles = StyleSheet.create({
  divider: { backgroundColor: theme.border, height: 1, marginVertical: 4 },
  error: { color: theme.danger, fontSize: 13 },
  list: { gap: 12, paddingBottom: 24 },
  note: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  uri: { color: theme.muted, fontSize: 11 },
});
