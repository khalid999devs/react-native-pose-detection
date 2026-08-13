import * as React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PoseCamera } from 'react-native-pose-detection';
import type { PoseCameraRef, Trigger, TriggerEvent } from 'react-native-pose-detection';

import { Button, CameraGate, Panel, Row, Stat } from '../components';
import { EXTERNAL, SCENARIOS } from '../scenarios';
import type { ScenarioContext, ScenarioReport } from '../scenarios';
import { formatBytes } from '../memory';
import { mono, theme } from '../theme';

const READY_TIMEOUT_MS = 10_000;

/**
 * The stress panel. Each run reproduces a failure mode that has actually happened, so a green
 * sweep here is what makes a release believable on a device.
 *
 * The memory columns read the JavaScript heap, which is not where a leak in this package would
 * be. Drive these with Android Studio's profiler or Instruments attached; the iteration counts
 * are chosen to make a per-cycle leak visible on the graph rather than to be self-reporting.
 */
export function ScenariosScreen() {
  const camera = React.useRef<PoseCameraRef>(null);
  const [generation, setGeneration] = React.useState(0);
  const [epoch, setEpoch] = React.useState(0);
  const [running, setRunning] = React.useState<string | null>(null);
  const [reports, setReports] = React.useState<readonly ScenarioReport[]>([]);
  const [lines, setLines] = React.useState<readonly string[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});

  const readyResolver = React.useRef<(() => void) | null>(null);
  const countsRef = React.useRef(counts);
  countsRef.current = counts;

  // The id carries the epoch, because counts survive a props update by id and that is exactly
  // what makes them survive a camera switch. A new id is therefore the only honest reset.
  const triggers = React.useMemo<readonly Trigger[]>(
    () => [
      {
        id: `handsUp-${epoch}`,
        enter: { landmarkY: 'leftWrist', below: 'nose' },
        exit: { landmarkY: 'leftWrist', above: 'nose' },
        emit: 'cycle',
        debounceMs: 250,
      },
    ],
    [epoch],
  );

  // The event itself is not wanted, only the fact that one arrived: it is what tells a remount
  // that the next session is actually up, rather than a timer guessing.
  const onReady = React.useCallback(() => {
    readyResolver.current?.();
    readyResolver.current = null;
  }, []);

  const onTrigger = React.useCallback((event: TriggerEvent) => {
    setCounts((current) => ({ ...current, [event.id]: event.count }));
  }, []);

  const context = React.useMemo<ScenarioContext>(
    () => ({
      camera,
      counts: () => countsRef.current,
      log: (line) => setLines((current) => [...current, line]),
      remount: () =>
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
        }),
    }),
    [],
  );

  const run = async (id: string) => {
    const scenario = SCENARIOS.find((entry) => entry.id === id);
    if (!scenario) return;

    setRunning(id);
    setLines([`${scenario.title} started`]);
    const report = await scenario.run(context);
    setReports((current) => [report, ...current.filter((entry) => entry.id !== id)]);
    setRunning(null);
  };

  const runAll = async () => {
    // The soak is excluded: ten minutes inside a sweep would hide whatever came after it.
    for (const scenario of SCENARIOS.filter((entry) => entry.id !== 'soak')) {
      await run(scenario.id);
    }
  };

  const resetEverything = () => {
    setReports([]);
    setLines([]);
    setCounts({});
    setEpoch((n) => n + 1);
    setGeneration((n) => n + 1);
  };

  const passed = reports.filter((report) => report.passed).length;

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <CameraGate>
          <PoseCamera
            key={generation}
            ref={camera}
            style={StyleSheet.absoluteFill}
            overlay={{ connections: true }}
            triggers={triggers}
            onReady={onReady}
            onTrigger={onTrigger}
          />
        </CameraGate>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.stats}>
          <Stat
            label="passed"
            value={`${passed}/${reports.length}`}
            tone={reports.length > 0 && passed === reports.length ? 'ok' : undefined}
          />
          <Stat label="mounts" value={String(generation + 1)} />
          <Stat label="reps" value={String(counts[`handsUp-${epoch}`] ?? 0)} />
        </View>

        <Panel title="Run">
          <View style={styles.row}>
            <Button
              label="Run all"
              tone="primary"
              busy={running !== null}
              onPress={() => void runAll()}
            />
            <Button
              label="Reset counters"
              onPress={() => {
                setCounts({});
                setEpoch((n) => n + 1);
              }}
            />
            <Button label="Reset everything" tone="danger" onPress={resetEverything} />
          </View>
          <Text style={styles.note}>
            Raise your left wrist above your nose a few times first, so the counters have something
            to preserve across the switch run.
          </Text>
        </Panel>

        {SCENARIOS.map((scenario) => {
          const report = reports.find((entry) => entry.id === scenario.id);
          return (
            <Panel key={scenario.id} title={scenario.title}>
              <Text style={styles.note}>{scenario.verifies}</Text>
              <Button
                label={running === scenario.id ? 'Running' : 'Run'}
                busy={running === scenario.id}
                disabled={running !== null}
                onPress={() => void run(scenario.id)}
              />
              {report ? (
                <>
                  <View style={styles.divider} />
                  <Row label="result" value={report.passed ? 'pass' : 'fail'} />
                  <Row label="iterations" value={String(report.iterations)} />
                  <Row label="elapsed" value={`${(report.elapsedMs / 1000).toFixed(1)} s`} />
                  <Row
                    label="JS heap"
                    value={`${formatBytes(report.heapBefore)} to ${formatBytes(report.heapAfter)}`}
                  />
                  <Text style={report.passed ? styles.detail : styles.failure}>
                    {report.detail}
                  </Text>
                </>
              ) : null}
            </Panel>
          );
        })}

        {lines.length > 0 ? (
          <Panel title="Progress">
            {lines.map((line, index) => (
              <Text key={`${line}${index}`} style={styles.line}>
                {line}
              </Text>
            ))}
          </Panel>
        ) : null}

        <Panel title="Driven from outside">
          <Text style={styles.note}>
            Neither platform lets a process put itself into a thermal state, send itself a memory
            warning, or clear its own calibration on the next launch. These are run from the host
            while the app watches for what they should have caused.
          </Text>
          {EXTERNAL.map((entry) => (
            <View key={entry.title} style={styles.external}>
              <Text style={styles.externalTitle}>{entry.title}</Text>
              <Text style={styles.note}>{entry.verifies}</Text>
              <Text style={styles.command}>
                {Platform.OS === 'ios' ? entry.ios : entry.android}
              </Text>
            </View>
          ))}
        </Panel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  command: { color: theme.accent, fontFamily: mono, fontSize: 11 },
  detail: { color: theme.muted, fontSize: 12 },
  divider: { backgroundColor: theme.border, height: 1, marginVertical: 4 },
  external: { borderTopColor: theme.border, borderTopWidth: 1, gap: 4, paddingTop: 10 },
  externalTitle: { color: theme.text, fontSize: 13, fontWeight: '600' },
  failure: { color: theme.danger, fontSize: 12 },
  line: { color: theme.muted, fontFamily: mono, fontSize: 11 },
  list: { gap: 12, paddingBottom: 24 },
  note: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  preview: { borderRadius: 16, height: 160, overflow: 'hidden' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  screen: { flex: 1, gap: 12 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
