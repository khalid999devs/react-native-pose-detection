import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportPose, type ExportResult } from 'react-native-pose-detection';

import { Card } from '../components/Glass';
import { NAV_CLEARANCE } from '../components/NavBar';
import { theme } from '../theme';

/**
 * Where painted files land.
 *
 * The package defaults to the cache directory, since an export is derived data. This app asks for
 * a directory of its own under Documents instead, which is the point being shown: what comes back
 * is an ordinary file in a place the app chose, so it can be listed, previewed, uploaded or deleted
 * with whatever the app already uses for files.
 */
const EXPORT_DIR = 'exported';
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v'];

const isVideo = (uri: string) => VIDEO_EXTENSIONS.some((ext) => uri.toLowerCase().endsWith(ext));

function exportDirectory(): Directory {
  const directory = new Directory(Paths.document, EXPORT_DIR);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

type Entry = { uri: string; name: string; size: number };

export function UploadScreen() {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [result, setResult] = React.useState<ExportResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const task = React.useRef<{ cancel: () => void } | null>(null);

  const refresh = React.useCallback(() => {
    try {
      setEntries(
        exportDirectory()
          .list()
          .filter((item): item is File => item instanceof File)
          .map((file) => ({ uri: file.uri, name: file.name, size: file.size ?? 0 }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (problem) {
      setError(String(problem));
    }
  }, []);

  React.useEffect(refresh, [refresh]);

  const pick = React.useCallback(async () => {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (picked.canceled || !picked.assets[0]) return;

    setBusy(true);
    setProgress(0);
    setResult(null);
    try {
      const running = exportPose(picked.assets[0].uri, {
        overlay: { color: theme.color.overlay, lineWidth: 3, pointRadius: 4 },
        directory: exportDirectory().uri,
        onProgress: setProgress,
      });
      task.current = running;
      setResult(await running.result);
    } catch (problem) {
      // A cancel rejects too, and reads better as a cleared screen than as a red message.
      const message = problem instanceof Error ? problem.message : String(problem);
      setError(message.toLowerCase().includes('cancel') ? null : message);
    } finally {
      task.current = null;
      setBusy(false);
      refresh();
    }
  }, [refresh]);

  const clear = React.useCallback(() => {
    try {
      for (const entry of entries) new File(entry.uri).delete();
    } catch (problem) {
      setError(String(problem));
    }
    setResult(null);
    refresh();
  }, [entries, refresh]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.space(5) }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.head}>
        <Text style={styles.title}>Studio</Text>
        <Text style={styles.subtitle}>Paint a photo or clip and keep the file.</Text>
      </View>

      <Pressable
        onPress={() => void pick()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Choose a photo or clip"
        style={({ pressed }) => [styles.drop, pressed && styles.pressed, busy && styles.dropBusy]}
      >
        <Ionicons
          name={busy ? 'hourglass-outline' : 'add'}
          size={24}
          color={busy ? theme.color.muted : theme.color.background}
        />
        <Text style={styles.dropLabel}>
          {busy ? `Painting ${Math.round(progress * 100)}%` : 'Choose a photo or clip'}
        </Text>
      </Pressable>

      {busy ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.max(3, Math.round(progress * 100))}%` }]} />
          <Pressable onPress={() => task.current?.cancel()} hitSlop={12} style={styles.stop}>
            <Text style={styles.stopLabel}>Stop</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Card style={styles.error}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.color.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </Card>
      ) : null}

      {result ? <Result result={result} /> : null}

      {!result && !busy && entries.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="images-outline" size={26} color={theme.color.faint} />
          <Text style={styles.emptyText}>
            Painted files land in this app&apos;s {EXPORT_DIR} folder
          </Text>
        </View>
      ) : null}

      {entries.length > 0 ? (
        <View style={styles.list}>
          <View style={styles.listHead}>
            <Text style={styles.listTitle}>{EXPORT_DIR}</Text>
            <Pressable onPress={clear} hitSlop={12} accessibilityRole="button">
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          </View>
          <Card>
            {entries.map((entry, index) => (
              <View key={entry.uri} style={[styles.row, index > 0 && styles.rowDivided]}>
                <Ionicons
                  name={isVideo(entry.uri) ? 'film-outline' : 'image-outline'}
                  size={17}
                  color={theme.color.faint}
                />
                <Text style={styles.rowName} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Text style={styles.rowSize}>{Math.max(1, Math.round(entry.size / 1024))} KB</Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Result({ result }: { result: ExportResult }) {
  return (
    <View style={styles.result}>
      {isVideo(result.uri) ? (
        <VideoPreview uri={result.uri} />
      ) : (
        <Image source={{ uri: result.uri }} style={styles.preview} resizeMode="cover" />
      )}
      <Card style={styles.resultStats}>
        <Metric label="Size" value={`${result.width}×${result.height}`} />
        <Metric label="Frames" value={String(result.frameCount)} />
        <Metric
          label="Poses"
          value={String(result.posesFound)}
          tone={result.posesFound > 0 ? 'good' : 'bad'}
        />
      </Card>
    </View>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        style={[
          styles.metricValue,
          tone === 'good' && { color: theme.color.good },
          tone === 'bad' && { color: theme.color.danger },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/** Its own component so the player hook only exists when the result actually is a video. */
function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });
  return <VideoView player={player} style={styles.preview} contentFit="cover" nativeControls />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: theme.space(6),
    paddingBottom: NAV_CLEARANCE + theme.space(4),
    gap: theme.space(5),
  },
  head: {
    gap: theme.space(1.5),
  },
  subtitle: {
    color: theme.color.muted,
    fontSize: theme.font.body,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(12),
    paddingHorizontal: theme.space(6),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.color.borderStrong,
  },
  emptyText: {
    color: theme.color.faint,
    fontSize: theme.font.label,
    textAlign: 'center',
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.display,
    fontWeight: '700',
    letterSpacing: -1,
  },
  drop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space(2.5),
    height: 60,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.text,
  },
  dropBusy: {
    backgroundColor: theme.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  dropLabel: {
    color: theme.color.background,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    height: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSunken,
  },
  fill: {
    height: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.accent,
  },
  stop: {
    position: 'absolute',
    right: 0,
    top: -10,
  },
  stopLabel: {
    color: theme.color.danger,
    fontSize: theme.font.tiny,
    fontWeight: '600',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2.5),
    padding: theme.space(4),
  },
  errorText: {
    flex: 1,
    color: theme.color.danger,
    fontSize: theme.font.label,
  },
  result: {
    gap: theme.space(3),
  },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSunken,
  },
  resultStats: {
    flexDirection: 'row',
    padding: theme.space(4.5),
  },
  metric: {
    flex: 1,
    gap: theme.space(1),
  },
  metricLabel: {
    color: theme.color.faint,
    fontSize: theme.font.tiny,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metricValue: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  list: {
    gap: theme.space(2.5),
  },
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitle: {
    color: theme.color.text,
    fontSize: theme.font.label,
    fontWeight: '700',
  },
  clear: {
    color: theme.color.faint,
    fontSize: theme.font.tiny,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3.5),
    paddingHorizontal: theme.space(4.5),
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
  },
  rowName: {
    flex: 1,
    color: theme.color.text,
    fontSize: theme.font.label,
  },
  rowSize: {
    color: theme.color.faint,
    fontSize: theme.font.tiny,
    fontVariant: ['tabular-nums'],
  },
});
