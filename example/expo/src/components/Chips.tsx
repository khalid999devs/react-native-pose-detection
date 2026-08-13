import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

/** Many-of-N, wrapping. Used for joint subsets, which run to 33 options. */
export function Chips<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label?: string;
  options: readonly T[];
  selected: readonly T[];
  onToggle: (option: T) => void;
}) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <Pressable
              key={option}
              style={[styles.chip, on && styles.on]}
              onPress={() => onToggle(option)}
            >
              <Text style={[styles.text, on && styles.textOn]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  label: { color: theme.muted, fontSize: 12 },
  on: { backgroundColor: theme.accent, borderColor: theme.accent },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  text: { color: theme.muted, fontSize: 11, fontWeight: '600' },
  textOn: { color: '#04121f' },
  wrap: { gap: 6 },
});
