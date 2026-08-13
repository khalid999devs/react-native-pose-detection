import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

/**
 * A stepper rather than a slider: React Native dropped `Slider` from core, and pulling in
 * `@react-native-community/slider` would add a native module to autolink in both example apps
 * to set numbers that mostly want exact values anyway.
 */
export function Stepper({
  label,
  value,
  step,
  min,
  max,
  decimals = 0,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  decimals?: number;
  suffix?: string;
  onChange: (next: number) => void;
}) {
  // Re-rounded because repeated float addition drifts: 0.1 + 0.2 lands at 0.30000000000000004,
  // and that reaches the native side as a prop.
  const clamp = (next: number) => Number(Math.min(max, Math.max(min, next)).toFixed(decimals + 2));

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.controls}>
        <Pressable
          style={[styles.button, value <= min && styles.disabled]}
          onPress={() => onChange(clamp(value - step))}
          hitSlop={6}
        >
          <Text style={styles.buttonText}>-</Text>
        </Pressable>

        <Text style={styles.value}>{`${value.toFixed(decimals)}${suffix}`}</Text>

        <Pressable
          style={[styles.button, value >= max && styles.disabled]}
          onPress={() => onChange(clamp(value + step))}
          hitSlop={6}
        >
          <Text style={styles.buttonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 32,
  },
  buttonText: { color: theme.text, fontSize: 16, fontWeight: '700', lineHeight: 18 },
  controls: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  disabled: { opacity: 0.35 },
  label: { color: theme.muted, flexShrink: 1, fontSize: 13 },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  value: {
    color: theme.text,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    minWidth: 56,
    textAlign: 'center',
  },
});
