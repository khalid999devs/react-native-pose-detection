import { BlurView } from 'expo-blur';
import * as React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { theme } from '../theme';

type Props = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Rounded corners have to be on the blur itself, or it bleeds past them on Android. */
  radius?: number;
  intensity?: number;
};

/**
 * A translucent panel for the camera screen.
 *
 * Blur alone will not keep dark text readable over a bright frame, so every panel also carries a
 * near-white scrim and a hairline edge: the blur gives depth, the scrim gives contrast, and the
 * edge is what stops the panel dissolving into a pale background. The scrim is the blur's own
 * background rather than a child, because on Android an absolutely positioned child is laid out in
 * the padded content box and draws a square slab inside the rounded card.
 *
 * **Android gets no blur.** Its only real implementation needs a `blurTarget` ref to the view being
 * blurred, which cannot work here: these panels sit over a camera preview, which is a surface the
 * view hierarchy cannot sample. Asking for it anyway logs a warning on every mount and then falls
 * back to nothing, so the fallback is chosen deliberately instead, and the scrim is made opaque
 * enough to carry the panel on its own.
 */
export function Glass({ children, style, radius = theme.radius.lg, intensity = 40 }: Props) {
  if (Platform.OS !== 'ios') {
    return (
      <View style={[styles.blur, styles.solid, { borderRadius: radius }, style]}>{children}</View>
    );
  }
  return (
    <BlurView
      intensity={intensity}
      tint="light"
      style={[styles.blur, { borderRadius: radius }, style]}
    >
      {children}
    </BlurView>
  );
}

/** The same shape without the blur, for panels that sit on the page rather than over the camera. */
export function Card({ children, style, radius = theme.radius.md }: Props) {
  return <View style={[styles.card, { borderRadius: radius }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  blur: {
    backgroundColor: theme.color.scrim,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(12,13,15,0.10)',
    overflow: 'hidden',
    ...theme.lift,
  },
  solid: {
    backgroundColor: theme.color.scrimSolid,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
});
