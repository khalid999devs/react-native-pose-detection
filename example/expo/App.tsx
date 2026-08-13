import * as React from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Panel, Row } from './src/components';
import { lastSession } from './src/lastSession';
import { AboutScreen } from './src/screens/AboutScreen';
import { AnglesScreen } from './src/screens/AnglesScreen';
import { BasicScreen } from './src/screens/BasicScreen';
import { ConsoleScreen } from './src/screens/ConsoleScreen';
import { DataModesScreen } from './src/screens/DataModesScreen';
import { OverlayScreen } from './src/screens/OverlayScreen';
import { PerformanceScreen } from './src/screens/PerformanceScreen';
import { PlaygroundScreen } from './src/screens/PlaygroundScreen';
import { RecipesScreen } from './src/screens/RecipesScreen';
import { ScenariosScreen } from './src/screens/ScenariosScreen';
import { StaticInputScreen } from './src/screens/StaticInputScreen';
import { TriggersScreen } from './src/screens/TriggersScreen';
import { SCREENS } from './src/screens/registry';
import type { ScreenId } from './src/screens/registry';
import { theme } from './src/theme';

const SCREEN: Record<Exclude<ScreenId, 'home'>, () => React.JSX.Element> = {
  about: AboutScreen,
  angles: AnglesScreen,
  basic: BasicScreen,
  console: ConsoleScreen,
  data: DataModesScreen,
  overlay: OverlayScreen,
  performance: PerformanceScreen,
  playground: PlaygroundScreen,
  recipes: RecipesScreen,
  scenarios: ScenariosScreen,
  static: StaticInputScreen,
  triggers: TriggersScreen,
};

export default function App() {
  const [screen, setScreen] = React.useState<ScreenId>('home');

  const title = SCREENS.find((entry) => entry.id === screen)?.title;
  // Keyed so leaving a screen unmounts its camera rather than leaving a session running behind
  // the menu, which is also what makes the back button a teardown worth watching in the profiler.
  const Current = screen === 'home' ? null : SCREEN[screen];

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        {screen === 'home' ? (
          <Text style={styles.heading}>Pose Detection</Text>
        ) : (
          <View style={styles.headerRow}>
            <Pressable onPress={() => setScreen('home')} hitSlop={12}>
              <Text style={styles.back}>Back</Text>
            </Pressable>
            <Text style={styles.title}>{title}</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        {Current ? <Current key={screen} /> : <Home onOpen={setScreen} />}
      </View>
    </SafeAreaView>
  );
}

function Home({ onOpen }: { onOpen: (id: ScreenId) => void }) {
  const { ready, profile } = lastSession();

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Panel title="Device">
        {ready ? (
          <>
            <Row label="model" value={ready.model} />
            <Row label="tier" value={ready.deviceTier} />
            <Row label="delegate" value={`${ready.delegate} (asked ${ready.delegateRequested})`} />
            <Row
              label="profile"
              value={profile ? `${profile.profile} · ${profile.phase} · ${profile.source}` : '-'}
            />
            <Row
              label="p50 inference"
              value={profile ? `${profile.p50InferenceMs.toFixed(1)} ms` : '-'}
            />
          </>
        ) : (
          <Text style={styles.pending}>
            Nothing yet. Open Basic once and this fills in from that session.
          </Text>
        )}
      </Panel>

      {SCREENS.map((entry) => (
        <Pressable key={entry.id} style={styles.card} onPress={() => onOpen(entry.id)}>
          <Text style={styles.cardTitle}>{entry.title}</Text>
          <Text style={styles.cardBlurb}>{entry.blurb}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  back: { color: theme.accent, fontSize: 16, fontWeight: '600' },
  body: { flex: 1, paddingBottom: 16, paddingHorizontal: 16 },
  card: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 16,
  },
  cardBlurb: { color: theme.muted, fontSize: 13 },
  cardTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
  header: { paddingHorizontal: 16, paddingVertical: 14 },
  headerRow: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  heading: { color: theme.text, fontSize: 24, fontWeight: '800' },
  list: { gap: 12, paddingBottom: 24 },
  pending: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  root: { backgroundColor: theme.bg, flex: 1 },
  title: { color: theme.text, fontSize: 18, fontWeight: '700' },
});
