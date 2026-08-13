/**
 * One palette, one scale.
 *
 * Light by default, with a single accent taken from the cyan the package paints with, darkened
 * enough to hold contrast on white. Everything else is neutral: on a screen whose subject is a
 * camera frame or a painted photo, the interface should be the quietest thing on it.
 */
export const theme = {
  color: {
    /** A tinted page with white cards on it, rather than white on white: depth without shadow. */
    background: '#F4F6F8',
    surface: '#FFFFFF',
    surfaceSunken: '#E9EDF1',
    border: '#DDE2E8',
    borderStrong: '#C6CDD6',

    text: '#0B1220',
    muted: '#5A6472',
    faint: '#8B95A3',

    accent: '#0B7C93',
    accentSoft: '#DBF1F6',
    /** What the overlay paints with. Vivid, because it sits on video rather than on paper. */
    overlay: '#00E5FF',

    danger: '#D93A4B',
    good: '#12925A',

    /** Behind glass over the camera, so a control stays readable on a bright frame. */
    scrim: 'rgba(255,255,255,0.72)',
  },

  space: (steps: number) => steps * 4,

  radius: {
    sm: 12,
    md: 18,
    lg: 26,
    pill: 999,
  },

  font: {
    display: 32,
    title: 19,
    body: 15,
    label: 13,
    tiny: 11,
  },

  /** One soft shadow, used only where an element genuinely floats. */
  lift: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
} as const;
