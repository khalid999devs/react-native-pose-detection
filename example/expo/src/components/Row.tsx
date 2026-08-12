import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: theme.muted, fontSize: 13 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  value: { color: theme.text, fontSize: 13, fontVariant: ['tabular-nums'] },
});
