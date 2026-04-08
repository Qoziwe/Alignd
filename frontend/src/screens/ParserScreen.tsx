import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getApiBaseUrl, parseProfile } from "../services/api";
import { ProfileParseResult } from "../types/parser";
import { formatCount, formatDate } from "../utils/format";

const profilePlaceholder = "https://www.instagram.com/username/ or https://www.tiktok.com/@username";

export function ParserScreen() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ProfileParseResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const configuredApiUrl = readConfiguredApiUrl();

  const handleParse = async () => {
    setLoading(true);
    setError("");

    try {
      const parsed = await parseProfile(url);
      setResult(parsed);
    } catch (caughtError) {
      setResult(null);
      setError(caughtError instanceof Error ? caughtError.message : "Failed to parse profile.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Frontend + Backend</Text>
        <Text style={styles.title}>Instagram / TikTok Parser</Text>
        <Text style={styles.subtitle}>
          The mobile app now works through a backend API. Paste a public Instagram or TikTok profile link and the
          server will try to fetch profile data plus descriptions for up to 20 recent posts.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Profile URL</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setUrl}
          placeholder={profilePlaceholder}
          placeholderTextColor="#8a7f72"
          style={styles.input}
          value={url}
        />

        <Pressable disabled={loading} onPress={handleParse} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          {loading ? <ActivityIndicator color="#fffaf1" /> : <Text style={styles.buttonText}>Parse Profile</Text>}
        </Pressable>

        <Text style={styles.note}>
          Backend API is loaded from `frontend/.env`: {configuredApiUrl}.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      {result ? (
        <View style={styles.results}>
          <View style={styles.profileCard}>
            <Text style={styles.platformBadge}>{result.platform.toUpperCase()}</Text>
            {result.avatarUrl ? <Image source={{ uri: result.avatarUrl }} style={styles.avatar} /> : null}
            <Text style={styles.profileName}>{result.fullName || result.username}</Text>
            <Text style={styles.profileUsername}>@{result.username}</Text>
            <Text style={styles.profileBio}>{result.bio || "No bio found."}</Text>

            <View style={styles.statsRow}>
              <Stat label="Followers" value={formatCount(result.followersCount)} />
              <Stat label="Following" value={formatCount(result.followingCount)} />
              <Stat label="Posts" value={formatCount(result.postsCount)} />
            </View>

            <View style={styles.metaRow}>
              <Meta label="Verified" value={result.isVerified ? "Yes" : "No"} />
              <Meta label="Visibility" value={result.isPrivate ? "Private" : "Public"} />
              {Object.entries(result.extra ?? {}).map(([key, value]) => (
                <Meta
                  key={key}
                  label={translateExtraKey(key)}
                  value={typeof value === "number" ? formatCount(value) : value ? String(value) : "-"}
                />
              ))}
            </View>

            <Pressable onPress={() => Linking.openURL(result.profileUrl)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Open Profile</Text>
            </Pressable>
          </View>

          <View style={styles.postsHeader}>
            <Text style={styles.postsTitle}>Recent Posts</Text>
            <Text style={styles.postsHint}>{result.recentPosts.length} of 20</Text>
          </View>

          {result.recentPosts.map((post, index) => (
            <View key={post.id} style={styles.postCard}>
              <Text style={styles.postIndex}>Post {index + 1}</Text>
              <Text style={styles.postDate}>{formatDate(post.publishedAt)}</Text>
              <Text style={styles.postCaption}>{post.caption || "No caption"}</Text>
              {post.url ? (
                <Pressable onPress={() => Linking.openURL(post.url!)} style={styles.postLink}>
                  <Text style={styles.postLinkText}>Open Post</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function translateExtraKey(key: string) {
  switch (key) {
    case "likesCount":
      return "Likes";
    case "externalLink":
      return "Link";
    default:
      return key;
  }
}

function readConfiguredApiUrl() {
  try {
    return getApiBaseUrl();
  } catch {
    return "not configured";
  }
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 20,
  },
  hero: {
    backgroundColor: "#d6e4d8",
    borderRadius: 28,
    padding: 24,
    gap: 8,
  },
  eyebrow: {
    color: "#395144",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: "#102418",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 34,
  },
  subtitle: {
    color: "#385245",
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: "#fffaf1",
    borderRadius: 28,
    padding: 20,
    gap: 14,
  },
  label: {
    color: "#402f1d",
    fontSize: 15,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#f6efe1",
    borderColor: "#d7c7ac",
    borderRadius: 18,
    borderWidth: 1,
    color: "#1f1b16",
    fontSize: 15,
    minHeight: 56,
    paddingHorizontal: 16,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#1d4d3a",
    borderRadius: 18,
    minHeight: 54,
    justifyContent: "center",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: "#fffaf1",
    fontSize: 16,
    fontWeight: "700",
  },
  note: {
    color: "#6c5d49",
    fontSize: 13,
    lineHeight: 19,
  },
  error: {
    color: "#a52e1e",
    fontSize: 14,
    lineHeight: 20,
  },
  results: {
    gap: 16,
    paddingBottom: 40,
  },
  profileCard: {
    backgroundColor: "#102418",
    borderRadius: 28,
    padding: 22,
    gap: 12,
  },
  platformBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#f0cf8e",
    borderRadius: 999,
    color: "#50350a",
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileName: {
    color: "#f7f2e8",
    fontSize: 24,
    fontWeight: "800",
  },
  avatar: {
    borderRadius: 44,
    height: 88,
    width: 88,
  },
  profileUsername: {
    color: "#bdd1c4",
    fontSize: 16,
    fontWeight: "600",
  },
  profileBio: {
    color: "#e4ebe5",
    fontSize: 15,
    lineHeight: 22,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    backgroundColor: "#173223",
    borderRadius: 18,
    flex: 1,
    gap: 4,
    padding: 14,
  },
  statValue: {
    color: "#fffaf1",
    fontSize: 17,
    fontWeight: "800",
  },
  statLabel: {
    color: "#9bb1a5",
    fontSize: 12,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metaItem: {
    backgroundColor: "#173223",
    borderRadius: 16,
    minWidth: "48%",
    padding: 12,
  },
  metaLabel: {
    color: "#9bb1a5",
    fontSize: 12,
    marginBottom: 4,
  },
  metaValue: {
    color: "#f7f2e8",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#335443",
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#e4ebe5",
    fontSize: 15,
    fontWeight: "700",
  },
  postsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  postsTitle: {
    color: "#231b13",
    fontSize: 20,
    fontWeight: "800",
  },
  postsHint: {
    color: "#6c5d49",
    fontSize: 13,
  },
  postCard: {
    backgroundColor: "#fffaf1",
    borderRadius: 24,
    gap: 8,
    padding: 18,
  },
  postIndex: {
    color: "#2e2418",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  postDate: {
    color: "#7b6850",
    fontSize: 13,
  },
  postCaption: {
    color: "#1f1b16",
    fontSize: 15,
    lineHeight: 22,
  },
  postLink: {
    alignSelf: "flex-start",
    marginTop: 4,
  },
  postLinkText: {
    color: "#1d4d3a",
    fontSize: 14,
    fontWeight: "700",
  },
});
