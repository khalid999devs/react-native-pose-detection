import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import icon from '../../assets/icon.png';
import { Card } from '../components/Glass';
import { theme } from '../theme';
import type { IconName } from '../components/Controls';

// Read off the package rather than restated here, so the screen cannot claim a version the app is
// not actually running. `./package.json` is a declared entry point, so this resolves in Metro.
import { version } from 'react-native-pose-detection/package.json';

const REPOSITORY = 'https://github.com/khalid999devs/react-native-pose-detection';

const NOTES: { version: string; lines: string[] }[] = [
  {
    version: 'Unreleased',
    lines: [
      'exportPose paints a picked photo or clip into a file your app owns',
      'The overlay is drawn by one renderer, so exports and the preview agree',
      'CPU inference in simulators, where MediaPipe’s Metal path aborts',
    ],
  },
];

const CREDITS: { icon: IconName; label: string; value: string }[] = [
  { icon: 'cube-outline', label: 'Detection', value: 'MediaPipe Tasks Vision' },
  { icon: 'logo-apple', label: 'iOS', value: 'AVFoundation, Core Graphics' },
  { icon: 'logo-android', label: 'Android', value: 'CameraX, Canvas, MediaCodec' },
];

export function AboutScreen({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top + theme.space(3) }]}>
      <View style={styles.head}>
        <Text style={styles.title}>About</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
          <Ionicons name="close" size={22} color={theme.color.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.space(8) }]}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.identity}>
          <Image source={icon} style={styles.mark} />
          <View style={styles.identityText}>
            <Text style={styles.name}>react-native-pose-detection</Text>
            <Text style={styles.version}>
              v{version} · {Platform.OS}
            </Text>
          </View>
        </Card>

        <Text style={styles.section}>Release notes</Text>
        {NOTES.map((note) => (
          <Card key={note.version} style={styles.note}>
            <Text style={styles.noteVersion}>{note.version}</Text>
            {note.lines.map((line) => (
              <View key={line} style={styles.bullet}>
                <View style={styles.dot} />
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}
          </Card>
        ))}

        <Text style={styles.section}>Built on</Text>
        <Card>
          {CREDITS.map((credit, index) => (
            <View key={credit.label} style={[styles.row, index > 0 && styles.rowDivided]}>
              <Ionicons name={credit.icon} size={17} color={theme.color.faint} />
              <Text style={styles.rowLabel}>{credit.label}</Text>
              <Text style={styles.rowValue}>{credit.value}</Text>
            </View>
          ))}
        </Card>

        <Pressable
          onPress={() => void Linking.openURL(REPOSITORY)}
          accessibilityRole="link"
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Ionicons name="logo-github" size={17} color={theme.color.text} />
          <Text style={styles.linkText}>Source, issues and contributors</Text>
          <Ionicons name="open-outline" size={15} color={theme.color.faint} />
        </Pressable>

        <Text style={styles.license}>MIT licensed. Detection runs entirely on this device.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.background,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space(5),
    paddingBottom: theme.space(3),
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.display,
    fontWeight: '700',
    letterSpacing: -1,
  },
  content: {
    paddingHorizontal: theme.space(5),
    gap: theme.space(3),
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3.5),
    padding: theme.space(4),
  },
  mark: {
    width: 38,
    height: 38,
    borderRadius: 12,
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: theme.color.text,
    fontSize: theme.font.label,
    fontWeight: '700',
  },
  version: {
    color: theme.color.muted,
    fontSize: theme.font.tiny,
  },
  section: {
    color: theme.color.faint,
    fontSize: theme.font.tiny,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingTop: theme.space(3),
  },
  note: {
    padding: theme.space(4),
    gap: theme.space(2.5),
  },
  noteVersion: {
    color: theme.color.accent,
    fontSize: theme.font.label,
    fontWeight: '700',
  },
  bullet: {
    flexDirection: 'row',
    gap: theme.space(2.5),
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 7,
    backgroundColor: theme.color.faint,
  },
  bulletText: {
    flex: 1,
    color: theme.color.muted,
    fontSize: theme.font.label,
    lineHeight: theme.font.label * 1.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3.5),
    paddingHorizontal: theme.space(4),
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
  },
  rowLabel: {
    flex: 1,
    color: theme.color.muted,
    fontSize: theme.font.label,
  },
  rowValue: {
    color: theme.color.text,
    fontSize: theme.font.label,
    fontWeight: '600',
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    padding: theme.space(4),
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    marginTop: theme.space(3),
  },
  pressed: {
    opacity: 0.6,
  },
  linkText: {
    flex: 1,
    color: theme.color.text,
    fontSize: theme.font.label,
    fontWeight: '600',
  },
  license: {
    color: theme.color.faint,
    fontSize: theme.font.tiny,
    textAlign: 'center',
    paddingTop: theme.space(2),
  },
});
