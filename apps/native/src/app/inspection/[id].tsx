import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  QuestionField,
  type Question,
} from "@/components/inspection/QuestionField";
import { Icon } from "@/components/icon";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Sparkles } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Section = { id: string; title: string; questions: Question[] };

export default function InspectionRunner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspectionId = id as Id<"inspections">;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const data = useQuery(api.inspections.get, id ? { inspectionId } : "skip");
  const save = useMutation(api.inspections.saveResponses);
  const complete = useMutation(api.inspections.complete);

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score?: number; actions: number } | null>(
    null,
  );
  const seeded = useRef(false);

  useEffect(() => {
    if (data?.inspection && !seeded.current) {
      seeded.current = true;
      const init: Record<string, unknown> = {};
      for (const r of data.inspection.responses) init[r.questionId] = r.value;
      setAnswers(init);
    }
  }, [data]);

  const sections = (data?.sections ?? []) as Section[];
  const total = useMemo(
    () =>
      sections.reduce(
        (n, s) => n + s.questions.filter((q) => q.type !== "instruction").length,
        0,
      ),
    [sections],
  );
  const answered = Object.values(answers).filter(
    (v) => v != null && v !== "",
  ).length;
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  const done = result !== null;

  const persist = () => {
    const responses = Object.entries(answers).map(([questionId, value]) => ({
      questionId,
      value,
    }));
    return save({ inspectionId, responses });
  };

  const onComplete = async () => {
    setBusy(true);
    try {
      await persist();
      const res = await complete({ inspectionId });
      setResult({ score: res.score, actions: res.actionsCreated });
      Alert.alert(
        "Inspection complete",
        `Score: ${res.score ?? "—"}%\nCorrective actions: ${res.actionsCreated}`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (data === undefined) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        style={{ paddingTop: insets.top }}
      >
        <ActivityIndicator />
      </View>
    );
  }
  if (data === null) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        style={{ paddingTop: insets.top }}
      >
        <Text className="font-body text-muted-foreground">
          Inspection not found.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Field-instrument header: back · title · progress rail */}
      <View
        className="border-b-2 border-border bg-card"
        style={{ paddingTop: insets.top }}
      >
        <View className="flex-row items-center gap-1 px-2 pt-1">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            className="h-11 w-11 items-center justify-center rounded-lg active:bg-muted"
          >
            <Icon icon={ChevronLeft} className="h-6 w-6 text-foreground" />
          </Pressable>
          <Text
            numberOfLines={2}
            className="flex-1 pr-3 font-display text-[22px] uppercase leading-[24px] tracking-wide text-foreground"
          >
            {data.templateName}
          </Text>
        </View>

        <View className="px-4 pb-3 pt-2">
          <View className="mb-1.5 flex-row items-end justify-between">
            <Text className="font-label text-[12px] uppercase tracking-widest text-muted-foreground">
              {done ? "Submitted" : "Progress"}
            </Text>
            <Text className="font-body-semibold text-[13px] tabular-nums text-foreground">
              {answered}
              <Text className="text-muted-foreground"> / {total}</Text>
              {result?.score != null ? (
                <Text className="text-pass"> · {result.score}%</Text>
              ) : null}
            </Text>
          </View>
          <View className="h-2 overflow-hidden rounded-full bg-muted">
            <View
              className={`h-full rounded-full ${done ? "bg-pass" : "bg-hivis"}`}
              style={{ width: `${done ? 100 : pct}%` }}
            />
          </View>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-4 pb-40"
        contentInsetAdjustmentBehavior="never"
      >
        {/* Assistant hand-off — the one place the hi-vis accent invites action */}
        <Pressable
          onPress={() => router.push({ pathname: "/", params: { inspectionId } })}
          className="mb-7 flex-row items-center gap-2.5 rounded-xl border-2 border-hivis/45 bg-hivis/10 px-4 py-3.5 active:bg-hivis/20"
        >
          <Icon icon={Sparkles} className="h-[18px] w-[18px] text-hivis" />
          <View className="flex-1">
            <Text className="font-body-semibold text-[15px] text-foreground">
              Complete with the assistant
            </Text>
            <Text className="font-body text-[12px] text-muted-foreground">
              Let the AI fill this out, then review
            </Text>
          </View>
        </Pressable>

        {sections.map((section, si) => (
          <View key={section.id} className="mb-7">
            <View className="mb-4 flex-row items-center gap-3">
              <View className="h-7 w-7 items-center justify-center rounded-md bg-foreground">
                <Text className="font-display text-[14px] leading-none text-background">
                  {si + 1}
                </Text>
              </View>
              <Text className="font-heading text-[15px] uppercase tracking-wider text-foreground">
                {section.title}
              </Text>
              <View className="h-0.5 flex-1 rounded-full bg-border" />
            </View>
            {section.questions.map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                value={answers[q.id]}
                onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {/* Sticky action bar — Complete is the hero (hi-vis), Save is secondary */}
      <View
        className="absolute bottom-0 left-0 right-0 flex-row items-stretch gap-3 border-t-2 border-border bg-card px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 10 }}
      >
        <Pressable
          onPress={() => void persist()}
          disabled={busy}
          className="items-center justify-center rounded-xl border-2 border-border bg-background px-6 active:bg-muted"
        >
          <Text className="font-heading text-[15px] uppercase tracking-wide text-foreground">
            Save
          </Text>
        </Pressable>
        <Pressable
          onPress={onComplete}
          disabled={busy || done}
          className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl py-4 active:opacity-90 ${
            done ? "bg-pass" : "bg-hivis"
          }`}
        >
          {busy ? (
            <ActivityIndicator color="oklch(0.2 0.03 80)" />
          ) : (
            <Text
              className={`font-display text-[17px] uppercase tracking-wide ${
                done ? "text-on-fill" : "text-on-hivis"
              }`}
            >
              {done ? `Scored ${result?.score ?? "—"}%` : "Complete"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
