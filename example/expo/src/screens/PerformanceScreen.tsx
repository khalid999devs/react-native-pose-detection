import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PoseCamera } from 'react-native-pose-detection';
import type {
  PerformanceEvent,
  PoseCameraRef,
  Profile,
  ThermalPolicy,
} from 'react-native-pose-detection';

import { Button, CameraGate, Panel, Row, Segmented, Stat } from '../components';
import { formatBytes, jsHeapBytes } from '../memory';
import { theme } from '../theme';
import { useSession } from '../useSession';

const PROFILES: readonly Profile[] = ['auto', 'efficient', 'balanced', 'quality', 'unrestricted'];
const THERMAL: readonly ThermalPolicy[] = ['adaptive', 'critical-only', 'off'];

/**
 * What calibration and the thermal ladder are doing, as they do it. Every `onPerformanceChange`
 * is kept with its reason, because the interesting question on a device that got hot is not what
 * the settings are now but what changed them and in which order.
 */
export function PerformanceScreen() {
  const camera = React.useRef<PoseCameraRef>(null);
  const session = useSession(camera);

  const [profile, setProfile] = React.useState<Profile>('auto');
  const [thermalPolicy, setThermalPolicy] = React.useState<ThermalPolicy>('adaptive');
  const [history, setHistory] = React.useState<readonly PerformanceEvent[]>([]);
  const [measuredFps, setMeasuredFps] = React.useState(0);
  const [heap, setHeap] = React.useState<number | null>(jsHeapBytes());

  const frameCount = React.useRef(0);

  const onPerformanceChange = React.useCallback(
    (event: PerformanceEvent) => {
      session.onPerformanceChange(event);
      setHistory((current) => [event, ...current].slice(0, 30));
    },
    [session],
  );

  React.useEffect(() => {
    const timer = setInterval(() => {
      setMeasuredFps(frameCount.current);
      frameCount.current = 0;
      setHeap(jsHeapBytes());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const { ready, performance, profile: resolved } = session;

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <CameraGate>
          <PoseCamera
            ref={camera}
            style={StyleSheet.absoluteFill}
            profile={profile}
            thermalPolicy={thermalPolicy}
            overlay={{ connections: true }}
            data={{ mode: 'live' }}
            onReady={session.onReady}
            onError={session.onError}
            onPerformanceChange={onPerformanceChange}
            onPose={() => {
              frameCount.current += 1;
            }}
          />
        </CameraGate>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.stats}>
          <Stat label="frames/s" value={String(measuredFps)} />
          <Stat
            label="reported fps"
            value={performance ? performance.actualFps.toFixed(0) : '--'}
          />
          <Stat
            label="p50 inference"
            value={resolved ? `${resolved.p50InferenceMs.toFixed(1)}` : '--'}
          />
          <Stat label="delegate" value={ready?.delegate ?? '--'} />
        </View>

        <Panel title="Resolved">
          <Row label="profile" value={resolved?.profile ?? '-'} />
          <Row label="phase" value={resolved?.phase ?? '-'} />
          <Row label="source" value={resolved?.source ?? '-'} />
          <Row label="tier" value={resolved?.tier ?? ready?.deviceTier ?? '-'} />
          <Row
            label="targetFps"
            value={String(resolved?.resolved.targetFps ?? ready?.targetFps ?? '-')}
          />
          <Row label="preview" value={resolved?.resolved.preview ?? '-'} />
          <Row label="analysis" value={resolved?.resolved.analysis ?? '-'} />
        </Panel>

        <Panel title="Controls">
          <Segmented label="profile" options={PROFILES} value={profile} onChange={setProfile} />
          <Segmented
            label="thermalPolicy"
            options={THERMAL}
            value={thermalPolicy}
            onChange={setThermalPolicy}
          />
          <Text style={styles.note}>
            Pinning a profile stops calibration from moving that axis and leaves the rest adapting.
            The thermal ladder still runs unless thermalPolicy is off.
          </Text>
        </Panel>

        <Panel title={`Changes (${history.length})`}>
          <Button label="Clear" onPress={() => setHistory([])} />
          {history.length === 0 ? (
            <Text style={styles.note}>Nothing has changed since this screen opened.</Text>
          ) : null}
          {history.map((event, index) => (
            <View key={`${event.reason}${index}`} style={styles.change}>
              <Text style={styles.reason}>{event.reason}</Text>
              <Text style={styles.detail}>
                {`${event.delegate} · ${event.targetFps} fps · ${event.analysisResolution.width}x${event.analysisResolution.height}`}
              </Text>
            </View>
          ))}
        </Panel>

        <Panel title="Memory">
          <Row label="JS heap" value={formatBytes(heap)} />
          <Text style={styles.note}>
            The memory worth watching is native, and none of it is on the JavaScript heap: camera
            buffers, MediaPipe's arena and the overlay's layers all sit outside it. Attach Android
            Studio's profiler or Xcode Instruments and drive the Scenarios screen, which is what the
            cycle counts on it are for.
          </Text>
        </Panel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  change: { borderTopColor: theme.border, borderTopWidth: 1, gap: 2, paddingTop: 8 },
  detail: { color: theme.muted, fontSize: 12 },
  list: { gap: 12, paddingBottom: 24 },
  note: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  preview: { borderRadius: 16, height: 180, overflow: 'hidden' },
  reason: { color: theme.accent, fontSize: 13, fontWeight: '600' },
  screen: { flex: 1, gap: 12 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
