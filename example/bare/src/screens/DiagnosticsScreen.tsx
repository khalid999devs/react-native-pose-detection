import * as React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PoseCamera, type PoseCameraRef, type TriggerEvent } from 'react-native-pose-detection';

import { Button } from '../components/Controls';
import { Glass } from '../components/Glass';
import { EXTERNAL, SCENARIOS, type ScenarioReport } from '../scenarios';
import { theme } from '../theme';

/**
 * The device regression harness.
 *
 * Reached from a quiet link on the overview rather than the tab bar: it exists so the crashes in
 * docs/testing.md can be reproduced on a real phone, and it is not part of what this app is for.
 * The camera it drives is deliberately small; the scenarios care about lifecycle, not about what
 * the preview looks like.
 */
export function DiagnosticsScreen({ onClose }: { onClose: () => void }) {
  const camera = React.useRef<PoseCameraRef>(null);
  const [generation, setGeneration] = React.useState(0);
  const [running, setRunning] = React.useState<string | null>(null);
  const [reports, setReports] = React.useState<Record<string, ScenarioReport>>({});
  const [lines, setLines] = React.useState<string[]>([]);
  const counts = React.useRef<Record<string, number>>({});
  const ready = React.useRef<(() => void) | null>(null);
  const insets = useSafeAreaInsets();

  const onReady = React.useCallback(() => {
    ready.current?.();
    ready.current = null;
  }, []);

  const onTrigger = React.useCallback((event: TriggerEvent) => {
    counts.current[event.id] = (counts.current[event.id] ?? 0) + 1;
  }, []);

  const remount = React.useCallback(
    () =>
      new Promise<void>((resolve) => {
        ready.current = resolve;
        setGeneration((value) => value + 1);
      }),
    [],
  );

  const run = React.useCallback(
    async (id: string) => {
      const scenario = SCENARIOS.find((item) => item.id === id);
      if (!scenario) return;
      setRunning(id);
      setLines([]);
      try {
        const report = await scenario.run({
          camera,
          remount,
          counts: () => counts.current,
          log: (line) => setLines((value) => [...value, line]),
        });
        setReports((value) => ({ ...value, [id]: report }));
      } catch (problem) {
        setLines((value) => [...value, `threw: ${String(problem)}`]);
      } finally {
        setRunning(null);
      }
    },
    [remount],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + theme.space(3) }]}>
      <View style={styles.head}>
        <Text style={styles.title}>Diagnostics</Text>
        <Pressable onPress={onClose} accessibilityRole="button">
          <Text style={styles.close}>Done</Text>
        </Pressable>
      </View>

      <View style={styles.stage}>
        <PoseCamera
          key={generation}
          ref={camera}
          style={StyleSheet.absoluteFill}
          overlay={{ color: theme.color.accent }}
          onReady={onReady}
          onTrigger={onTrigger}
        />
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {SCENARIOS.map((scenario) => {
          const report = reports[scenario.id];
          return (
            <Glass key={scenario.id} style={styles.card} radius={theme.radius.md} intensity={20}>
              <View style={styles.cardHead}>
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>{scenario.title}</Text>
                  <Text style={styles.cardBody}>{scenario.verifies}</Text>
                </View>
                <Button
                  title={running === scenario.id ? 'Running' : 'Run'}
                  tone="quiet"
                  busy={running === scenario.id}
                  disabled={running !== null}
                  onPress={() => void run(scenario.id)}
                />
              </View>
              {report ? (
                <Text
                  style={[
                    styles.report,
                    { color: report.passed ? theme.color.good : theme.color.danger },
                  ]}
                >
                  {report.passed ? 'passed' : 'failed'} · {report.iterations} iterations ·{' '}
                  {Math.round(report.elapsedMs)} ms · {report.detail}
                </Text>
              ) : null}
            </Glass>
          );
        })}

        <Text style={styles.section}>Run these from the host</Text>
        {EXTERNAL.map((item) => (
          <Glass key={item.title} style={styles.card} radius={theme.radius.md} intensity={20}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardBody}>{item.verifies}</Text>
            <Text style={styles.command}>{Platform.OS === 'ios' ? item.ios : item.android}</Text>
          </Glass>
        ))}

        {lines.length > 0 ? (
          <Glass style={styles.log} radius={theme.radius.md} intensity={20}>
            {lines.slice(-12).map((line, index) => (
              <Text key={`${index}-${line}`} style={styles.logLine}>
                {line}
              </Text>
            ))}
          </Glass>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space(6),
    paddingBottom: theme.space(4),
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.title,
    fontWeight: '700',
  },
  close: {
    color: theme.color.accent,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  stage: {
    height: 160,
    marginHorizontal: theme.space(6),
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  list: {
    padding: theme.space(6),
    gap: theme.space(3),
  },
  card: {
    padding: theme.space(4),
    gap: theme.space(3),
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
  },
  cardText: {
    flex: 1,
    gap: theme.space(1),
  },
  cardTitle: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '700',
  },
  cardBody: {
    color: theme.color.muted,
    fontSize: theme.font.label,
  },
  section: {
    color: theme.color.faint,
    fontSize: theme.font.tiny,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingTop: theme.space(4),
  },
  command: {
    color: theme.color.accent,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  report: {
    fontSize: theme.font.tiny,
    fontVariant: ['tabular-nums'],
  },
  log: {
    padding: theme.space(4),
    gap: theme.space(1),
  },
  logLine: {
    color: theme.color.muted,
    fontSize: theme.font.tiny,
    fontFamily: 'monospace',
  },
});
