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

import { Panel } from './src/components';
import { AboutScreen } from './src/screens/AboutScreen';
import { BasicScreen } from './src/screens/BasicScreen';
import { OverlayScreen } from './src/screens/OverlayScreen';
import { PENDING_SCREENS, SCREENS } from './src/screens/registry';
import type { ScreenId } from './src/screens/registry';
import { theme } from './src/theme';

export default function App() {
  const [screen, setScreen] = React.useState<ScreenId>('home');

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        {screen === 'home' ? (
          <Text style={styles.heading}>Pose Detection</Text>
        ) : (
          <Pressable onPress={() => setScreen('home')} hitSlop={12}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.body}>
        {screen === 'home' ? <Home onOpen={setScreen} /> : null}
        {screen === 'basic' ? <BasicScreen /> : null}
        {screen === 'overlay' ? <OverlayScreen /> : null}
        {screen === 'about' ? <AboutScreen /> : null}
      </View>
    </SafeAreaView>
  );
}

function Home({ onOpen }: { onOpen: (id: ScreenId) => void }) {
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {SCREENS.map((entry) => (
        <Pressable key={entry.id} style={styles.card} onPress={() => onOpen(entry.id)}>
          <Text style={styles.cardTitle}>{entry.title}</Text>
          <Text style={styles.cardBlurb}>{entry.blurb}</Text>
        </Pressable>
      ))}

      <Panel title={`Not built yet (${PENDING_SCREENS.length})`}>
        <Text style={styles.pendingBody}>
          These screens are in the plan and are waiting on the native engine. See About.
        </Text>
      </Panel>
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
  heading: { color: theme.text, fontSize: 24, fontWeight: '800' },
  list: { gap: 12, paddingBottom: 24 },
  pendingBody: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  root: { backgroundColor: theme.bg, flex: 1 },
});
