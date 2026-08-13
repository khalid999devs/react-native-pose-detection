import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PoseCamera, validateTriggers } from 'react-native-pose-detection';
import type { Trigger, TriggerEmit, TriggerEvent } from 'react-native-pose-detection';

import { Button, CameraGate, Panel, Row, Segmented, Stepper, Toggle } from '../components';
import { theme } from '../theme';

const EMITS: readonly TriggerEmit[] = ['enter', 'exit', 'cycle', 'while'];

type Editable = {
  id: string;
  blurb: string;
  /** Rebuilt from the live controls, so every edit reaches native as a new trigger array. */
  build: (
    threshold: number,
    emit: TriggerEmit,
    debounceMs: number,
    minDurationMs: number,
  ) => Trigger;
  threshold: { label: string; min: number; max: number; step: number; initial: number };
};

const EDITABLE: readonly Editable[] = [
  {
    id: 'kneeBend',
    blurb: 'Left knee below the threshold, straight again above 160.',
    build: (threshold, emit, debounceMs, minDurationMs) => ({
      id: 'kneeBend',
      enter: {
        all: [
          { visibility: 'leftKnee', above: 0.6 },
          { angle: 'leftKnee', below: threshold },
        ],
      },
      exit: { angle: 'leftKnee', above: 160 },
      emit,
      debounceMs,
      minDurationMs,
    }),
    threshold: { label: 'knee below', min: 30, max: 170, step: 5, initial: 90 },
  },
  {
    id: 'elbowBend',
    blurb: 'Left elbow below the threshold, straight again above 160.',
    build: (threshold, emit, debounceMs, minDurationMs) => ({
      id: 'elbowBend',
      enter: { angle: 'leftElbow', below: threshold },
      exit: { angle: 'leftElbow', above: 160 },
      emit,
      debounceMs,
      minDurationMs,
    }),
    threshold: { label: 'elbow below', min: 30, max: 170, step: 5, initial: 90 },
  },
  {
    id: 'handsUp',
    blurb: 'Both wrists above the nose. A joint bound, so it holds at any distance.',
    build: (_threshold, emit, debounceMs, minDurationMs) => ({
      id: 'handsUp',
      enter: {
        all: [
          { landmarkY: 'leftWrist', below: 'nose' },
          { landmarkY: 'rightWrist', below: 'nose' },
        ],
      },
      exit: {
        any: [
          { landmarkY: 'leftWrist', above: 'nose' },
          { landmarkY: 'rightWrist', above: 'nose' },
        ],
      },
      emit,
      debounceMs,
      minDurationMs,
    }),
    threshold: { label: 'unused', min: 0, max: 0, step: 1, initial: 0 },
  },
  {
    id: 'rising',
    blurb: 'Center of mass moving up faster than the threshold.',
    build: (threshold, emit, debounceMs, minDurationMs) => ({
      id: 'rising',
      enter: { velocityY: 'centerOfMass', above: threshold },
      exit: { velocityY: 'centerOfMass', below: threshold / 2 },
      emit,
      debounceMs,
      minDurationMs,
    }),
    threshold: { label: 'velocity above', min: 0.1, max: 2, step: 0.1, initial: 0.5 },
  },
];

/**
 * Triggers edited live. Every control rebuilds the array and hands it back down, which is also
 * the thing worth watching: counts carry across a props update by id, so raising a threshold
 * mid-session does not reset the count.
 */
export function TriggersScreen() {
  const [enabled, setEnabled] = React.useState<readonly string[]>(['kneeBend']);
  const [emit, setEmit] = React.useState<TriggerEmit>('cycle');
  const [debounceMs, setDebounceMs] = React.useState(300);
  const [minDurationMs, setMinDurationMs] = React.useState(0);
  const [thresholds, setThresholds] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(EDITABLE.map((entry) => [entry.id, entry.threshold.initial])),
  );

  const [events, setEvents] = React.useState<readonly TriggerEvent[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});

  const triggers = React.useMemo<readonly Trigger[]>(
    () =>
      EDITABLE.filter((entry) => enabled.includes(entry.id)).map((entry) =>
        entry.build(
          thresholds[entry.id] ?? entry.threshold.initial,
          emit,
          debounceMs,
          minDurationMs,
        ),
      ),
    [enabled, thresholds, emit, debounceMs, minDurationMs],
  );

  // The same validator `<PoseCamera>` runs, called here so a bad edit shows up as a message
  // rather than as a trigger that quietly never fires.
  const issues = React.useMemo(() => validateTriggers(triggers), [triggers]);

  const onTrigger = React.useCallback((event: TriggerEvent) => {
    setCounts((current) => ({ ...current, [event.id]: event.count }));
    setEvents((current) => [event, ...current].slice(0, 40));
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <CameraGate>
          <PoseCamera
            style={StyleSheet.absoluteFill}
            overlay={{ connections: true }}
            triggers={issues.length === 0 ? triggers : []}
            onTrigger={onTrigger}
          />
        </CameraGate>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {issues.length > 0 ? (
          <Panel title="Invalid">
            {issues.map((issue) => (
              <Text key={`${issue.path}${issue.message}`} style={styles.issue}>
                {`${issue.path}: ${issue.message}`}
              </Text>
            ))}
          </Panel>
        ) : null}

        <Panel title="Triggers">
          <View style={styles.row}>
            {EDITABLE.map((entry) => (
              <Toggle
                key={entry.id}
                label={entry.id}
                on={enabled.includes(entry.id)}
                onPress={() =>
                  setEnabled((current) =>
                    current.includes(entry.id)
                      ? current.filter((id) => id !== entry.id)
                      : [...current, entry.id],
                  )
                }
              />
            ))}
          </View>

          {EDITABLE.filter((entry) => enabled.includes(entry.id)).map((entry) => (
            <View key={entry.id} style={styles.editor}>
              <Text style={styles.blurb}>{entry.blurb}</Text>
              {entry.threshold.max > 0 ? (
                <Stepper
                  label={entry.threshold.label}
                  value={thresholds[entry.id] ?? entry.threshold.initial}
                  step={entry.threshold.step}
                  min={entry.threshold.min}
                  max={entry.threshold.max}
                  decimals={entry.threshold.step < 1 ? 1 : 0}
                  onChange={(next) =>
                    setThresholds((current) => ({ ...current, [entry.id]: next }))
                  }
                />
              ) : null}
              <Row label="count" value={String(counts[entry.id] ?? 0)} />
            </View>
          ))}
        </Panel>

        <Panel title="Shared settings">
          <Segmented label="emit" options={EMITS} value={emit} onChange={setEmit} />
          <Stepper
            label="debounceMs"
            value={debounceMs}
            step={50}
            min={0}
            max={2000}
            suffix=" ms"
            onChange={setDebounceMs}
          />
          <Stepper
            label="minDurationMs"
            value={minDurationMs}
            step={100}
            min={0}
            max={5000}
            suffix=" ms"
            onChange={setMinDurationMs}
          />
          <Text style={styles.note}>
            {'`exit` is required for cycle and exit, so handsUp and rising carry one either way.'}
          </Text>
        </Panel>

        <Panel title={`Events (${events.length})`}>
          <Button label="Clear" onPress={() => setEvents([])} />
          {events.length === 0 ? <Text style={styles.note}>Nothing has fired yet.</Text> : null}
          {events.map((event, index) => (
            <View key={`${event.id}${event.timestamp}${index}`} style={styles.event}>
              <Text style={styles.eventId}>{event.id}</Text>
              <Text style={styles.eventPhase}>{event.phase}</Text>
              <Text style={styles.eventMeta}>
                {event.durationMs === undefined
                  ? `#${event.count}`
                  : `#${event.count}  ${Math.round(event.durationMs)} ms`}
              </Text>
            </View>
          ))}
        </Panel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  blurb: { color: theme.muted, fontSize: 12, lineHeight: 17 },
  editor: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 10,
  },
  event: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  eventId: { color: theme.text, flex: 1, fontSize: 12, fontWeight: '600' },
  eventMeta: { color: theme.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  eventPhase: { color: theme.accent, fontSize: 12 },
  issue: { color: theme.danger, fontSize: 12 },
  list: { gap: 12, paddingBottom: 24 },
  note: { color: theme.muted, fontSize: 12, lineHeight: 17 },
  preview: { borderRadius: 16, height: 240, overflow: 'hidden' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  screen: { flex: 1, gap: 12 },
});
