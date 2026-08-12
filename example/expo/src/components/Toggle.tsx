import * as React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '../theme';

export function Toggle({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.button, on && styles.on]} onPress={onPress}>
      <Text style={[styles.text, on && styles.textOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  on: { backgroundColor: theme.accent, borderColor: theme.accent },
  text: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  textOn: { color: '#04121f' },
});
