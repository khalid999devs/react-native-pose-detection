import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '../theme';

export function Button({
  label,
  onPress,
  tone = 'normal',
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'normal' | 'primary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || busy;

  return (
    <Pressable
      style={[
        styles.button,
        tone === 'primary' && styles.primary,
        tone === 'danger' && styles.danger,
        off && styles.off,
      ]}
      onPress={onPress}
      disabled={off}
    >
      {busy ? <ActivityIndicator color={theme.muted} size="small" /> : null}
      <Text style={[styles.text, tone === 'primary' && styles.textPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  danger: { borderColor: theme.danger },
  off: { opacity: 0.45 },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  text: { color: theme.text, fontSize: 13, fontWeight: '600' },
  textPrimary: { color: '#04121f' },
});
