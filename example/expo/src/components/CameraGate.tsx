import * as React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCameraPermission } from 'react-native-pose-detection';

import { theme } from '../theme';

const EXPLANATION = {
  undetermined: 'Asking for the camera.',
  granted: '',
  denied: 'Camera permission denied.',
  blocked: 'Camera permission is blocked. Android will not ask again.',
} as const;

/** Renders the preview once the camera is granted, and the reason it is not otherwise. */
export function CameraGate({ children }: { children: React.ReactNode }) {
  const { status, granted, canAskAgain, pending, request, error } = useCameraPermission();

  if (granted) return <View style={styles.preview}>{children}</View>;

  return (
    <View style={styles.preview}>
      <View style={styles.gate}>
        <Text style={styles.text}>{error ? error.message : EXPLANATION[status]}</Text>

        {!pending && !error ? (
          <Pressable
            style={styles.button}
            onPress={canAskAgain ? request : () => void Linking.openSettings()}
          >
            <Text style={styles.buttonText}>{canAskAgain ? 'Ask again' : 'Open settings'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  buttonText: { color: '#04121f', fontWeight: '700' },
  gate: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  preview: { backgroundColor: '#000', borderRadius: 16, flex: 1, overflow: 'hidden' },
  text: { color: theme.muted, fontSize: 14, textAlign: 'center' },
});
