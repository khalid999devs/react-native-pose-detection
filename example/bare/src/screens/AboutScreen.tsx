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

const FEATURES: { icon: IconName; title: string; detail: string }[] = [
  {
    icon: 'body-outline',
    title: '33 landmarks, live',
    detail: 'Full BlazePose skeleton with world coordinates, angles and visibility, on device.',
  },
  {
    icon: 'speedometer-outline',
    title: 'Adaptive by default',
    detail:
      'Frame rate, resolution and delegate resolve from the device, then calibrate as it runs.',
  },
  {
    icon: 'flash-outline',
    title: 'Frames without bridge cost',
    detail: 'One shared buffer, drained on demand, so a live stream does not serialize per frame.',
  },
  {
    icon: 'notifications-outline',
    title: 'Triggers',
    detail: 'Angle, position and velocity conditions evaluated natively, delivered as events.',
  },
  {
    icon: 'images-outline',
    title: 'Photos and clips',
    detail: 'Detect over a picked file, or export one with the skeleton painted into it.',
  },
  {
    icon: 'thermometer-outline',
    title: 'Thermal aware',
    detail: 'Throttles itself as the device heats, and releases the model when backgrounded.',
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

        <Text style={styles.section}>What it does</Text>
        <Card>
          {FEATURES.map((feature, index) => (
            <View key={feature.title} style={[styles.feature, index > 0 && styles.rowDivided]}>
              <View style={styles.featureIcon}>
                <Ionicons name={feature.icon} size={16} color={theme.color.accent} />
              </View>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDetail}>{feature.detail}</Text>
              </View>
            </View>
          ))}
        </Card>

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
  feature: {
    flexDirection: 'row',
    gap: theme.space(3),
    paddingVertical: theme.space(3.5),
    paddingHorizontal: theme.space(4),
  },
  featureIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.accentSoft,
  },
  featureText: {
    flex: 1,
    gap: 3,
  },
  featureTitle: {
    color: theme.color.text,
    fontSize: theme.font.label,
    fontWeight: '600',
  },
  featureDetail: {
    color: theme.color.muted,
    fontSize: theme.font.tiny,
    lineHeight: theme.font.tiny * 1.5,
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
