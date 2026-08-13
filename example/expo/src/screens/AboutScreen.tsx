import * as React from 'react';
import { Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { Panel, Row } from '../components';
import { theme } from '../theme';

export function AboutScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Panel title="What this is">
        <Text style={styles.body}>
          The reference implementation for react-native-pose-detection, and the manual QA harness
          for it. Every prop, event and ref method has a control somewhere in here, which is the
          rule: a feature with no way to exercise it is a feature nobody will find.
        </Text>
      </Panel>

      <Panel title="Build">
        <Row label="platform" value={`${Platform.OS} ${String(Platform.Version)}`} />
        <Row label="install path" value="config plugin" />
        <Row label="model" value="full, copied at prebuild" />
      </Panel>

      <Panel title="What has not happened">
        <Text style={styles.body}>
          Nothing in this package has run on a physical device. Both native sides compile, both test
          suites pass, and both install paths produce an app, but every number in the performance
          guide is still a target rather than a measurement.
        </Text>
        <Text style={styles.body}>
          The Scenarios screen is what makes that testable: it drives the camera switches, remounts
          and toggles that have historically broken this kind of package, and it is meant to be run
          with a profiler attached.
        </Text>
      </Panel>

      <Panel title="iOS">
        <Text style={styles.body}>
          Swift on AVFoundation, mirroring the Kotlin package for package. Rotation is applied by
          the capture connection rather than passed to MediaPipe, mirroring belongs to the preview
          alone, and the session runs on its own serial queue. The differences from Android are
          listed in docs/native-modules.md rather than left to be discovered.
        </Text>
      </Panel>

      <Panel title="Primitives, not policy">
        <Text style={styles.body}>
          There is no rep counter in the package. The Recipes screen builds four of them out of
          angles, velocities and a state machine, and every one of them is a snippet copied from
          guides/recipes/ rather than an API. A squat threshold that suits a gym app is wrong for a
          physiotherapy one, and that judgment belongs to the app.
        </Text>
      </Panel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { color: theme.text, fontSize: 14, lineHeight: 21 },
  content: { gap: 12, paddingBottom: 24 },
});
