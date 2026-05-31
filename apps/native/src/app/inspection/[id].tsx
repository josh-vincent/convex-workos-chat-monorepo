import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  QuestionField,
  type Question,
} from "@/components/inspection/QuestionField";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

type Section = { id: string; title: string; questions: Question[] };

export default function InspectionRunner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspectionId = id as Id<"inspections">;
  const router = useRouter();

  const data = useQuery(
    api.inspections.get,
    id ? { inspectionId } : "skip",
  );
  const save = useMutation(api.inspections.saveResponses);
  const complete = useMutation(api.inspections.complete);

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score?: number; actions: number } | null>(
    null,
  );
  const seeded = useRef(false);

  // Seed local answers from any saved responses once.
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
  const answered = Object.values(answers).filter((v) => v != null && v !== "")
    .length;

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
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (data === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Inspection not found.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="p-4 pb-32">
        <Text className="text-2xl font-bold text-foreground">
          {data.templateName}
        </Text>
        <Text className="mb-4 mt-1 text-[13px] text-muted-foreground">
          {answered}/{total} answered
          {result?.score != null ? ` · scored ${result.score}%` : ""}
        </Text>

        {/* Complete a form by chatting with the assistant */}
        <Pressable
          onPress={() =>
            router.push({ pathname: "/", params: { inspectionId } })
          }
          className="mb-5 flex-row items-center justify-center rounded-2xl border border-foreground/30 bg-card px-4 py-3 active:bg-muted"
        >
          <Text className="text-[14px] font-medium text-foreground">
            ✨ Complete with the assistant
          </Text>
        </Pressable>

        {sections.map((section) => (
          <View key={section.id} className="mb-6">
            <Text className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </Text>
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

      <View className="absolute bottom-0 left-0 right-0 flex-row gap-3 border-t border-border bg-background px-4 pb-8 pt-3">
        <Pressable
          onPress={() => void persist()}
          disabled={busy}
          className="flex-1 items-center justify-center rounded-2xl border border-border bg-card py-3 active:bg-muted"
        >
          <Text className="font-semibold text-foreground">Save draft</Text>
        </Pressable>
        <Pressable
          onPress={onComplete}
          disabled={busy}
          className="flex-1 items-center justify-center rounded-2xl bg-foreground py-3 active:opacity-80"
        >
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="font-semibold text-background">Complete</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
