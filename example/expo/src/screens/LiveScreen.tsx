import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addLogListener,
  PoseCamera,
  setLogLevel,
  useCameraPermission,
  type CameraChangeEvent,
  type ErrorEvent,
  type LogEntry,
  type PerformanceEvent,
  type PoseCameraRef,
  type ReadyEvent,
} from 'react-native-pose-detection';

import { Button, Choice, IconButton, ToggleRow, type IconName } from '../components/Controls';
import { Glass } from '../components/Glass';
import { theme } from '../theme';

type Category = 'camera' | 'detection' | 'debug';

const CATEGORIES: { id: Category; icon: IconName; label: string }[] = [
  { id: 'camera', icon: 'camera-outline', label: 'Camera' },
  { id: 'detection', icon: 'body-outline', label: 'Detection' },
  { id: 'debug', icon: 'pulse-outline', label: 'Debug' },
];

const RESOLUTIONS = ['auto', '480p', '720p', '1080p'] as const;
const ANALYSIS = ['auto', '360p', '480p', '720p'] as const;
const LOG_LEVELS = ['off', 'warn', 'info', 'debug'] as const;

/**
 * The camera, full bleed, with everything else floating at the edges.
 *
 * The controls are grouped into three categories rather than laid out as one long rail, because the
 * middle of the screen is the part that matters: it is where the person being detected is, and a
 * panel is only ever open while somebody is deliberately changing something. Opening one closes the
 * others, and tapping the preview closes all of them.
 */
export function LiveScreen({ onClose }: { onClose: () => void }) {
  const camera = React.useRef<PoseCameraRef>(null);
  const permission = useCameraPermission();
  const insets = useSafeAreaInsets();

  const [panel, setPanel] = React.useState<Category | null>(null);

  const [overlay, setOverlay] = React.useState(true);
  const [landmarks, setLandmarks] = React.useState(true);
  const [connections, setConnections] = React.useState(true);
  const [detecting, setDetecting] = React.useState(true);
  const [active, setActive] = React.useState(true);
  const [facing, setFacing] = React.useState<'front' | 'back'>('front');
  const [resolution, setResolution] = React.useState<(typeof RESOLUTIONS)[number]>('auto');
  const [analysis, setAnalysis] = React.useState<(typeof ANALYSIS)[number]>('auto');

  const [logLevel, setLevel] = React.useState<(typeof LOG_LEVELS)[number]>('off');
  const [showLogs, setShowLogs] = React.useState(false);
  const [showStats, setShowStats] = React.useState(true);
  const [lines, setLines] = React.useState<LogEntry[]>([]);

  const [ready, setReady] = React.useState<ReadyEvent | null>(null);
  const [performance, setPerformance] = React.useState<PerformanceEvent | null>(null);
  const [notice, setNotice] = React.useState<{ message: string; fatal: boolean } | null>(null);

  const onReady = React.useCallback((event: ReadyEvent) => {
    setReady(event);
    setNotice(null);
  }, []);
  const onError = React.useCallback((event: ErrorEvent) => {
    setNotice({ message: event.message, fatal: event.fatal });
  }, []);
  const onCameraChange = React.useCallback(
    (event: CameraChangeEvent) => setFacing(event.facing),
    [],
  );
  const onPerformanceChange = React.useCallback(
    (event: PerformanceEvent) => setPerformance(event),
    [],
  );

  // The stream stays closed until somebody asks for a level, so an idle screen pays nothing for a
  // console it is not showing.
  React.useEffect(() => {
    setLogLevel(logLevel);
    if (logLevel === 'off') {
      setLines([]);
      return;
    }
    const subscription = addLogListener((entries) => {
      setLines((value) => [...value, ...entries].slice(-LOG_LIMIT));
    });
    return () => subscription.remove();
  }, [logLevel]);

  const flip = React.useCallback(() => {
    void camera.current?.switchCamera();
  }, []);

  if (!permission.granted) {
    return (
      <View style={[styles.gate, { paddingTop: insets.top }]}>
        <Glass style={styles.gateCard} radius={theme.radius.lg} intensity={20}>
          <Text style={styles.gateTitle}>Camera access</Text>
          <Text style={styles.gateBody}>
            {permission.canAskAgain
              ? 'The preview needs the camera. Nothing leaves the device.'
              : 'Camera access was denied. Turn it back on in Settings to use the preview.'}
          </Text>
          {permission.canAskAgain ? (
            <Button title="Allow camera" onPress={() => void permission.request()} />
          ) : null}
        </Glass>
      </View>
    );
  }

  const fps = Math.round(performance?.actualFps ?? 0);
  // Everything at the bottom stacks off one base, so a panel can never land under the rail.
  const railBottom = insets.bottom + theme.space(4);
  const panelBottom = railBottom + RAIL_HEIGHT + theme.space(3);
  const target = performance?.targetFps ?? ready?.targetFps ?? 0;

  return (
    <View style={styles.root}>
      <PoseCamera
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing={facing}
        active={active}
        detection={detecting}
        resolution={resolution}
        analysisResolution={analysis}
        overlay={
          overlay && {
            color: theme.color.overlay,
            lineWidth: 3,
            pointRadius: 4,
            landmarks,
            connections,
          }
        }
        onReady={onReady}
        onError={onError}
        onCameraChange={onCameraChange}
        onPerformanceChange={onPerformanceChange}
      />

      {/* Closes any open panel without stealing a tap that was meant for a control. */}
      {panel ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setPanel(null)}
          accessibilityRole="button"
          accessibilityLabel="Close the panel"
        />
      ) : null}

      <View style={[styles.top, { top: insets.top + theme.space(2) }]} pointerEvents="box-none">
        <IconButton icon="close" label="Leave the camera" onPress={onClose} size={42} />

        {showStats ? (
          <Glass style={styles.statBar} radius={theme.radius.pill} intensity={55}>
            <Live label="fps" value={ready ? `${fps}` : '–'} hint={target ? `/${target}` : ''} />
            <Divider />
            <Live label="lens" value={facing} />
            <Divider />
            <Live label="gpu" value={ready?.delegate ?? '–'} />
            <Divider />
            <Live label="in" value={String(ready?.analysisResolution ?? '–')} />
          </Glass>
        ) : (
          <View style={styles.spacer} />
        )}

        <IconButton icon="sync-outline" label="Switch camera" onPress={flip} size={42} />
      </View>

      {notice ? (
        <View
          style={[styles.noticeWrap, { top: insets.top + theme.space(16) }]}
          pointerEvents="none"
        >
          <Glass style={styles.noticeCard} radius={theme.radius.md} intensity={55}>
            <Ionicons
              name={notice.fatal ? 'alert-circle' : 'information-circle-outline'}
              size={15}
              color={notice.fatal ? theme.color.danger : theme.color.muted}
            />
            <Text
              style={[styles.noticeText, notice.fatal && { color: theme.color.danger }]}
              numberOfLines={2}
            >
              {notice.message}
            </Text>
          </Glass>
        </View>
      ) : null}

      {showLogs && logLevel !== 'off' && !panel ? (
        <View style={[styles.logWrap, { bottom: panelBottom }]} pointerEvents="box-none">
          <Glass style={styles.logCard} radius={theme.radius.md} intensity={55}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {lines.length === 0 ? (
                <Text style={styles.logEmpty}>waiting for the first entry</Text>
              ) : (
                lines.map((entry, index) => (
                  <Text
                    key={`${entry.timestamp}-${index}`}
                    style={styles.logLine}
                    numberOfLines={1}
                  >
                    <Text style={styles.logCategory}>{entry.category}</Text> {entry.message}
                  </Text>
                ))
              )}
            </ScrollView>
          </Glass>
        </View>
      ) : null}

      {panel ? (
        <View style={[styles.panelWrap, { bottom: panelBottom }]} pointerEvents="box-none">
          <Glass style={styles.panel} radius={theme.radius.lg} intensity={65}>
            {panel === 'camera' ? (
              <>
                <ToggleRow title="Camera" value={active} onChange={setActive} />
                <Choice
                  title="Preview quality"
                  options={RESOLUTIONS}
                  value={resolution}
                  onChange={setResolution}
                />
                <Choice
                  title="What the model sees"
                  options={ANALYSIS}
                  value={analysis}
                  onChange={setAnalysis}
                />
              </>
            ) : null}

            {panel === 'detection' ? (
              <>
                <ToggleRow
                  title="Inference"
                  value={detecting}
                  onChange={(next) => {
                    setDetecting(next);
                    void (next
                      ? camera.current?.startDetection()
                      : camera.current?.stopDetection());
                  }}
                />
                <ToggleRow title="Skeleton" value={overlay} onChange={setOverlay} />
                <ToggleRow title="Joints" value={landmarks} onChange={setLandmarks} />
                <ToggleRow title="Bones" value={connections} onChange={setConnections} />
              </>
            ) : null}

            {panel === 'debug' ? (
              <>
                <ToggleRow title="Readout" value={showStats} onChange={setShowStats} />
                <Choice
                  title="Log level"
                  options={LOG_LEVELS}
                  value={logLevel}
                  onChange={setLevel}
                />
                <ToggleRow title="Console" value={showLogs} onChange={setShowLogs} />
              </>
            ) : null}
          </Glass>
        </View>
      ) : null}

      <View style={[styles.rail, { bottom: railBottom }]} pointerEvents="box-none">
        <Glass style={styles.railInner} radius={theme.radius.pill} intensity={60}>
          {CATEGORIES.map((category) => (
            <IconButton
              key={category.id}
              icon={category.icon}
              label={category.label}
              active={panel === category.id}
              onPress={() => setPanel((value) => (value === category.id ? null : category.id))}
            />
          ))}
        </Glass>
      </View>
    </View>
  );
}

const LOG_LIMIT = 40;
/** The rail's own height, so the panel above it can be placed without measuring. */
const RAIL_HEIGHT = 58;

function Live({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.live}>
      <Text style={styles.liveValue} numberOfLines={1}>
        {value}
        {hint ? <Text style={styles.liveHint}>{hint}</Text> : null}
      </Text>
      <Text style={styles.liveLabel}>{label}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  top: {
    position: 'absolute',
    left: theme.space(4),
    right: theme.space(4),
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
  },
  spacer: {
    flex: 1,
  },
  statBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.space(2),
    paddingHorizontal: theme.space(4),
  },
  live: {
    alignItems: 'center',
    minWidth: 42,
  },
  liveValue: {
    color: theme.color.text,
    fontSize: theme.font.label,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  liveHint: {
    color: theme.color.faint,
    fontWeight: '500',
  },
  liveLabel: {
    color: theme.color.faint,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: theme.color.border,
  },
  noticeWrap: {
    position: 'absolute',
    left: theme.space(4),
    right: theme.space(4),
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    paddingVertical: theme.space(2.5),
    paddingHorizontal: theme.space(4),
  },
  noticeText: {
    color: theme.color.muted,
    fontSize: theme.font.tiny,
    flex: 1,
  },
  logWrap: {
    position: 'absolute',
    left: theme.space(4),
    right: theme.space(4),
  },
  logCard: {
    maxHeight: 150,
    padding: theme.space(3),
  },
  logLine: {
    color: theme.color.muted,
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 15,
  },
  logCategory: {
    color: theme.color.accent,
  },
  logEmpty: {
    color: theme.color.faint,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  panelWrap: {
    position: 'absolute',
    left: theme.space(4),
    right: theme.space(4),
  },
  panel: {
    padding: theme.space(5),
    gap: theme.space(4),
  },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  railInner: {
    flexDirection: 'row',
    padding: theme.space(1.5),
    gap: theme.space(2),
  },
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space(6),
  },
  gateCard: {
    padding: theme.space(6),
    gap: theme.space(3),
    width: '100%',
  },
  gateTitle: {
    color: theme.color.text,
    fontSize: theme.font.title,
    fontWeight: '700',
  },
  gateBody: {
    color: theme.color.muted,
    fontSize: theme.font.body,
    lineHeight: theme.font.body * 1.5,
  },
});
