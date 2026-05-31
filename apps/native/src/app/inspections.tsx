import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useBeacon } from "@/beacon/useBeacon";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";

// Surface the demo forms first.
const FEATURED = [
  "Daily Site Safety Walk",
  "Forklift Pre-Start Check",
  "Working at Heights Permit",
];

export default function InspectionsScreen() {
  const me = useBeacon();
  const router = useRouter();
  const ensureUser = useMutation(api.me.ensureUser);
  const start = useMutation(api.inspections.start);
  const [starting, setStarting] = useState<string | null>(null);

  const templates = useQuery(
    api.templates.list,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  const onStart = async (templateId: Id<"templates">) => {
    if (!me?.orgId) return;
    setStarting(templateId);
    try {
      let userId = me.userId;
      if (!userId) userId = (await ensureUser()).userId;
      const inspectionId = await start({
        orgId: me.orgId,
        templateId,
        inspectorId: userId,
      });
      router.push(`/inspection/${inspectionId}` as Href);
    } finally {
      setStarting(null);
    }
  };

  if (me === undefined || templates === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const sorted = [...templates].sort((a, b) => {
    const ra = FEATURED.indexOf(a.name);
    const rb = FEATURED.indexOf(b.name);
    return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb);
  });

  return (
    <FlatList
      className="flex-1 bg-background"
      data={sorted}
      keyExtractor={(t) => t._id}
      contentContainerClassName="p-4"
      renderItem={({ item }) => {
        const featured = FEATURED.includes(item.name);
        return (
          <Pressable
            onPress={() => onStart(item._id)}
            disabled={starting !== null}
            className={`mb-2 flex-row items-center justify-between rounded-2xl border px-4 py-3 active:bg-muted ${
              featured ? "border-foreground/40 bg-card" : "border-border bg-card"
            }`}
          >
            <View className="flex-1 pr-3">
              <Text className="text-[15px] font-medium text-foreground">
                {item.name}
              </Text>
              <Text className="text-[13px] text-muted-foreground">
                {item.category} · {item.industry}
              </Text>
            </View>
            {starting === item._id ? (
              <ActivityIndicator />
            ) : (
              <Text className="text-[13px] font-medium text-foreground">
                Start →
              </Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}
