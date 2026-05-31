import { Icon } from "@/components/icon";
import { useAuth } from "@/auth/WorkOSAuthProvider";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { LogOut, Trash2, Vibrate } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";

// Minimal, honest settings for the starter — extend with your own rows.
export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [hapticFeedback, setHapticFeedback] = useState(true);
  const resetActivity = useMutation(api.dev.resetActivity);
  const [resetting, setResetting] = useState(false);

  const onResetDemo = () => {
    Alert.alert(
      "Reset demo data?",
      "Deletes all inspections, corrective actions, issues and audit history for the demo org so you can test from a clean slate. Templates and your sign-in stay.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            setResetting(true);
            try {
              const r = await resetActivity();
              Alert.alert(
                "Demo data cleared",
                `Removed ${r.cleared.inspections} inspections, ${r.cleared.actions} actions, ${r.cleared.issues} issues.`,
              );
            } catch (e) {
              Alert.alert(
                "Reset failed",
                e instanceof Error ? e.message : "Could not reset demo data.",
              );
            } finally {
              setResetting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background text-foreground"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="android:pb-safe"
    >
      {/* Account */}
      <View className="mx-5 mt-4 mb-5 bg-muted rounded-xl px-4 py-3 border-continuous">
        <Text className="text-[13px] text-muted-foreground">Signed in as</Text>
        <Text selectable className="text-[15px] text-foreground">
          {user?.email || user?.name || "Guest"}
        </Text>
      </View>

      {/* Preferences (example toggle) */}
      <View className="flex-row items-center px-5 py-3 gap-4">
        <Icon icon={Vibrate} className="w-5 h-5 text-foreground" />
        <Text className="flex-1 text-[17px] text-foreground">
          Haptic feedback
        </Text>
        <Switch value={hapticFeedback} onValueChange={setHapticFeedback} />
      </View>

      <View className="h-px bg-border mx-5" />

      {/* Log out */}
      <Pressable
        onPress={() => {
          void signOut();
        }}
        className="flex-row items-center px-5 py-3.5 gap-4 active:bg-muted"
      >
        <Icon icon={LogOut} className="w-5 h-5 text-foreground" />
        <Text className="text-[17px] text-foreground">Log out</Text>
      </Pressable>

      {/* Danger zone — testing helper to clear demo activity and start over */}
      <Text className="px-5 pt-8 pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        Danger zone
      </Text>
      <Pressable
        onPress={onResetDemo}
        disabled={resetting}
        className="mx-5 flex-row items-center gap-4 rounded-xl border border-destructive/40 px-4 py-3.5 active:bg-destructive/10"
      >
        <Icon icon={Trash2} className="w-5 h-5 text-destructive" />
        <View className="flex-1">
          <Text className="text-[17px] text-destructive">
            {resetting ? "Resetting…" : "Reset demo data"}
          </Text>
          <Text className="text-[13px] text-muted-foreground">
            Clears inspections, actions, issues & audit log
          </Text>
        </View>
      </Pressable>
    </ScrollView>
  );
}
