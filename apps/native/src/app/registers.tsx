import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useBeacon } from "@/beacon/useBeacon";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

// ── Types ─────────────────────────────────────────────────────────────────────

type RegisterStatus =
  | "current"
  | "expiring_soon"
  | "expired"
  | "missing"
  | "review_due";

type RegisterType =
  | "licence"
  | "competency"
  | "sds"
  | "insurance"
  | "plant"
  | "induction";

// ── Status colour map ─────────────────────────────────────────────────────────

// expired → fail  |  expiring_soon / review_due → hivis  |  current → pass

const STATUS_BG: Record<RegisterStatus, string> = {
  current: "bg-pass/20",
  expiring_soon: "bg-hivis/20",
  expired: "bg-fail/20",
  missing: "bg-muted",
  review_due: "bg-hivis/20",
};

const STATUS_TEXT: Record<RegisterStatus, string> = {
  current: "text-pass",
  expiring_soon: "text-hivis",
  expired: "text-fail",
  missing: "text-muted-foreground",
  review_due: "text-hivis",
};

const STATUS_LABEL: Record<RegisterStatus, string> = {
  current: "Current",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  missing: "Missing",
  review_due: "Review due",
};

function StatusChip({ status }: { status: string }) {
  const bg = STATUS_BG[status as RegisterStatus] ?? "bg-muted";
  const text = STATUS_TEXT[status as RegisterStatus] ?? "text-muted-foreground";
  const label = STATUS_LABEL[status as RegisterStatus] ?? status;
  return (
    <View className={`rounded-full px-2 py-0.5 ${bg}`}>
      <Text className={`text-[11px] font-semibold ${text}`}>{label}</Text>
    </View>
  );
}

// ── Type labels ───────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<RegisterType, string> = {
  licence: "Licence",
  competency: "Competency",
  sds: "SDS",
  insurance: "Insurance",
  plant: "Plant",
  induction: "Induction",
};

// Status sort order — urgent items rise to top.
const STATUS_ORDER: Record<string, number> = {
  expired: 0,
  expiring_soon: 1,
  review_due: 2,
  missing: 3,
  current: 4,
};

// ── Filter tabs ───────────────────────────────────────────────────────────────

const FILTER_TABS: Array<{ value: RegisterType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "licence", label: "Licences" },
  { value: "competency", label: "Competencies" },
  { value: "sds", label: "SDS" },
  { value: "insurance", label: "Insurance" },
  { value: "plant", label: "Plant" },
  { value: "induction", label: "Inductions" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function RegistersScreen() {
  const me = useBeacon();
  const [activeType, setActiveType] = useState<RegisterType | "all">("all");

  const registers = useQuery(
    api.registers.list,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  if (me === undefined || registers === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const filtered = registers
    .filter((r) => activeType === "all" || r.registerType === activeType)
    .slice()
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
    );

  return (
    <View className="flex-1 bg-background">
      {/* Type filter pill bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-grow-0 border-b border-border"
        contentContainerClassName="px-4 py-2 gap-1.5"
      >
        {FILTER_TABS.map(({ value, label }) => (
          <Pressable
            key={value}
            onPress={() => setActiveType(value)}
            className={`rounded-full px-3.5 py-1.5 active:opacity-70 ${
              activeType === value
                ? "bg-foreground"
                : "bg-muted"
            }`}
          >
            <Text
              className={`text-[12px] font-medium ${
                activeType === value ? "text-background" : "text-muted-foreground"
              }`}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-[17px] font-semibold text-foreground font-display">
            {(registers.length ?? 0) > 0
              ? "No entries match this filter"
              : "No register entries yet"}
          </Text>
          <Text className="mt-1 text-[13px] text-muted-foreground text-center max-w-xs">
            {(registers.length ?? 0) > 0
              ? "Try switching to 'All' to see everything."
              : "Register entries track licences, competencies, SDS documents, insurance, plant, and inductions."}
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={filtered}
          keyExtractor={(r) => r._id}
          contentContainerClassName="p-4"
          renderItem={({ item: r }) => {
            const isUrgent =
              r.status === "expired" ||
              r.status === "expiring_soon" ||
              r.status === "review_due";

            return (
              <View
                className={`mb-2 rounded-2xl border px-4 py-3 bg-card ${
                  isUrgent ? "border-hivis/40" : "border-border"
                }`}
              >
                {/* Label + type */}
                <View className="flex-row items-start justify-between gap-2">
                  <Text
                    className="flex-1 text-[15px] font-medium text-foreground"
                    numberOfLines={1}
                  >
                    {r.label}
                  </Text>
                  <StatusChip status={r.status} />
                </View>

                {/* Metadata row */}
                <View className="mt-1.5 flex-row items-center gap-2 flex-wrap">
                  <Text className="text-[12px] text-muted-foreground">
                    {TYPE_LABELS[r.registerType as RegisterType] ??
                      r.registerType}
                  </Text>
                  <Text className="text-[12px] text-muted-foreground">·</Text>
                  <Text className="text-[12px] text-muted-foreground capitalize">
                    {r.anchorType}
                    {r.identifier ? ` · ${r.identifier}` : ""}
                  </Text>
                  {r.expiresAt ? (
                    <>
                      <Text className="text-[12px] text-muted-foreground">
                        ·
                      </Text>
                      <Text
                        className={`text-[12px] font-medium ${
                          r.status === "expired"
                            ? "text-fail"
                            : r.status === "expiring_soon"
                              ? "text-hivis"
                              : "text-muted-foreground"
                        }`}
                      >
                        Expires {formatDate(r.expiresAt)}
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
