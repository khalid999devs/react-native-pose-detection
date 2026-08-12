import * as React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Panel } from '../components';
import { PENDING_SCREENS } from './registry';
import { theme } from '../theme';

export function AboutScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Panel title="What works">
        <Text style={styles.body}>
          Camera preview, on-device pose detection, and the native skeleton overlay, on Android. The
          GPU delegate is probed with a real inference before it is trusted, and falls back to CPU
          when that probe fails.
        </Text>
      </Panel>

      <Panel title="What is missing">
        <Text style={styles.body}>
          Frames do not reach JavaScript yet. The native ring buffer, the trigger evaluator,
          calibration, and the thermal ladder are unbuilt, so these screens are not here yet:
        </Text>
        {PENDING_SCREENS.map((screen) => (
          <Text key={screen.title} style={styles.pending}>
            {screen.title}
            <Text style={styles.needs}>{`  needs ${screen.needs}`}</Text>
          </Text>
        ))}
      </Panel>

      <Panel title="iOS">
        <Text style={styles.body}>
          Not started. There is no Swift source and no podspec, so this app builds for Android only.
        </Text>
      </Panel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { color: theme.text, fontSize: 14, lineHeight: 21 },
  content: { gap: 12, paddingBottom: 24 },
  needs: { color: theme.muted, fontSize: 12, fontWeight: '400' },
  pending: { color: theme.text, fontSize: 13, fontWeight: '600' },
});
