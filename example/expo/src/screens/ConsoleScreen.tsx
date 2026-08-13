import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  LOG_CATEGORIES,
  LOG_LEVELS,
  PoseCamera,
  addLogListener,
  setLogLevel,
} from 'react-native-pose-detection';
import type { LogCategory, LogEntry, LogLevel, LogLevelConfig } from 'react-native-pose-detection';

import { Button, CameraGate, Chips, Panel, Segmented, Toggle } from '../components';
import { mono, theme } from '../theme';

const TONE: Record<LogEntry['level'], string> = {
  error: theme.danger,
  warn: '#f5b942',
  info: theme.text,
  debug: theme.muted,
  trace: theme.muted,
};

const KEEP = 300;

/**
 * The native log channel, unfiltered on the way in and filtered here on the way out. The level is
 * what native decides to send at all, and the chips below only hide what already crossed, so
 * turning a category back on shows nothing retroactively.
 */
export function ConsoleScreen() {
  const [level, setLevel] = React.useState<LogLevel>('info');
  const [perCategory, setPerCategory] = React.useState(false);
  const [levels, setLevels] = React.useState<Partial<Record<LogCategory, LogLevel>>>({});
  const [visible, setVisible] = React.useState<readonly LogCategory[]>([...LOG_CATEGORIES]);
  const [paused, setPaused] = React.useState(false);
  const [entries, setEntries] = React.useState<readonly LogEntry[]>([]);
  const [dropped, setDropped] = React.useState(0);

  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;

  // One level for everything, or one per category, which is how you get trace on triggers without
  // drowning in camera. An unnamed category in the record is off rather than inherited.
  const config = React.useMemo<LogLevelConfig>(
    () => (perCategory ? levels : level),
    [perCategory, levels, level],
  );

  React.useEffect(() => {
    setLogLevel(config);
    return () => setLogLevel('off');
  }, [config]);

  React.useEffect(() => {
    const subscription = addLogListener((batch) => {
      // Native opens a batch with a warn carrying droppedCount when its own ring buffer overflowed,
      // which is the one log line that is about the log channel rather than about the package.
      const first = batch[0];
      const count = first?.data?.droppedCount;
      if (typeof count === 'number') setDropped((n) => n + count);

      if (pausedRef.current) return;
      setEntries((current) => [...batch].reverse().concat(current).slice(0, KEEP));
    });

    return () => subscription.remove();
  }, []);

  const shown = entries.filter((entry) => visible.includes(entry.category));

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <CameraGate>
          <PoseCamera style={StyleSheet.absoluteFill} overlay={{ connections: true }} />
        </CameraGate>
      </View>

      <Panel title="Level">
        <Toggle
          label={perCategory ? 'Per category' : 'One level'}
          on={perCategory}
          onPress={() => setPerCategory((v) => !v)}
        />
        {perCategory ? (
          LOG_CATEGORIES.map((category) => (
            <Segmented
              key={category}
              label={category}
              options={LOG_LEVELS}
              value={levels[category] ?? 'off'}
              onChange={(next) => setLevels((current) => ({ ...current, [category]: next }))}
            />
          ))
        ) : (
          <Segmented label="level" options={LOG_LEVELS} value={level} onChange={setLevel} />
        )}
      </Panel>

      <Panel title="Show">
        <Chips
          options={LOG_CATEGORIES}
          selected={visible}
          onToggle={(category) =>
            setVisible((current) =>
              current.includes(category)
                ? current.filter((name) => name !== category)
                : [...current, category],
            )
          }
        />
        <View style={styles.row}>
          <Toggle
            label={paused ? 'Paused' : 'Live'}
            on={!paused}
            onPress={() => setPaused((v) => !v)}
          />
          <Button
            label="Clear"
            onPress={() => {
              setEntries([]);
              setDropped(0);
            }}
          />
        </View>
      </Panel>

      <View style={styles.log}>
        <View style={styles.logHeader}>
          <Text style={styles.logCount}>{`${shown.length} shown of ${entries.length}`}</Text>
          {dropped > 0 ? <Text style={styles.logDropped}>{`${dropped} dropped`}</Text> : null}
        </View>

        <ScrollView contentContainerStyle={styles.logBody}>
          {shown.length === 0 ? (
            <Text style={styles.empty}>
              {config === 'off' ? 'The level is off, so native sends nothing.' : 'Nothing yet.'}
            </Text>
          ) : null}
          {shown.map((entry, index) => (
            <Text
              key={`${entry.timestamp}${index}`}
              style={[styles.line, { color: TONE[entry.level] }]}
            >
              {`${entry.timestamp.toFixed(0).padStart(7)} ${entry.category.padEnd(11)} ${
                entry.message
              }`}
              {entry.data ? (
                <Text style={styles.data}>{`  ${JSON.stringify(entry.data)}`}</Text>
              ) : null}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  data: { color: theme.muted },
  empty: { color: theme.muted, fontSize: 12 },
  line: { fontFamily: mono, fontSize: 10, lineHeight: 15 },
  log: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  logBody: { gap: 1, padding: 10 },
  logCount: { color: theme.muted, fontSize: 11 },
  logDropped: { color: theme.danger, fontSize: 11 },
  logHeader: {
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  preview: { borderRadius: 16, height: 140, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 8 },
  screen: { flex: 1, gap: 12 },
});
