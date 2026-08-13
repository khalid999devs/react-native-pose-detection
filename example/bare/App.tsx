import * as React from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PoseCamera, useCameraPermission } from 'react-native-pose-detection';
import type { ErrorEvent, PoseCameraRef, ReadyEvent } from 'react-native-pose-detection';

const READY_TIMEOUT_MS = 10_000;

type Report = { readonly label: string; readonly passed: boolean; readonly detail: string };

export default function App() {
  const camera = useCameraPermission();
  const view = React.useRef<PoseCameraRef>(null);
  const [detection, setDetection] = React.useState(true);
  const [overlay, setOverlay] = React.useState(true);
  const [facing, setFacing] = React.useState<'front' | 'back'>('front');
  const [ready, setReady] = React.useState<ReadyEvent | null>(null);
  const [error, setError] = React.useState<ErrorEvent | null>(null);
  const [generation, setGeneration] = React.useState(0);
  const [running, setRunning] = React.useState<string | null>(null);
  const [reports, setReports] = React.useState<readonly Report[]>([]);

  const readyResolver = React.useRef<(() => void) | null>(null);

  const onReady = React.useCallback((event: ReadyEvent) => {
    setReady(event);
    setError(null);
    readyResolver.current?.();
    readyResolver.current = null;
  }, []);

  // Two loops rather than the eleven the Expo app runs. What this app has to prove is that the
  // CLI install path tears down and comes back, not that the UI does, and duplicating the whole
  // harness here would mean every change to it landed twice.
  const remount = () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        readyResolver.current = null;
        reject(new Error(`no onReady within ${READY_TIMEOUT_MS} ms`));
      }, READY_TIMEOUT_MS);

      readyResolver.current = () => {
        clearTimeout(timer);
        resolve();
      };
      setGeneration((n) => n + 1);
    });

  const stress = async (label: string, body: () => Promise<string>) => {
    setRunning(label);
    try {
      const detail = await body();
      setReports((current) => [{ label, passed: true, detail }, ...current]);
    } catch (thrown) {
      const detail = thrown instanceof Error ? thrown.message : String(thrown);
      setReports((current) => [{ label, passed: false, detail }, ...current]);
    } finally {
      setRunning(null);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.heading}>Pose (bare)</Text>
        <Text style={styles.subheading}>No config plugin. No prebuild.</Text>
      </View>

      <View style={styles.preview}>
        {camera.granted ? (
          <PoseCamera
            key={generation}
            ref={view}
            style={StyleSheet.absoluteFill}
            facing={facing}
            detection={detection}
            overlay={overlay}
            onReady={onReady}
            onError={setError}
          />
        ) : (
          <View style={styles.gate}>
            <Text style={styles.gateText}>
              {camera.error ? camera.error.message : `Camera permission: ${camera.status}`}
            </Text>
            {!camera.pending && !camera.error ? (
              <Pressable
                style={styles.gateButton}
                onPress={camera.canAskAgain ? camera.request : () => void Linking.openSettings()}
              >
                <Text style={styles.gateButtonText}>
                  {camera.canAskAgain ? 'Ask again' : 'Open settings'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
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

      <ScrollView contentContainerStyle={styles.panels}>
        {error ? (
          <Panel title="Error">
            <Text style={styles.error}>
              {error.code}
              {error.fatal ? ' (fatal)' : ''}
            </Text>
            <Text style={styles.body}>{error.message}</Text>
          </Panel>
        ) : null}

        <Panel title="Session">
          {ready ? (
            <>
              <Row label="Model" value={ready.model} />
              <Row
                label="Delegate"
                value={`${ready.delegate} (asked ${ready.delegateRequested})`}
              />
              <Row label="Device tier" value={ready.deviceTier} />
              <Row
                label="Preview"
                value={`${ready.resolution.width} x ${ready.resolution.height}`}
              />
              <Row
                label="Analysis"
                value={`${ready.analysisResolution.width} x ${ready.analysisResolution.height}`}
              />
            </>
          ) : (
            <Text style={styles.body}>Waiting for the camera to report ready.</Text>
          )}
        </Panel>

        <Panel title="Camera permission">
          <Row label="Status" value={camera.status} />
          <Row label="Can ask again" value={String(camera.canAskAgain)} />
          <Text style={styles.muted}>
            One call to useCameraPermission() from the package. It asks on mount, reports blocked
            separately from denied, and works the same on both platforms.
          </Text>
        </Panel>

        <Panel title="Install check">
          <Row label="Native module" value="linked" />
          <Row label="Model" value={ready ? `${ready.model} loaded` : 'not loaded yet'} />
          <Row label="Camera permission" value={camera.status} />
          <Text style={styles.muted}>
            What a running app can see. The rest of what the CLI wrote is on disk rather than in
            memory, and `npx react-native-pose-detection doctor` is what reads it: nine checks over
            the model file, its checksum, the Gradle wiring, the Xcode resource and both manifests.
          </Text>
        </Panel>

        <Panel title="Teardown">
          <View style={styles.controls}>
            <Pressable
              style={styles.stressButton}
              disabled={running !== null}
              onPress={() =>
                void stress('Switch camera x100', async () => {
                  for (let index = 0; index < 100; index += 1) {
                    const current = view.current;
                    if (!current) throw new Error('the camera is not mounted');
                    await current.switchCamera();
                  }
                  return '100 switches, each awaited to a stable session';
                })
              }
            >
              {running === 'Switch camera x100' ? (
                <ActivityIndicator color={theme.muted} size="small" />
              ) : null}
              <Text style={styles.stressText}>Switch x100</Text>
            </Pressable>

            <Pressable
              style={styles.stressButton}
              disabled={running !== null}
              onPress={() =>
                void stress('Remount x50', async () => {
                  for (let index = 0; index < 50; index += 1) await remount();
                  return '50 mount and unmount cycles, each awaited to onReady';
                })
              }
            >
              {running === 'Remount x50' ? (
                <ActivityIndicator color={theme.muted} size="small" />
              ) : null}
              <Text style={styles.stressText}>Remount x50</Text>
            </Pressable>
          </View>

          <Text style={styles.muted}>
            Mounts so far: {generation + 1}. Run these with a profiler attached; the JavaScript heap
            is not where a leak in this package would show up.
          </Text>

          {reports.map((report, index) => (
            <View key={`${report.label}${index}`} style={styles.row}>
              <Text style={report.passed ? styles.pass : styles.error}>
                {`${report.passed ? 'pass' : 'fail'}  ${report.label}`}
              </Text>
            </View>
          ))}
          {reports.map((report, index) => (
            <Text key={`detail${report.label}${index}`} style={styles.muted}>
              {report.detail}
            </Text>
          ))}
        </Panel>

        <Panel title="How the model got here">
          <Text style={styles.body}>{'npx react-native-pose-detection fetch-model full'}</Text>
          <Text style={styles.muted}>
            It downloaded the model, checked its SHA-256, copied it into
            android/app/src/main/assets, and registered it in the Xcode project. The Expo app gets
            the same file from the config plugin at prebuild. This app has no prebuild to run.
          </Text>
        </Panel>
      </ScrollView>
    </SafeAreaView>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.toggle, on && styles.toggleOn]} onPress={onPress}>
      <Text style={[styles.toggleText, on && styles.toggleTextOn]}>{label}</Text>
    </Pressable>
  );
}

const theme = {
  bg: '#0b0d10',
  panel: '#151a20',
  border: '#232b34',
  text: '#e8edf2',
  muted: '#8d99a6',
  accent: '#4da3ff',
  danger: '#ff6b6b',
  ok: '#4ade80',
} as const;

const styles = StyleSheet.create({
  body: { color: theme.text, fontSize: 13, lineHeight: 19 },
  controls: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  error: { color: theme.danger, fontSize: 14, fontWeight: '700' },
  gate: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
  gateButton: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  gateButtonText: { color: '#04121f', fontWeight: '700' },
  gateText: { color: theme.muted, fontSize: 14 },
  header: { paddingHorizontal: 16, paddingVertical: 14 },
  heading: { color: theme.text, fontSize: 24, fontWeight: '800' },
  muted: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  panel: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  panelTitle: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  panels: { gap: 12, paddingBottom: 24, paddingHorizontal: 16 },
  pass: { color: theme.ok, fontSize: 13, fontWeight: '600' },
  preview: { backgroundColor: '#000', flex: 1, marginHorizontal: 16, overflow: 'hidden' },
  root: { backgroundColor: theme.bg, flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  stressButton: {
    alignItems: 'center',
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  stressText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  subheading: { color: theme.muted, fontSize: 13 },
  toggle: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  toggleOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  toggleText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  toggleTextOn: { color: '#04121f' },
  value: { color: theme.text, fontSize: 13, fontVariant: ['tabular-nums'] },
});
