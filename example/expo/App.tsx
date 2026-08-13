import * as React from 'react';
import { Modal, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NavBar, type TabId } from './src/components/NavBar';
import { DiagnosticsScreen } from './src/screens/DiagnosticsScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LiveScreen } from './src/screens/LiveScreen';
import { UploadScreen } from './src/screens/UploadScreen';
import { theme } from './src/theme';

/**
 * Three screens and a floating bar.
 *
 * This file is deliberately identical to the bare app's. The two are kept as separate copies rather
 * than sharing a directory, because the point of having both is that each proves its own install
 * path end to end: a shared source tree would mean one app's build proving very little about the
 * other's. When one changes, copy it across.
 *
 * The camera is mounted only while its tab is selected, so leaving the tab genuinely releases it
 * rather than leaving it running behind a screen nobody is looking at. On that tab the bar is
 * hidden and the screen's own close button takes over, because the camera is the one thing here
 * that deserves the whole display.
 */
export default function App() {
  const [tab, setTab] = React.useState<TabId>('home');
  const [diagnostics, setDiagnostics] = React.useState(false);
  const live = tab === 'live';

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        {/* Dark glyphs on the light screens, light ones over the camera. */}
        <StatusBar
          barStyle={live ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent
        />

        {tab === 'home' ? (
          <HomeScreen onNavigate={setTab} onDiagnostics={() => setDiagnostics(true)} />
        ) : null}
        {live ? <LiveScreen onClose={() => setTab('home')} /> : null}
        {tab === 'upload' ? <UploadScreen /> : null}

        {live ? null : <NavBar active={tab} onSelect={setTab} />}

        <Modal visible={diagnostics} animationType="slide" presentationStyle="fullScreen">
          <SafeAreaProvider>
            <View style={styles.root}>
              <DiagnosticsScreen onClose={() => setDiagnostics(false)} />
            </View>
          </SafeAreaProvider>
        </Modal>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.background,
  },
});
