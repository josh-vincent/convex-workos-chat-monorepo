import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { useAuth } from "@/auth/WorkOSAuthProvider";

export function LoginScreen() {
  const { signInWithWorkOS, loginAsGuest, workosEnabled } = useAuth();
  const [busy, setBusy] = useState<"workos" | "guest" | null>(null);

  const onWorkOS = async () => {
    setBusy("workos");
    try {
      await signInWithWorkOS();
    } catch (err) {
      Alert.alert(
        "Sign in unavailable",
        err instanceof Error ? err.message : "Could not start WorkOS sign-in.",
      );
    } finally {
      setBusy(null);
    }
  };

  const onGuest = async () => {
    setBusy("guest");
    try {
      await loginAsGuest();
    } catch (err) {
      Alert.alert(
        "Guest login failed",
        err instanceof Error
          ? err.message
          : "Run `pnpm setup:mock-auth` to enable guest mode.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="w-full max-w-sm">
        <Text className="text-center text-3xl font-bold text-foreground">
          Chat
        </Text>
        <Text className="mt-2 text-center text-base text-muted-foreground">
          Sign in to start chatting.
        </Text>

        <Pressable
          onPress={onWorkOS}
          disabled={busy !== null}
          className="mt-8 h-12 flex-row items-center justify-center rounded-2xl bg-foreground active:opacity-80"
        >
          {busy === "workos" ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-base font-semibold text-background">
              {workosEnabled
                ? "Continue with WorkOS"
                : "WorkOS (not configured)"}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={onGuest}
          disabled={busy !== null}
          className="mt-3 h-12 flex-row items-center justify-center rounded-2xl border border-border bg-card active:bg-muted"
        >
          {busy === "guest" ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-base font-semibold text-foreground">
              Continue as guest
            </Text>
          )}
        </Pressable>

        <Text className="mt-6 text-center text-xs text-muted-foreground">
          Guest mode needs `pnpm setup:mock-auth`.
        </Text>
      </View>
    </View>
  );
}
