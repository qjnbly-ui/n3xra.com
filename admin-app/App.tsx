import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import type { User } from "@supabase/supabase-js";

import { startAuthAutoRefresh, supabase } from "./lib/supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type NotificationRow = {
  id: string;
  title: string;
  summary: string;
  priority: string;
  product: string;
  action_url: string | null;
  created_at: string;
  read_at: string | null;
};

type AdminRole = "owner" | "admin" | "reviewer";
type StatusTone = "error" | "success" | "neutral";

const colors = {
  header: "#050a12",
  background: "#edf2f7",
  surface: "#ffffff",
  fog: "#f4f6f8",
  ink: "#0f1620",
  slate: "#5d6979",
  line: "rgba(15, 22, 32, 0.12)",
  teal: "#123a33",
  tealBright: "#0f766e",
  danger: "#a43a1a",
  success: "#08745f",
};

export default function App() {
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [accessRole, setAccessRole] = useState<AdminRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);

  function showStatus(message: string, tone: StatusTone = "neutral") {
    setStatus(message);
    setStatusTone(tone);
  }

  useEffect(() => {
    const stopAutoRefresh = startAuthAutoRefresh();

    if (!supabase) {
      showStatus("This build is missing its N3XRA connection settings.", "error");
      setLoading(false);
      return stopAutoRefresh;
    }

    let active = true;

    async function restoreSession() {
      try {
        const { data, error } = await supabase!.auth.getSession();
        if (error) throw error;

        const user = data.session?.user ?? null;
        if (user) {
          try {
            const role = await getAdminAccess();
            if (active) {
              setSessionUser(user);
              setAccessRole(role);
            }
          } catch {
            await supabase!.auth.signOut({ scope: "local" });
            if (active) showStatus("This account does not have access to the N3XRA Admin app.", "error");
          }
        }
      } catch (error) {
        if (active) showStatus(getMessage(error, "Unable to restore your N3XRA session."), "error");
      } finally {
        if (active) setLoading(false);
      }
    }

    void restoreSession();

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setSessionUser(null);
        setAccessRole(null);
        setNotifications([]);
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
      notificationListener.current?.remove();
      stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    if (!sessionUser || !accessRole) return;

    void loadNotifications();
    void registerForPushNotifications(sessionUser.id, accessRole).catch((error) => {
      showStatus(getMessage(error, "Push notification setup was not completed."), "error");
    });

    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      void loadNotifications();
    });

    return () => notificationListener.current?.remove();
  }, [sessionUser, accessRole]);

  async function signIn() {
    if (!supabase || busy) return;
    if (!email.trim() || !password) {
      showStatus("Enter your email address and password.", "error");
      return;
    }

    setBusy(true);
    showStatus("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;

      const role = await getAdminAccess();
      setAccessRole(role);
      setSessionUser(data.user);
      setPassword("");
    } catch (error) {
      await supabase.auth.signOut({ scope: "local" });
      const message = getMessage(error, "Unable to sign in.");
      showStatus(
        message === "Admin app access is required."
          ? "This account does not have access to the N3XRA Admin app."
          : message,
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    if (!supabase || busy) return;
    if (!email.trim()) {
      showStatus("Enter your email address first.", "error");
      return;
    }

    setBusy(true);
    showStatus("Sending password reset…");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: "https://n3xra.com/account/?mode=recovery",
      });
      if (error) throw error;
      showStatus("Password reset email sent. Check your inbox, junk, or spam folder.", "success");
    } catch (error) {
      showStatus(getMessage(error, "Unable to send the password reset email."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function loadNotifications() {
    if (!supabase || !accessRole) return;
    setRefreshing(true);

    const table = accessRole === "reviewer" ? "admin_review_notifications" : "admin_notifications";
    let query = supabase.from(table).select("id,title,summary,priority,product,action_url,created_at,read_at");
    if (accessRole !== "reviewer") query = query.is("deleted_at", null).is("archived_at", null);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(100);

    if (error) showStatus(error.message, "error");
    else setNotifications((data ?? []) as NotificationRow[]);
    setRefreshing(false);
  }

  async function markRead(id: string) {
    if (!supabase || !accessRole) return;
    const readAt = new Date().toISOString();
    const table = accessRole === "reviewer" ? "admin_review_notifications" : "admin_notifications";
    const { error } = await supabase.from(table).update({ read_at: readAt }).eq("id", id);
    if (error) {
      showStatus(error.message, "error");
      return;
    }
    setNotifications((rows) => rows.map((row) => (row.id === id ? { ...row, read_at: readAt } : row)));
  }

  if (loading) return <Centered><ActivityIndicator color={colors.tealBright} size="large" /></Centered>;

  if (!sessionUser) {
    return (
      <Login
        email={email}
        password={password}
        setEmail={setEmail}
        setPassword={setPassword}
        signIn={signIn}
        sendPasswordReset={sendPasswordReset}
        busy={busy}
        status={status}
        statusTone={statusTone}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.header} />
      <BrandHeader action="Sign out" onAction={() => void supabase?.auth.signOut({ scope: "local" })} />
      <View style={styles.notificationPage}>
        <View style={styles.notificationHeadingRow}>
          <View style={styles.notificationHeadingCopy}>
            <Text style={styles.kicker}>N3XRA ADMIN</Text>
            <Text style={styles.pageHeading}>Notifications</Text>
            <Text style={styles.pageSubheading}>
              {accessRole === "reviewer" ? "Review-safe sample activity" : "Live platform activity"} for {sessionUser.email}
            </Text>
          </View>
          <View style={styles.rolePill}><Text style={styles.rolePillText}>{accessRole}</Text></View>
        </View>
        {status ? <StatusMessage message={status} tone={statusTone} /> : null}
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          onRefresh={loadNotifications}
          refreshing={refreshing}
          contentContainerStyle={notifications.length ? styles.notificationList : styles.emptyList}
          renderItem={({ item }) => (
            <Pressable style={[styles.notificationCard, !item.read_at && styles.unread]} onPress={() => void markRead(item.id)}>
              <View style={styles.cardTop}>
                <Text style={styles.product}>{item.product || "N3XRA"}</Text>
                <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSummary}>{item.summary}</Text>
              {!item.read_at ? <Text style={styles.unreadLabel}>UNREAD · TAP TO MARK READ</Text> : null}
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No notifications yet.</Text>}
        />
      </View>
    </SafeAreaView>
  );
}

function Login({
  email,
  password,
  setEmail,
  setPassword,
  signIn,
  sendPasswordReset,
  busy,
  status,
  statusTone,
}: {
  email: string;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  signIn: () => void;
  sendPasswordReset: () => void;
  busy: boolean;
  status: string;
  statusTone: StatusTone;
}) {
  return (
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar barStyle="light-content" backgroundColor={colors.header} />
      <BrandHeader action="Login" />
      <View style={styles.loginPage}>
        <Text style={styles.masterTitle}>N3XRA Master Login</Text>
        <View style={styles.loginCard}>
          <View style={styles.authCardHead}>
            <Text style={styles.authTitle}>Sign in</Text>
            <Text style={styles.authSubtitle}>Use your N3XRA account to continue.</Text>
          </View>

          <View style={styles.authToggle}>
            <View style={styles.authToggleActive}><Text style={styles.authToggleActiveText}>Sign in</Text></View>
            <View style={styles.authToggleInactive}><Text style={styles.authToggleInactiveText}>Admin access</Text></View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              autoComplete="current-password"
              secureTextEntry
              returnKeyType="done"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void signIn()}
            />
          </View>

          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]} onPress={() => void signIn()} disabled={busy}>
            {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Sign in</Text>}
          </Pressable>
          <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => void sendPasswordReset()} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Forgot password?</Text>
          </Pressable>

          {status ? <StatusMessage message={status} tone={statusTone} /> : null}
          <Text style={styles.accessNote}>This mobile app is restricted to approved N3XRA platform administrators.</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function BrandHeader({ action, onAction }: { action: string; onAction?: () => void }) {
  return (
    <View style={styles.brandHeader}>
      <View style={styles.brand}>
        <Image source={require("./assets/n3xra-logo.png")} style={styles.brandLogo} />
        <Text style={styles.brandName}>N3XRA</Text>
      </View>
      <Pressable style={styles.headerAction} onPress={onAction} disabled={!onAction}>
        <Text style={styles.headerActionText}>{action}</Text>
      </Pressable>
    </View>
  );
}

function StatusMessage({ message, tone }: { message: string; tone: StatusTone }) {
  return <Text style={[styles.status, tone === "error" && styles.statusError, tone === "success" && styles.statusSuccess]}>{message}</Text>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

function getMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function getAdminAccess(): Promise<AdminRole> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: { action: "get-platform-admin-access" },
  });
  const role = String(data?.admin?.role || "") as AdminRole;
  if (error || !data?.ok || !["owner", "admin", "reviewer"].includes(role)) {
    throw new Error("Admin app access is required.");
  }
  return role;
}

async function registerForPushNotifications(userId: string, role: AdminRole) {
  if (!supabase || !Device.isDevice) return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "N3XRA Admin notifications",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let permission = existing.status;
  if (permission !== "granted") permission = (await Notifications.requestPermissionsAsync()).status;
  if (permission !== "granted") throw new Error("Push notifications are disabled. Enable them in your phone settings.");

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  const reviewer = role === "reviewer";
  const table = reviewer ? "admin_review_push_devices" : "admin_push_devices";
  const userColumn = reviewer ? "reviewer_user_id" : "user_id";
  const { error } = await supabase.from(table).upsert(
    {
      [userColumn]: userId,
      expo_push_token: token,
      platform: Platform.OS,
      last_seen_at: new Date().toISOString(),
      disabled_at: null,
    },
    { onConflict: `${userColumn},expo_push_token` },
  );
  if (error) throw error;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  brandHeader: {
    minHeight: 68,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.header,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandLogo: { width: 34, height: 34, resizeMode: "contain" },
  brandName: { color: "#ffffff", fontSize: 15, fontWeight: "800", letterSpacing: 3.2 },
  headerAction: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: 20 },
  headerActionText: { color: "#ffffff", fontSize: 12, fontWeight: "800" },
  loginPage: { flex: 1, justifyContent: "center", paddingHorizontal: 18, paddingVertical: 28 },
  masterTitle: { color: colors.ink, textAlign: "center", fontSize: 30, lineHeight: 34, fontWeight: "700", letterSpacing: -1.6, marginBottom: 18 },
  loginCard: { width: "100%", maxWidth: 620, alignSelf: "center", padding: 22, gap: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, elevation: 5, shadowColor: "#07101a", shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
  authCardHead: { gap: 5 },
  authTitle: { color: colors.ink, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }), fontSize: 25, fontWeight: "700" },
  authSubtitle: { color: colors.slate, fontSize: 15, lineHeight: 21 },
  authToggle: { flexDirection: "row", gap: 5, padding: 5, borderRadius: 24, borderWidth: 1, borderColor: "rgba(15,22,32,0.08)", backgroundColor: "#e9ecef" },
  authToggleActive: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: colors.teal, elevation: 2 },
  authToggleInactive: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  authToggleActiveText: { color: "#ffffff", fontWeight: "700" },
  authToggleInactiveText: { color: colors.slate, fontWeight: "700" },
  field: { gap: 8 },
  label: { color: colors.tealBright, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  input: { width: "100%", minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.fog, color: colors.ink, paddingHorizontal: 14, fontSize: 16 },
  primaryButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 25, backgroundColor: colors.ink, elevation: 3 },
  primaryButtonText: { color: "#ffffff", fontWeight: "800", fontSize: 15 },
  secondaryButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 25, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  secondaryButtonText: { color: colors.ink, fontWeight: "800", fontSize: 15 },
  buttonPressed: { opacity: 0.76 },
  status: { color: colors.slate, fontSize: 13, lineHeight: 19, textAlign: "center" },
  statusError: { color: colors.danger },
  statusSuccess: { color: colors.success },
  accessNote: { color: colors.slate, fontSize: 12, lineHeight: 18, textAlign: "center" },
  notificationPage: { flex: 1, paddingHorizontal: 18, paddingTop: 20 },
  notificationHeadingRow: { padding: 18, marginBottom: 14, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(15,22,32,0.08)", backgroundColor: colors.surface },
  notificationHeadingCopy: { flex: 1 },
  kicker: { color: colors.tealBright, fontSize: 11, fontWeight: "800", letterSpacing: 2, marginBottom: 5 },
  pageHeading: { color: colors.ink, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }), fontSize: 30, fontWeight: "700" },
  pageSubheading: { color: colors.slate, fontSize: 13, lineHeight: 19, marginTop: 5 },
  rolePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: "#e5f3f0" },
  rolePillText: { color: colors.tealBright, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  notificationList: { paddingBottom: 24 },
  notificationCard: { padding: 16, marginBottom: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(15,22,32,0.1)", backgroundColor: colors.surface },
  unread: { borderColor: "rgba(15,118,110,0.55)", borderLeftWidth: 4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginBottom: 9 },
  product: { flex: 1, color: colors.tealBright, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  date: { color: colors.slate, fontSize: 10 },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: "800", marginBottom: 6 },
  cardSummary: { color: colors.slate, fontSize: 14, lineHeight: 21 },
  unreadLabel: { color: colors.tealBright, fontSize: 10, fontWeight: "800", letterSpacing: 0.7, marginTop: 13 },
  emptyList: { flexGrow: 1, justifyContent: "center", paddingBottom: 90 },
  empty: { color: colors.slate, textAlign: "center" },
});
