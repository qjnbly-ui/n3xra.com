import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

const supabase: SupabaseClient | null = process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ? createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)
  : null;

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

const colors = { background: "#070c12", surface: "#101923", border: "#243342", text: "#f2f5f7", muted: "#9aa9b6", accent: "#b7d5c2", danger: "#e58b8b" };

export default function App() {
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!supabase) { setStatus("Add Supabase credentials to admin-app/.env first."); setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSessionUser(data.session?.user ?? null); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSessionUser(nextSession?.user ?? null));
    return () => { data.subscription.unsubscribe(); notificationListener.current?.remove(); };
  }, []);

  useEffect(() => {
    if (!sessionUser) return;
    loadNotifications();
    registerForPushNotifications(sessionUser.id).catch((error) => setStatus(error.message));
    notificationListener.current = Notifications.addNotificationReceivedListener(() => loadNotifications());
    const channel = supabase?.channel("admin-notifications-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_notifications" }, () => loadNotifications())
      .subscribe();
    return () => {
      notificationListener.current?.remove();
      if (channel) supabase?.removeChannel(channel);
    };
  }, [sessionUser]);

  async function signIn() {
    if (!supabase) return;
    setBusy(true); setStatus("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setStatus(error.message);
    else {
      const { data: admin } = await supabase.functions.invoke("platform-admin", { body: { action: "get-platform-admin-access" } });
      if (!admin?.ok && !admin?.admin) { await supabase.auth.signOut(); setStatus("This account does not have platform-admin access."); }
      else setSessionUser(data.user);
    }
    setBusy(false);
  }

  async function loadNotifications() {
    if (!supabase) return;
    const { data, error } = await supabase.from("admin_notifications").select("id,title,summary,priority,product,action_url,created_at,read_at").is("deleted_at", null).is("archived_at", null).order("created_at", { ascending: false }).limit(100);
    if (error) setStatus(error.message); else setNotifications((data ?? []) as NotificationRow[]);
  }

  async function markRead(id: string) {
    if (!supabase) return;
    await supabase.from("admin_notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    setNotifications((rows) => rows.map((row) => row.id === id ? { ...row, read_at: new Date().toISOString() } : row));
  }

  if (loading) return <Centered><ActivityIndicator color={colors.accent} /></Centered>;
  if (!sessionUser) return <Login email={email} password={password} setEmail={setEmail} setPassword={setPassword} signIn={signIn} busy={busy} status={status} />;
  return <SafeAreaView style={styles.safe}><StatusBar barStyle="light-content" /><View style={styles.container}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>N3XRA ADMIN</Text><Text style={styles.heading}>Notifications</Text></View><Pressable onPress={() => supabase?.auth.signOut()}><Text style={styles.link}>Sign out</Text></Pressable></View>
    <Text style={styles.subheading}>Live platform activity for {sessionUser.email}</Text>
    {status ? <Text style={styles.status}>{status}</Text> : null}
    <FlatList data={notifications} keyExtractor={(item) => item.id} onRefresh={loadNotifications} refreshing={false} contentContainerStyle={notifications.length ? undefined : styles.emptyList} renderItem={({ item }) => <Pressable style={[styles.card, !item.read_at && styles.unread]} onPress={() => markRead(item.id)}><View style={styles.cardTop}><Text style={styles.product}>{item.product || "N3XRA"}</Text><Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text></View><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardSummary}>{item.summary}</Text>{!item.read_at ? <Text style={styles.unreadLabel}>UNREAD · TAP TO MARK READ</Text> : null}</Pressable>} ListEmptyComponent={<Text style={styles.empty}>No notifications yet.</Text>} />
  </View></SafeAreaView>;
}

function Login({ email, password, setEmail, setPassword, signIn, busy, status }: { email: string; password: string; setEmail: (v: string) => void; setPassword: (v: string) => void; signIn: () => void; busy: boolean; status: string }) {
  return <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}><View style={styles.login}><Text style={styles.eyebrow}>N3XRA ADMIN</Text><Text style={styles.heading}>Sign in</Text><Text style={styles.subheading}>Use your platform-admin account to receive live notifications.</Text><TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} /><TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.muted} secureTextEntry value={password} onChangeText={setPassword} /><Pressable style={styles.button} onPress={signIn} disabled={busy}><Text style={styles.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text></Pressable>{status ? <Text style={styles.status}>{status}</Text> : null}</View></KeyboardAvoidingView>;
}

function Centered({ children }: { children: React.ReactNode }) { return <View style={styles.centered}>{children}</View>; }

async function registerForPushNotifications(userId: string) {
  if (!supabase || !Device.isDevice) return;
  const existing = await Notifications.getPermissionsAsync();
  let permission = existing.status;
  if (permission !== "granted") permission = (await Notifications.requestPermissionsAsync()).status;
  if (permission !== "granted") throw new Error("Push notifications are disabled. Enable them in your phone settings.");
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await supabase.from("admin_push_devices").upsert({ user_id: userId, expo_push_token: token, platform: Platform.OS, last_seen_at: new Date().toISOString(), disabled_at: null }, { onConflict: "user_id,expo_push_token" });
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.background }, container: { flex: 1, padding: 22 }, login: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: colors.background }, centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }, eyebrow: { color: colors.accent, fontSize: 12, fontWeight: "800", letterSpacing: 2 }, heading: { color: colors.text, fontSize: 34, fontWeight: "800", marginTop: 8 }, subheading: { color: colors.muted, fontSize: 14, lineHeight: 21, marginBottom: 20 }, link: { color: colors.accent, fontWeight: "700", marginTop: 5 }, input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10, color: colors.text, padding: 15, marginTop: 12 }, button: { backgroundColor: colors.accent, borderRadius: 10, alignItems: "center", padding: 15, marginTop: 16 }, buttonText: { color: colors.background, fontWeight: "800" }, status: { color: colors.danger, marginBottom: 14, lineHeight: 20 }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 }, unread: { borderColor: colors.accent }, cardTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 9 }, product: { color: colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1 }, date: { color: colors.muted, fontSize: 11 }, cardTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 6 }, cardSummary: { color: colors.muted, fontSize: 14, lineHeight: 21 }, unreadLabel: { color: colors.accent, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: 13 }, emptyList: { flex: 1, justifyContent: "center" }, empty: { color: colors.muted, textAlign: "center" } });
