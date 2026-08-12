import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PoseCamera } from 'react-native-pose-detection';
import type { AngleJointName, JointName, OverlayConfig } from 'react-native-pose-detection';

import { Panel, Toggle } from '../components';
import { theme } from '../theme';

const UPPER_BODY: readonly JointName[] = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
];

const ARCS: readonly AngleJointName[] = ['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee'];

export function OverlayScreen() {
  const [connections, setConnections] = React.useState(true);
  const [thick, setThick] = React.useState(false);
  const [upperOnly, setUpperOnly] = React.useState(false);
  const [angles, setAngles] = React.useState(false);

  // Rebuilt only when a switch moves, so the native view is not handed a new object per render.
  const overlay = React.useMemo<OverlayConfig>(
    () => ({
      landmarks: true,
      connections,
      color: '#4da3ff',
      lineWidth: thick ? 6 : 3,
      pointRadius: thick ? 7 : 4,
      ...(upperOnly ? { only: UPPER_BODY } : {}),
      ...(angles
        ? { angles: ARCS.map((joint) => ({ joint, label: true, radius: 44, decimals: 0 })) }
        : {}),
    }),
    [connections, thick, upperOnly, angles],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <PoseCamera style={StyleSheet.absoluteFill} overlay={overlay} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Toggle label="Connections" on={connections} onPress={() => setConnections((v) => !v)} />
        <Toggle label="Thick" on={thick} onPress={() => setThick((v) => !v)} />
        <Toggle label="Upper body" on={upperOnly} onPress={() => setUpperOnly((v) => !v)} />
        <Toggle label="Angle arcs" on={angles} onPress={() => setAngles((v) => !v)} />
      </ScrollView>

      <Panel title="Note">
        <Text style={styles.note}>
          Everything here is drawn natively. The arcs are computed on the native side too, which is
          why they work before frame delivery to JavaScript exists.
        </Text>
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  preview: { backgroundColor: '#000', borderRadius: 16, flex: 1, overflow: 'hidden' },
  row: { gap: 10, paddingRight: 10 },
  screen: { flex: 1, gap: 12 },
});
