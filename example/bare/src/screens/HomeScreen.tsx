import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import icon from '../../assets/icon.png';
import { Card } from '../components/Glass';
import { NAV_CLEARANCE } from '../components/NavBar';
import type { TabId } from '../components/NavBar';
import type { IconName } from '../components/Controls';
import { theme } from '../theme';

const SPECS: { icon: IconName; label: string; value: string }[] = [
  { icon: 'body-outline', label: 'Landmarks', value: '33' },
  { icon: 'speedometer-outline', label: 'Target', value: '30 fps' },
  { icon: 'cube-outline', label: 'Dependencies', value: '0' },
  { icon: 'hardware-chip-outline', label: 'Inference', value: 'On device' },
];

export function HomeScreen({
  onNavigate,
  onDiagnostics,
  onAbout,
}: {
  onNavigate: (tab: TabId) => void;
  onDiagnostics: () => void;
  onAbout: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.space(5) }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.brand}>
        <Image source={icon} style={styles.mark} />
        <Text style={styles.brandText}>Pose Detection</Text>
        <Pressable
          onPress={onAbout}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="About this package"
        >
          <Ionicons name="information-circle-outline" size={22} color={theme.color.muted} />
        </Pressable>
      </View>

      <View style={styles.head}>
        <Text style={styles.display}>Pose detection, drawn natively.</Text>
        <Text style={styles.lede}>
          Thirty three body landmarks a frame, painted on the preview by the native layer.
        </Text>
      </View>

      <View style={styles.actions}>
        <Action
          icon="camera-outline"
          title="Capture"
          caption="Detect from the live camera"
          primary
          onPress={() => onNavigate('live')}
        />
        <Action
          icon="color-wand-outline"
          title="Studio"
          caption="Paint a photo or a clip"
          onPress={() => onNavigate('upload')}
        />
      </View>

      <Card style={styles.specs}>
        {SPECS.map((spec, index) => (
          <View key={spec.label} style={[styles.spec, index > 0 && styles.specDivided]}>
            <Ionicons name={spec.icon} size={17} color={theme.color.faint} />
            <Text style={styles.specLabel}>{spec.label}</Text>
            <Text style={styles.specValue}>{spec.value}</Text>
          </View>
        ))}
      </Card>

      <View style={styles.footer}>
        <Text style={styles.platform}>{Platform.OS === 'ios' ? 'iOS' : 'Android'}</Text>
        <Pressable onPress={onDiagnostics} hitSlop={12} accessibilityRole="button">
          <Text style={styles.diagnostics}>Diagnostics</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Action({
  icon,
  title,
  caption,
  primary,
  onPress,
}: {
  icon: IconName;
  title: string;
  caption: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.actionIcon, primary && styles.actionIconPrimary]}>
        <Ionicons
          name={icon}
          size={20}
          color={primary ? theme.color.background : theme.color.accent}
        />
      </View>
      <View style={styles.actionText}>
        <Text style={[styles.actionTitle, primary && styles.onDark]}>{title}</Text>
        <Text style={[styles.actionCaption, primary && styles.onDarkMuted]}>{caption}</Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={17}
        color={primary ? 'rgba(255,255,255,0.5)' : theme.color.faint}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(6),
    paddingBottom: NAV_CLEARANCE + theme.space(4),
    gap: theme.space(7),
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2.5),
  },
  mark: {
    width: 26,
    height: 26,
    borderRadius: 8,
  },
  brandText: {
    flex: 1,
    color: theme.color.text,
    fontSize: theme.font.label,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  display: {
    color: theme.color.text,
    fontSize: theme.font.display,
    lineHeight: theme.font.display * 1.18,
    fontWeight: '700',
    letterSpacing: -1,
  },
  head: {
    gap: theme.space(2.5),
  },
  lede: {
    color: theme.color.muted,
    fontSize: theme.font.body,
    lineHeight: theme.font.body * 1.5,
  },
  actions: {
    gap: theme.space(3),
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3.5),
    padding: theme.space(4),
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.accentSoft,
  },
  actionIconPrimary: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  actionText: {
    flex: 1,
  },
  actionPrimary: {
    backgroundColor: theme.color.text,
    borderColor: theme.color.text,
  },
  pressed: {
    opacity: 0.6,
  },
  actionTitle: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '700',
  },
  actionCaption: {
    color: theme.color.muted,
    fontSize: theme.font.tiny,
    marginTop: 2,
  },
  onDark: {
    color: theme.color.background,
  },
  onDarkMuted: {
    color: 'rgba(255,255,255,0.55)',
  },
  specs: {
    paddingHorizontal: theme.space(4.5),
  },
  spec: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3.5),
  },
  specDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
  },
  specLabel: {
    flex: 1,
    color: theme.color.muted,
    fontSize: theme.font.label,
  },
  specValue: {
    color: theme.color.text,
    fontSize: theme.font.label,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  platform: {
    color: theme.color.faint,
    fontSize: theme.font.tiny,
    letterSpacing: 0.4,
  },
  diagnostics: {
    color: theme.color.faint,
    fontSize: theme.font.tiny,
    letterSpacing: 0.4,
  },
});
