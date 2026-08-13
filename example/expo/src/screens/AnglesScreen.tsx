import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ANGLE_JOINT_NAMES, PoseCamera } from 'react-native-pose-detection';
import type { AngleJointName, PoseFrame } from 'react-native-pose-detection';

import { CameraGate, Chips, Panel, Stepper, Toggle } from '../components';
import { theme } from '../theme';

const DEFAULT: readonly AngleJointName[] = ['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee'];

/**
 * The arcs are drawn natively and the numbers below them arrive over the frame path, which is why
 * both are here: they are two different code paths reading one measurement, and they should agree.
 */
export function AnglesScreen() {
  const [joints, setJoints] = React.useState<readonly AngleJointName[]>(DEFAULT);
  const [label, setLabel] = React.useState(true);
  const [radius, setRadius] = React.useState(40);
  const [decimals, setDecimals] = React.useState(0);
  const [minVisibility, setMinVisibility] = React.useState(0.5);

  const [angles, setAngles] = React.useState<Partial<Record<AngleJointName, number>>>({});

  const overlay = React.useMemo(
    () => ({
      connections: true,
      angles: joints.map((joint) => ({ joint, label, radius, decimals, minVisibility })),
    }),
    [joints, label, radius, decimals, minVisibility],
  );

  // `data.angles` is not set: naming a joint under `overlay.angles` already turns its computation
  // on, and the frame carries whatever was computed. That is the lazy path working.
  const data = React.useMemo(() => ({ mode: 'throttled' as const, throttleMs: 100 }), []);

  const onPose = React.useCallback((frame: PoseFrame) => {
    setAngles(frame.angles ?? {});
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <CameraGate>
          <PoseCamera
            style={StyleSheet.absoluteFill}
            overlay={overlay}
            data={data}
            onPose={onPose}
          />
        </CameraGate>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Panel title="Measured">
          {joints.length === 0 ? (
            <Text style={styles.note}>Pick a joint below.</Text>
          ) : (
            <View style={styles.readouts}>
              {joints.map((joint) => {
                const value = angles[joint];
                return (
                  <View key={joint} style={styles.readout}>
                    <Text style={styles.joint}>{joint}</Text>
                    <Text style={styles.degrees}>
                      {value === undefined || Number.isNaN(value)
                        ? '--'
                        : `${value.toFixed(decimals)}°`}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
          <Text style={styles.note}>
            A dash is NaN, which is what an angle reads when the joint is not tracked well enough to
            measure. Zero would be a straight answer to a question nobody could answer.
          </Text>
        </Panel>

        <Panel title="Joints">
          <Chips
            options={ANGLE_JOINT_NAMES}
            selected={joints}
            onToggle={(joint) =>
              setJoints(
                joints.includes(joint)
                  ? joints.filter((name) => name !== joint)
                  : [...joints, joint],
              )
            }
          />
          <Text style={styles.note}>
            Twelve of the thirty-three joints have an angle: the ones where two limb segments meet.
            A wrist has nothing on the far side of it to measure against.
          </Text>
        </Panel>

        <Panel title="Arc">
          <Toggle label="label" on={label} onPress={() => setLabel((v) => !v)} />
          <Stepper label="radius" value={radius} step={4} min={12} max={100} onChange={setRadius} />
          <Stepper
            label="decimals"
            value={decimals}
            step={1}
            min={0}
            max={3}
            onChange={setDecimals}
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
        </Panel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  degrees: { color: theme.text, fontSize: 20, fontVariant: ['tabular-nums'], fontWeight: '700' },
  joint: { color: theme.muted, fontSize: 11 },
  list: { gap: 12, paddingBottom: 24 },
  note: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  preview: { borderRadius: 16, height: 260, overflow: 'hidden' },
  readout: {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: 96,
    flexGrow: 1,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  readouts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  screen: { flex: 1, gap: 12 },
});
