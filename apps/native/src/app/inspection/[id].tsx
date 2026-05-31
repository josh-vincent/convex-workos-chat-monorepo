import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  QuestionField,
  type Attachment,
  type Question,
} from "@/components/inspection/QuestionField";
import { Icon } from "@/components/icon";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Sparkles } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  uploadAsync,
  FileSystemUploadType,
  writeAsStringAsync,
  cacheDirectory,
} from "expo-file-system/legacy";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
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
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const recordMedia = useMutation(api.media.record);
  const generateReport = useAction(api.reports.generate);
  const [reporting, setReporting] = useState(false);

  const onReport = async () => {
    if (reporting) return;
    setReporting(true);
    try {
      const { url } = await generateReport({ inspectionId });
      if (url) await Linking.openURL(url);
    } catch (e) {
      Alert.alert(
        "Report failed",
        e instanceof Error ? e.message : "Could not generate the report.",
      );
    } finally {
      setReporting(false);
    }
  };

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>(
    {},
  );
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score?: number; actions: number } | null>(
    null,
  );
  const seeded = useRef(false);

  const savedMediaIds = useMemo(
    () =>
      (data?.inspection.responses ?? []).flatMap(
        (r) => (r.mediaIds ?? []) as Id<"media">[],
      ),
    [data],
  );
  const mediaUrls = useQuery(
    api.media.urls,
    savedMediaIds.length ? { ids: savedMediaIds } : "skip",
  );

  useEffect(() => {
    if (data?.inspection && !seeded.current) {
      seeded.current = true;
      const initAns: Record<string, unknown> = {};
      const initNotes: Record<string, string> = {};
      const byId = new Map(
        (mediaUrls ?? []).map((m) => [m.mediaId as string, m]),
      );
      const initAtt: Record<string, Attachment[]> = {};
      for (const r of data.inspection.responses) {
        initAns[r.questionId] = r.value;
        if (r.note) initNotes[r.questionId] = r.note;
        const ids = (r.mediaIds ?? []) as Id<"media">[];
        if (ids.length) {
          initAtt[r.questionId] = ids.map((mid) => {
            const m = byId.get(mid as string);
            return {
              mediaId: mid as string,
              url: m?.url ?? null,
              kind: m?.kind,
              name: m?.name,
            };
          });
        }
      }
      setAnswers(initAns);
      setNotes(initNotes);
      setAttachments(initAtt);
    }
  }, [data, mediaUrls]);

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
    const ids = new Set([
      ...Object.keys(answers),
      ...Object.keys(notes),
      ...Object.keys(attachments),
    ]);
    const responses = [...ids].map((questionId) => ({
      questionId,
      value: answers[questionId],
      note: notes[questionId]?.trim() || undefined,
      mediaIds: (attachments[questionId] ?? []).map(
        (a) => a.mediaId as Id<"media">,
      ),
    }));
    return save({ inspectionId, responses });
  };

  const addAttachment = (questionId: string, att: Attachment) =>
    setAttachments((a) => ({
      ...a,
      [questionId]: [...(a[questionId] ?? []), att],
    }));

  // Photo: iOS gives HEIC; expo-image-picker's base64 is JPEG, so re-encode for the web.
  const attachPhoto = async (questionId: string) => {
    if (uploading || !data) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      base64: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setUploading(questionId);
    try {
      let uri = asset.uri;
      let contentType = asset.mimeType ?? "image/jpeg";
      if (asset.base64) {
        uri = `${cacheDirectory}evidence-${Date.now()}.jpg`;
        await writeAsStringAsync(uri, asset.base64, { encoding: "base64" });
        contentType = "image/jpeg";
      }
      const saved = await upload(uri, contentType, "photo");
      addAttachment(questionId, { ...saved, kind: "photo" });
    } catch (e) {
      uploadError(e);
    } finally {
      setUploading(null);
    }
  };

  // Paperwork: any document (PDF, etc.) → uploaded as-is, shown as a file chip.
  const attachDoc = async (questionId: string) => {
    if (uploadingDoc || !data) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setUploadingDoc(questionId);
    try {
      const saved = await upload(
        asset.uri,
        asset.mimeType ?? "application/octet-stream",
        "doc",
        asset.name,
      );
      addAttachment(questionId, { ...saved, kind: "doc", name: asset.name });
    } catch (e) {
      uploadError(e);
    } finally {
      setUploadingDoc(null);
    }
  };

  const upload = async (
    uri: string,
    contentType: string,
    kind: "photo" | "doc",
    name?: string,
  ) => {
    if (!data) throw new Error("Inspection not loaded");
    const uploadUrl = await generateUploadUrl();
    const up = await uploadAsync(uploadUrl, uri, {
      httpMethod: "POST",
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": contentType },
    });
    const { storageId } = JSON.parse(up.body) as { storageId: Id<"_storage"> };
    const saved = await recordMedia({
      orgId: data.inspection.orgId,
      storageId,
      kind,
      name,
    });
    return {
      mediaId: saved.mediaId as string,
      url: saved.url,
      name: saved.name,
    };
  };

  const uploadError = (e: unknown) =>
    Alert.alert(
      "Upload failed",
      e instanceof Error ? e.message : "Could not attach the file.",
    );

  const removeAttachment = (questionId: string, mediaId: string) =>
    setAttachments((a) => ({
      ...a,
      [questionId]: (a[questionId] ?? []).filter((m) => m.mediaId !== mediaId),
    }));

  // Items that can't be submitted yet: a fail/required note without a note, or
  // required evidence with nothing attached.
  const outstanding = useMemo(() => {
    const out: string[] = [];
    for (const s of sections) {
      for (const q of s.questions) {
        if (q.type === "instruction") continue;
        const noteReq = q.requireNote || answers[q.id] === "fail";
        if (noteReq && !notes[q.id]?.trim()) out.push(`${q.label} — needs a note`);
        if (q.requirePhoto && (attachments[q.id] ?? []).length === 0)
          out.push(`${q.label} — needs evidence`);
      }
    }
    return out;
  }, [sections, answers, notes, attachments]);

  const onComplete = async () => {
    if (outstanding.length > 0) {
      Alert.alert(
        "Not ready to submit",
        `${outstanding.length} item${outstanding.length > 1 ? "s need" : " needs"} attention:\n\n• ${outstanding.slice(0, 6).join("\n• ")}`,
      );
      return;
    }
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
                note={notes[q.id]}
                onNote={(t) => setNotes((n) => ({ ...n, [q.id]: t }))}
                attachments={attachments[q.id] ?? []}
                attaching={uploading === q.id}
                attachingDoc={uploadingDoc === q.id}
                onAttachPhoto={() => attachPhoto(q.id)}
                onAttachDoc={() => attachDoc(q.id)}
                onRemove={(mid) => removeAttachment(q.id, mid)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 right-0 flex-row items-stretch gap-3 border-t-2 border-border bg-card px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 10 }}
      >
        <Pressable
          onPress={() => (done ? onReport() : void persist())}
          disabled={busy || reporting}
          className="min-w-[92px] items-center justify-center rounded-xl border-2 border-border bg-background px-6 active:bg-muted"
        >
          {reporting ? (
            <ActivityIndicator />
          ) : (
            <Text className="font-heading text-[15px] uppercase tracking-wide text-foreground">
              {done ? "Report" : "Save"}
            </Text>
          )}
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
