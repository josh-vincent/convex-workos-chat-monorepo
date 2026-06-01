import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useBeacon } from "@/beacon/useBeacon";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActionStatus = "todo" | "open" | "in_progress" | "done" | "verified";
type ActionPriority = "low" | "medium" | "high" | "critical";

type Action = {
  _id: Id<"actions">;
  title: string;
  description?: string;
  priority: ActionPriority;
  status: ActionStatus;
  dueDate?: number;
  dueAt?: number;
};

// ── Priority colour map ───────────────────────────────────────────────────────

const PRIORITY_BG: Record<ActionPriority, string> = {
  low: "bg-muted",
  medium: "bg-sky-100",
  high: "bg-hivis/20",
  critical: "bg-fail/20",
};

const PRIORITY_TEXT: Record<ActionPriority, string> = {
  low: "text-muted-foreground",
  medium: "text-sky-700",
  high: "text-hivis",
  critical: "text-fail",
};

const PRIORITY_LABEL: Record<ActionPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

function PriorityChip({ priority }: { priority: ActionPriority }) {
  return (
    <View
      className={`rounded-full px-2 py-0.5 ${PRIORITY_BG[priority] ?? "bg-muted"}`}
    >
      <Text
        className={`text-[11px] font-semibold ${PRIORITY_TEXT[priority] ?? "text-muted-foreground"}`}
      >
        {PRIORITY_LABEL[priority] ?? priority}
      </Text>
    </View>
  );
}

// ── Status chip ───────────────────────────────────────────────────────────────

const STATUS_BG: Record<ActionStatus, string> = {
  todo: "bg-muted",
  open: "bg-sky-100",
  in_progress: "bg-hivis/20",
  done: "bg-pass/20",
  verified: "bg-pass/30",
};

const STATUS_TEXT: Record<ActionStatus, string> = {
  todo: "text-muted-foreground",
  open: "text-sky-700",
  in_progress: "text-hivis",
  done: "text-pass",
  verified: "text-pass",
};

const STATUS_LABEL: Record<ActionStatus, string> = {
  todo: "To do",
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  verified: "Verified",
};

function StatusChip({ status }: { status: ActionStatus }) {
  return (
    <View
      className={`rounded-full px-2 py-0.5 ${STATUS_BG[status] ?? "bg-muted"}`}
    >
      <Text
        className={`text-[11px] font-semibold ${STATUS_TEXT[status] ?? "text-muted-foreground"}`}
      >
        {STATUS_LABEL[status] ?? status}
      </Text>
    </View>
  );
}

// ── Next-status logic ─────────────────────────────────────────────────────────

const NEXT_STATUS: Partial<Record<ActionStatus, "in_progress" | "done">> = {
  todo: "in_progress",
  open: "in_progress",
  in_progress: "done",
};

const ADVANCE_LABEL: Partial<Record<ActionStatus, string>> = {
  todo: "Start",
  open: "Start",
  in_progress: "Mark done",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Verify sheet ──────────────────────────────────────────────────────────────

function VerifySheet({
  action,
  onClose,
}: {
  action: Action;
  onClose: () => void;
}) {
  const verify = useMutation(api.actions.verify);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    if (!note.trim()) {
      setError("Please enter evidence notes before verifying.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await verify({
        actionId: action._id,
        evidence: [{ note: note.trim() }],
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify action.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="formSheet"
      visible
      onRequestClose={onClose}
    >
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="p-6"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xl font-bold text-foreground font-display">
          Verify action
        </Text>
        <Text className="mt-1 text-[14px] text-muted-foreground">
          {action.title}
        </Text>

        <Text className="mt-5 mb-1.5 text-[12px] font-semibold text-foreground">
          Evidence notes{" "}
          <Text className="text-fail">*</Text>
        </Text>
        <TextInput
          multiline
          numberOfLines={4}
          placeholder="Describe what was done to close this action…"
          placeholderTextColor="#9CA3AF"
          value={note}
          onChangeText={setNote}
          className="rounded-xl border border-border bg-card px-4 py-3 text-[15px] text-foreground min-h-[96px]"
          textAlignVertical="top"
        />

        {error ? (
          <Text className="mt-2 text-[12px] text-fail">{error}</Text>
        ) : null}

        <View className="mt-6 flex-row gap-3">
          <Pressable
            onPress={onClose}
            className="flex-1 rounded-xl border border-border bg-card py-3 items-center active:bg-muted"
          >
            <Text className="text-[15px] font-medium text-foreground">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={handleVerify}
            disabled={saving}
            className="flex-1 rounded-xl bg-pass py-3 items-center active:opacity-70 disabled:opacity-40"
          >
            <Text className="text-[15px] font-semibold text-white">
              {saving ? "Verifying…" : "Verify"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Modal>
  );
}

// ── Action card ───────────────────────────────────────────────────────────────

function ActionCard({ action }: { action: Action }) {
  const update = useMutation(api.actions.update);
  const [advancing, setAdvancing] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);

  const nextStatus = NEXT_STATUS[action.status];
  const advLabel = ADVANCE_LABEL[action.status];

  const handleAdvance = async () => {
    if (!nextStatus || advancing) return;
    setAdvancing(true);
    try {
      await update({ actionId: action._id, status: nextStatus });
    } finally {
      setAdvancing(false);
    }
  };

  const effectiveDue = action.dueAt ?? action.dueDate;
  const isOverdue =
    effectiveDue !== undefined &&
    effectiveDue < Date.now() &&
    action.status !== "done" &&
    action.status !== "verified";

  return (
    <>
      {verifyOpen && (
        <VerifySheet action={action} onClose={() => setVerifyOpen(false)} />
      )}
      <View className="mb-2 rounded-2xl border border-border bg-card px-4 py-3">
        {/* Title row */}
        <View className="flex-row items-start gap-2">
          <Text
            className="flex-1 text-[15px] font-medium text-foreground"
            numberOfLines={2}
          >
            {action.title}
          </Text>
        </View>
        {action.description ? (
          <Text
            className="mt-0.5 text-[12px] text-muted-foreground"
            numberOfLines={1}
          >
            {action.description}
          </Text>
        ) : null}

        {/* Chips + due row */}
        <View className="mt-2 flex-row items-center gap-2 flex-wrap">
          <PriorityChip priority={action.priority} />
          <StatusChip status={action.status} />
          {effectiveDue ? (
            <Text
              className={`text-[11px] font-medium ${isOverdue ? "text-fail" : "text-muted-foreground"}`}
            >
              {isOverdue ? "Overdue · " : "Due · "}
              {formatDate(effectiveDue)}
            </Text>
          ) : null}
        </View>

        {/* Action buttons */}
        {(nextStatus || action.status === "done") ? (
          <View className="mt-3 flex-row gap-2">
            {nextStatus && advLabel ? (
              <Pressable
                onPress={handleAdvance}
                disabled={advancing}
                className="rounded-lg border border-border bg-background px-3 py-1.5 active:bg-muted disabled:opacity-50"
              >
                {advancing ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text className="text-[13px] font-medium text-foreground">
                    {advLabel} →
                  </Text>
                )}
              </Pressable>
            ) : null}
            {action.status === "done" ? (
              <Pressable
                onPress={() => setVerifyOpen(true)}
                className="rounded-lg border border-pass/40 bg-pass/10 px-3 py-1.5 active:bg-pass/20"
              >
                <Text className="text-[13px] font-semibold text-pass">
                  Verify ✓
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </>
  );
}

// ── Group section ─────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  active: "Active",
  done: "Done — awaiting verification",
  verified: "Closed",
};

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ActionsScreen() {
  const me = useBeacon();

  const actions = useQuery(
    api.actions.listForOwner,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  if (me === undefined || actions === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  // Group into active / done / verified buckets
  const active: Action[] = [];
  const done: Action[] = [];
  const verified: Action[] = [];

  for (const a of actions as Action[]) {
    if (a.status === "verified") verified.push(a);
    else if (a.status === "done") done.push(a);
    else active.push(a);
  }

  const byPriorityThenDue = (x: Action, y: Action) => {
    const po = (PRIORITY_ORDER[x.priority] ?? 9) - (PRIORITY_ORDER[y.priority] ?? 9);
    if (po !== 0) return po;
    const xDue = x.dueAt ?? x.dueDate ?? Infinity;
    const yDue = y.dueAt ?? y.dueDate ?? Infinity;
    return xDue - yDue;
  };

  active.sort(byPriorityThenDue);
  done.sort(byPriorityThenDue);
  verified.sort((x, y) => (y.dueAt ?? y.dueDate ?? 0) - (x.dueAt ?? x.dueDate ?? 0));

  const grouped: { key: string; items: Action[] }[] = [];
  if (active.length) grouped.push({ key: "active", items: active });
  if (done.length) grouped.push({ key: "done", items: done });
  if (verified.length) grouped.push({ key: "verified", items: verified });

  const openCount = (actions as Action[]).filter(
    (a) => a.status === "todo" || a.status === "open" || a.status === "in_progress",
  ).length;

  const criticalCount = (actions as Action[]).filter(
    (a) => a.priority === "critical" && a.status !== "done" && a.status !== "verified",
  ).length;

  if (grouped.length === 0) {
    return (
      <View className="flex-1 bg-background px-4 py-8 items-center justify-center">
        <Text className="text-[17px] font-semibold text-foreground font-display">
          No actions yet
        </Text>
        <Text className="mt-1 text-[13px] text-muted-foreground text-center max-w-xs">
          Corrective actions are raised when inspections uncover issues.
          Advance status and close the loop with evidence.
        </Text>
      </View>
    );
  }

  type ListItem =
    | { type: "header"; key: string; label: string; count: number }
    | { type: "action"; item: Action };

  const listData: ListItem[] = [];
  for (const { key, items } of grouped) {
    listData.push({
      type: "header",
      key,
      label: GROUP_LABELS[key] ?? key,
      count: items.length,
    });
    for (const item of items) {
      listData.push({ type: "action", item });
    }
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={listData}
      keyExtractor={(item) =>
        item.type === "header" ? `hdr-${item.key}` : item.item._id
      }
      contentContainerClassName="p-4"
      ListHeaderComponent={
        openCount > 0 || criticalCount > 0 ? (
          <View className="flex-row gap-2 mb-4">
            {criticalCount > 0 && (
              <View className="rounded-full bg-fail/20 px-3 py-1">
                <Text className="text-[12px] font-semibold text-fail">
                  {criticalCount} critical
                </Text>
              </View>
            )}
            {openCount > 0 && (
              <View className="rounded-full bg-hivis/20 px-3 py-1">
                <Text className="text-[12px] font-semibold text-hivis">
                  {openCount} open
                </Text>
              </View>
            )}
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        if (item.type === "header") {
          return (
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-1.5 px-1">
              {item.label} ({item.count})
            </Text>
          );
        }
        return <ActionCard action={item.item} />;
      }}
    />
  );
}
