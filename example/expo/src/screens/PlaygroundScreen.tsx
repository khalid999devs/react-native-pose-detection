import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ANGLE_JOINT_NAMES,
  JOINT_NAMES,
  LOG_LEVELS,
  PoseCamera,
} from 'react-native-pose-detection';
import type {
  AnalysisResolutionPreset,
  AngleJointName,
  DataMode,
  DelegateRequest,
  FacingRequest,
  JointName,
  LogLevel,
  OverlayConfig,
  PoseCameraRef,
  Profile,
  ResolutionPreset,
  ThermalPolicy,
} from 'react-native-pose-detection';

import { Button, CameraGate, Chips, Panel, Row, Segmented, Stepper, Toggle } from '../components';
import { theme } from '../theme';
import { useSession } from '../useSession';

const PROFILES: readonly Profile[] = ['auto', 'efficient', 'balanced', 'quality', 'unrestricted'];
const DELEGATES: readonly DelegateRequest[] = ['auto', 'gpu', 'cpu'];
const FACINGS: readonly FacingRequest[] = ['auto', 'front', 'back'];
const RESOLUTIONS: readonly ('auto' | ResolutionPreset)[] = ['auto', '480p', '720p', '1080p'];
const ANALYSIS: readonly ('auto' | AnalysisResolutionPreset)[] = ['auto', '360p', '480p', '720p'];
const THERMAL: readonly ThermalPolicy[] = ['adaptive', 'critical-only', 'off'];
const DATA_MODES: readonly DataMode[] = ['off', 'throttled', 'batched', 'live'];
const FPS: readonly string[] = ['auto', '15', '24', '30', '60'];
const COLORS: readonly string[] = ['#4da3ff', '#4ade80', '#ff6b6b', '#f5b942', '#ffffff'];

/**
 * Every prop, with what was asked for next to what came back. The point of the screen is the
 * gap between those two columns: an `auto` that resolved to `720p` is calibration working, and
 * a pinned `1080p` that came back `720p` is the thermal ladder stepping down.
 */
export function PlaygroundScreen() {
  const camera = React.useRef<PoseCameraRef>(null);
  const session = useSession(camera);

  const [profile, setProfile] = React.useState<Profile>('auto');
  const [delegate, setDelegate] = React.useState<DelegateRequest>('auto');
  const [facing, setFacing] = React.useState<FacingRequest>('auto');
  const [resolution, setResolution] = React.useState<'auto' | ResolutionPreset>('auto');
  const [analysis, setAnalysis] = React.useState<'auto' | AnalysisResolutionPreset>('auto');
  const [thermalPolicy, setThermalPolicy] = React.useState<ThermalPolicy>('adaptive');
  const [targetFps, setTargetFps] = React.useState<string>('auto');
  const [maxPoses, setMaxPoses] = React.useState(1);

  const [active, setActive] = React.useState(true);
  const [detection, setDetection] = React.useState(true);
  const [smoothing, setSmoothing] = React.useState(true);
  const [minCutoff, setMinCutoff] = React.useState(1);
  const [beta, setBeta] = React.useState(0.007);

  const [overlayOn, setOverlayOn] = React.useState(true);
  const [landmarks, setLandmarks] = React.useState(true);
  const [connections, setConnections] = React.useState(true);
  const [lineWidth, setLineWidth] = React.useState(3);
  const [pointRadius, setPointRadius] = React.useState(4);
  const [minVisibility, setMinVisibility] = React.useState(0.5);
  const [color, setColor] = React.useState<string>('#4da3ff');
  const [only, setOnly] = React.useState<readonly JointName[]>([]);
  const [arcs, setArcs] = React.useState<readonly AngleJointName[]>([]);

  const [mode, setMode] = React.useState<DataMode>('off');
  const [throttleMs, setThrottleMs] = React.useState(100);
  const [flushMs, setFlushMs] = React.useState(500);
  const [wantLandmarks, setWantLandmarks] = React.useState(true);
  const [worldLandmarks, setWorldLandmarks] = React.useState(false);
  const [dataAngles, setDataAngles] = React.useState<readonly AngleJointName[]>([]);
  const [select, setSelect] = React.useState<readonly JointName[]>([]);
  const [logLevel, setLogLevel] = React.useState<LogLevel>('off');

  const [frames, setFrames] = React.useState(0);
  const [dropped, setDropped] = React.useState(0);

  // Rebuilt only when something in it moves. A fresh object every render would hand the native
  // view a new prop on every state change anywhere on this screen.
  const overlay = React.useMemo<OverlayConfig>(
    () => ({
      landmarks,
      connections,
      color,
      lineWidth,
      pointRadius,
      minVisibility,
      ...(only.length > 0 ? { only } : {}),
      ...(arcs.length > 0
        ? { angles: arcs.map((joint) => ({ joint, label: true, radius: 40 })) }
        : {}),
    }),
    [landmarks, connections, color, lineWidth, pointRadius, minVisibility, only, arcs],
  );

  const data = React.useMemo(
    () => ({
      mode,
      throttleMs,
      flushMs,
      landmarks: wantLandmarks,
      worldLandmarks,
      ...(dataAngles.length > 0 ? { angles: dataAngles } : {}),
      ...(select.length > 0 ? { select } : {}),
    }),
    [mode, throttleMs, flushMs, wantLandmarks, worldLandmarks, dataAngles, select],
  );

  const { ready, performance, profile: resolved } = session;

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <CameraGate>
          <PoseCamera
            ref={camera}
            style={StyleSheet.absoluteFill}
            profile={profile}
            delegate={delegate}
            facing={facing}
            resolution={resolution}
            analysisResolution={analysis}
            thermalPolicy={thermalPolicy}
            targetFps={targetFps === 'auto' ? 'auto' : Number(targetFps)}
            maxPoses={maxPoses}
            active={active}
            detection={detection}
            smoothing={smoothing ? { minCutoff, beta } : false}
            overlay={overlayOn ? overlay : false}
            data={data}
            logLevel={logLevel}
            onReady={session.onReady}
            onError={session.onError}
            onPerformanceChange={session.onPerformanceChange}
            onPose={() => setFrames((n) => n + 1)}
            onPoseBatch={(batch) => setFrames((n) => n + batch.length)}
            onFramesDropped={(count) => setDropped((n) => n + count)}
          />
        </CameraGate>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Panel title="Requested vs resolved">
          <Compare label="profile" requested={profile} resolved={resolved?.profile} />
          <Compare label="delegate" requested={delegate} resolved={ready?.delegate} />
          <Compare
            label="targetFps"
            requested={targetFps}
            resolved={performance?.targetFps ?? ready?.targetFps}
          />
          <Compare
            label="resolution"
            requested={resolution}
            resolved={ready && `${ready.resolution.width}x${ready.resolution.height}`}
          />
          <Compare
            label="analysisResolution"
            requested={analysis}
            resolved={
              performance
                ? `${performance.analysisResolution.width}x${performance.analysisResolution.height}`
                : ready && `${ready.analysisResolution.width}x${ready.analysisResolution.height}`
            }
          />
          <Compare label="facing" requested={facing} resolved={ready?.facing} />

          <View style={styles.divider} />
          <Row label="model" value={ready?.model ?? '-'} />
          <Row label="deviceTier" value={ready?.deviceTier ?? '-'} />
          <Row label="phase" value={resolved ? `${resolved.phase} (${resolved.source})` : '-'} />
          <Row
            label="p50 inference"
            value={resolved ? `${resolved.p50InferenceMs.toFixed(1)} ms` : '-'}
          />
          <Row label="last change" value={performance?.reason ?? 'none yet'} />
        </Panel>

        <Panel title="Performance">
          <Segmented label="profile" options={PROFILES} value={profile} onChange={setProfile} />
          <Segmented label="delegate" options={DELEGATES} value={delegate} onChange={setDelegate} />
          <Segmented label="targetFps" options={FPS} value={targetFps} onChange={setTargetFps} />
          <Segmented
            label="resolution"
            options={RESOLUTIONS}
            value={resolution}
            onChange={setResolution}
          />
          <Segmented
            label="analysisResolution"
            options={ANALYSIS}
            value={analysis}
            onChange={setAnalysis}
          />
          <Segmented
            label="thermalPolicy"
            options={THERMAL}
            value={thermalPolicy}
            onChange={setThermalPolicy}
          />
        </Panel>

        <Panel title="Camera">
          <Segmented label="facing" options={FACINGS} value={facing} onChange={setFacing} />
          <Stepper
            label="maxPoses"
            value={maxPoses}
            step={1}
            min={1}
            max={5}
            onChange={setMaxPoses}
          />
          <View style={styles.row}>
            <Toggle label="active" on={active} onPress={() => setActive((v) => !v)} />
            <Toggle label="detection" on={detection} onPress={() => setDetection((v) => !v)} />
            <Button label="switchCamera()" onPress={() => void camera.current?.switchCamera()} />
          </View>
        </Panel>

        <Panel title="Smoothing">
          <Toggle label="smoothing" on={smoothing} onPress={() => setSmoothing((v) => !v)} />
          <Stepper
            label="minCutoff"
            value={minCutoff}
            step={0.1}
            min={0.1}
            max={5}
            decimals={2}
            onChange={setMinCutoff}
          />
          <Stepper
            label="beta"
            value={beta}
            step={0.005}
            min={0}
            max={0.2}
            decimals={3}
            onChange={setBeta}
          />
        </Panel>

        <Panel title="Overlay">
          <View style={styles.row}>
            <Toggle label="overlay" on={overlayOn} onPress={() => setOverlayOn((v) => !v)} />
            <Toggle label="landmarks" on={landmarks} onPress={() => setLandmarks((v) => !v)} />
            <Toggle
              label="connections"
              on={connections}
              onPress={() => setConnections((v) => !v)}
            />
          </View>
          <Segmented label="color" options={COLORS} value={color} onChange={setColor} />
          <Stepper
            label="lineWidth"
            value={lineWidth}
            step={1}
            min={1}
            max={12}
            onChange={setLineWidth}
          />
          <Stepper
            label="pointRadius"
            value={pointRadius}
            step={1}
            min={1}
            max={14}
            onChange={setPointRadius}
          />
          <Stepper
            label="minVisibility"
            value={minVisibility}
            step={0.05}
            min={0}
            max={1}
            decimals={2}
            onChange={setMinVisibility}
          />
          <Chips
            label={`only[] (${only.length === 0 ? 'all 33' : only.length})`}
            options={JOINT_NAMES}
            selected={only}
            onToggle={(joint) => setOnly(toggle(only, joint))}
          />
          <Chips
            label={`angles[] (${arcs.length})`}
            options={ANGLE_JOINT_NAMES}
            selected={arcs}
            onToggle={(joint) => setArcs(toggle(arcs, joint))}
          />
        </Panel>

        <Panel title="Data">
          <Segmented label="mode" options={DATA_MODES} value={mode} onChange={setMode} />
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
          <View style={styles.row}>
            <Toggle
              label="landmarks"
              on={wantLandmarks}
              onPress={() => setWantLandmarks((v) => !v)}
            />
            <Toggle
              label="worldLandmarks"
              on={worldLandmarks}
              onPress={() => setWorldLandmarks((v) => !v)}
            />
          </View>
          <Chips
            label={`angles[] (${dataAngles.length})`}
            options={ANGLE_JOINT_NAMES}
            selected={dataAngles}
            onToggle={(joint) => setDataAngles(toggle(dataAngles, joint))}
          />
          <Chips
            label={`select[] (${select.length === 0 ? 'all 33' : select.length})`}
            options={JOINT_NAMES}
            selected={select}
            onToggle={(joint) => setSelect(toggle(select, joint))}
          />
          <View style={styles.divider} />
          <Row label="frames delivered" value={String(frames)} />
          <Row label="frames dropped" value={String(dropped)} />
          <Button
            label="Reset counters"
            onPress={() => {
              setFrames(0);
              setDropped(0);
            }}
          />
        </Panel>

        <Panel title="Logging">
          <Segmented
            label="logLevel"
            options={LOG_LEVELS}
            value={logLevel}
            onChange={setLogLevel}
          />
          <Text style={styles.note}>
            The prop raises the level while this camera is mounted. Per-category levels and the
            stream itself are on the Console screen.
          </Text>
        </Panel>
      </ScrollView>
    </View>
  );
}

function Compare({
  label,
  requested,
  resolved,
}: {
  label: string;
  requested: string;
  resolved: string | number | null | undefined;
}) {
  const shown = resolved === null || resolved === undefined ? '-' : String(resolved);
  // Only flagged when something was actually asked for: `auto` resolving to a real value is the
  // system working, not a value being overridden.
  const overridden = requested !== 'auto' && shown !== '-' && shown !== requested;

  return (
    <View style={styles.compare}>
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={styles.requested}>{requested}</Text>
      <Text style={styles.arrow}>{'→'}</Text>
      <Text style={[styles.resolved, overridden && styles.overridden]}>{shown}</Text>
    </View>
  );
}

function toggle<T>(list: readonly T[], value: T): readonly T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

const styles = StyleSheet.create({
  arrow: { color: theme.muted, fontSize: 12 },
  compare: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  compareLabel: { color: theme.muted, flex: 1, fontSize: 13 },
  divider: { backgroundColor: theme.border, height: 1, marginVertical: 4 },
  list: { gap: 12, paddingBottom: 24 },
  note: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  overridden: { color: theme.accent },
  preview: { borderRadius: 16, height: 220, overflow: 'hidden' },
  requested: { color: theme.muted, fontSize: 12, minWidth: 64, textAlign: 'right' },
  resolved: { color: theme.text, fontSize: 12, fontWeight: '600', minWidth: 74 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  screen: { flex: 1, gap: 12 },
});
