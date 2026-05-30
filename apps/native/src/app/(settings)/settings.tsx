import { Icon } from "@/components/icon";
import { useAuth } from "@/auth/WorkOSAuthProvider";
import { LogOut, Vibrate } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";

// Minimal, honest settings for the starter — extend with your own rows.
export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [hapticFeedback, setHapticFeedback] = useState(true);

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
    </ScrollView>
  );
}
