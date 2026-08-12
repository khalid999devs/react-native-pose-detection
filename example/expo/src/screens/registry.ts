export type ScreenId = 'home' | 'basic' | 'overlay' | 'about';

export type ScreenEntry = {
  id: ScreenId;
  title: string;
  blurb: string;
  /** Screens the plan reserves but the engine cannot serve yet are listed, not hidden. */
  available: boolean;
};

export const SCREENS: readonly ScreenEntry[] = [
  {
    id: 'basic',
    title: 'Basic',
    blurb: 'Camera, detection, and the native skeleton overlay.',
    available: true,
  },
  {
    id: 'overlay',
    title: 'Overlay',
    blurb: 'Colors, line width, joint subset, and angle arcs.',
    available: true,
  },
  {
    id: 'about',
    title: 'About',
    blurb: 'What this build contains and what it does not.',
    available: true,
  },
];

export const PENDING_SCREENS: readonly { title: string; needs: string }[] = [
  { title: 'Playground', needs: 'profiles and calibration' },
  { title: 'Triggers', needs: 'the native trigger evaluator' },
  { title: 'Data modes', needs: 'the frame ring buffer' },
  { title: 'Performance', needs: 'the thermal ladder' },
  { title: 'Recipes', needs: 'frame delivery' },
  { title: 'Angles', needs: 'frame delivery' },
  { title: 'Static input', needs: 'detectOnImage and detectOnVideo' },
  { title: 'Console', needs: 'the native log stream' },
  { title: 'Scenarios', needs: 'the scenario harness' },
];
