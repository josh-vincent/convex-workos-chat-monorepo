import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Camera, FileText, Paperclip, StickyNote, X } from "lucide-react-native";
import { Icon } from "@/components/icon";

export type Question = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  requireNote?: boolean;
  requirePhoto?: boolean;
  helpText?: string;
  options?: { label: string; flag?: boolean }[];
  min?: number;
  max?: number;
  unit?: string;
};

export type Attachment = {
  mediaId: string;
  url: string | null;
  kind?: string;
  name?: string | null;
};

type Props = {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
  note?: string;
  onNote?: (text: string) => void;
  attachments?: Attachment[];
  attaching?: boolean;
  attachingDoc?: boolean;
  onAttachPhoto?: () => void;
  onAttachDoc?: () => void;
  onRemove?: (mediaId: string) => void;
};

type Tone = "pass" | "fail" | "neutral";

const PLACEHOLDER = "oklch(0.6 0.01 80)";
const INPUT =
  "rounded-xl border-2 border-border bg-card px-3.5 py-3 font-body text-[16px] text-foreground";

function Segmented({
  cells,
  value,
  onChange,
}: {
  cells: { value: string; label: string; tone: Tone }[];
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-xl border-2 border-border bg-card">
      {cells.map((c, i) => {
        const selected = value === c.value;
        const fill = !selected
          ? "active:bg-muted"
          : c.tone === "pass"
            ? "bg-pass"
            : c.tone === "fail"
              ? "bg-fail"
              : "bg-foreground";
        const labelColor = !selected
          ? "text-muted-foreground"
          : c.tone === "neutral"
            ? "text-background"
            : "text-on-fill";
        return (
          <Pressable
            key={c.value}
            onPress={() => onChange(c.value)}
            className={`flex-1 items-center justify-center py-4 ${
              i > 0 ? "border-l-2 border-border" : ""
            } ${fill}`}
          >
            <Text
              className={`font-heading text-[16px] uppercase tracking-[1px] ${labelColor}`}
            >
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function OptionPill({
  label,
  flag,
  selected,
  onPress,
}: {
  label: string;
  flag?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const cls = selected
    ? flag
      ? "bg-fail border-fail"
      : "bg-foreground border-foreground"
    : flag
      ? "border-fail/40 bg-card active:bg-muted"
      : "border-border bg-card active:bg-muted";
  const text = selected
    ? flag
      ? "text-on-fill"
      : "text-background"
    : flag
      ? "text-fail"
      : "text-foreground";
  return (
    <Pressable
      onPress={onPress}
      className={`mr-2 mb-2 rounded-lg border-2 px-4 py-2.5 ${cls}`}
    >
      <Text className={`font-body-medium text-[14px] ${text}`}>{label}</Text>
    </Pressable>
  );
}

/** Compact inline icon button for the label row (note / camera / file). */
function IconButton({
  icon,
  count,
  busy,
  active,
  onPress,
}: {
  icon: typeof Camera;
  count?: number;
  busy?: boolean;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={6}
      className={`-mt-0.5 h-8 flex-row items-center gap-1 rounded-lg border px-2.5 active:bg-muted ${
        active ? "border-hivis bg-hivis/10" : "border-border bg-card"
      }`}
    >
      {busy ? (
        <ActivityIndicator size="small" />
      ) : (
        <Icon
          icon={icon}
          className={`h-4 w-4 ${active ? "text-hivis" : "text-muted-foreground"}`}
        />
      )}
      {count ? (
        <Text className="font-body-semibold text-[12px] tabular-nums text-foreground">
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Thumbnails({
  photos,
  onRemove,
}: {
  photos: Attachment[];
  onRemove: (id: string) => void;
}) {
  return (
    <View className="mt-2 flex-row flex-wrap gap-2">
      {photos.map((a) => (
        <View key={a.mediaId} className="relative">
          {a.url ? (
            <Image
              source={{ uri: a.url }}
              style={{ width: 44, height: 44, borderRadius: 6 }}
            />
          ) : (
            <View className="h-11 w-11 rounded-md bg-muted" />
          )}
          <Pressable
            onPress={() => onRemove(a.mediaId)}
            hitSlop={6}
            className="absolute -right-1.5 -top-1.5 h-[18px] w-[18px] items-center justify-center rounded-full bg-foreground"
          >
            <Icon icon={X} className="h-2.5 w-2.5 text-background" />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function DocChips({
  docs,
  onRemove,
}: {
  docs: Attachment[];
  onRemove: (id: string) => void;
}) {
  return (
    <View className="mt-2 gap-1.5">
      {docs.map((a) => (
        <View
          key={a.mediaId}
          className="flex-row items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2"
        >
          <Icon icon={FileText} className="h-4 w-4 text-muted-foreground" />
          <Text
            className="flex-1 font-body-medium text-[13px] text-foreground"
            numberOfLines={1}
          >
            {a.name ?? "Document"}
          </Text>
          <Pressable onPress={() => onRemove(a.mediaId)} hitSlop={6}>
            <Icon icon={X} className="h-4 w-4 text-muted-foreground" />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export function QuestionField({
  question: q,
  value,
  onChange,
  note,
  onNote,
  attachments = [],
  attaching,
  attachingDoc,
  onAttachPhoto,
  onAttachDoc,
  onRemove,
}: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const remove = onRemove ?? (() => {});

  if (q.type === "instruction") {
    return (
      <View className="mb-5 rounded-xl bg-muted px-4 py-3">
        <Text className="font-body text-[14px] leading-5 text-muted-foreground">
          {q.label}
        </Text>
        {q.helpText ? (
          <Text className="mt-1 font-body text-[13px] leading-5 text-muted-foreground">
            {q.helpText}
          </Text>
        ) : null}
      </View>
    );
  }

  const numeric =
    q.type === "number" || q.type === "temperature" || q.type === "slider";
  const photos = attachments.filter((a) => a.kind !== "doc");
  const docs = attachments.filter((a) => a.kind === "doc");

  // A failed item must be explained; templates can also force a note/evidence.
  const noteRequired = !!q.requireNote || value === "fail";
  const photoRequired = !!q.requirePhoto;
  const showNote = noteOpen || !!note || noteRequired;
  const noteMissing = noteRequired && !note?.trim();
  const photoMissing = photoRequired && attachments.length === 0;

  return (
    <View className="mb-6">
      <View className="mb-2.5 flex-row items-start gap-3">
        <Text className="flex-1 font-body-semibold text-[16px] leading-5 text-foreground">
          {q.label}
          {q.required ? <Text className="text-hivis"> *</Text> : null}
        </Text>
        <View className="flex-row gap-1.5">
          {onNote ? (
            <IconButton
              icon={StickyNote}
              active={!!note?.trim() || noteMissing}
              onPress={() => setNoteOpen((o) => !o)}
            />
          ) : null}
          {onAttachPhoto ? (
            <IconButton
              icon={Camera}
              count={photos.length}
              busy={attaching}
              onPress={onAttachPhoto}
            />
          ) : null}
          {onAttachDoc ? (
            <IconButton
              icon={Paperclip}
              count={docs.length}
              busy={attachingDoc}
              active={photoMissing}
              onPress={onAttachDoc}
            />
          ) : null}
        </View>
      </View>

      {q.type === "passFailNA" || q.type === "question" ? (
        <Segmented
          cells={[
            { value: "pass", label: "Pass", tone: "pass" },
            { value: "fail", label: "Fail", tone: "fail" },
            { value: "na", label: "N/A", tone: "neutral" },
          ]}
          value={typeof value === "string" ? value : undefined}
          onChange={onChange}
        />
      ) : q.type === "checkbox" ? (
        <Segmented
          cells={[
            { value: "yes", label: "Yes", tone: "pass" },
            { value: "no", label: "No", tone: "neutral" },
          ]}
          value={value === true ? "yes" : value === false ? "no" : undefined}
          onChange={(v) => onChange(v === "yes")}
        />
      ) : q.type === "multipleChoice" || q.type === "list" ? (
        <View className="flex-row flex-wrap">
          {(q.options ?? []).map((o) => (
            <OptionPill
              key={o.label}
              label={o.label}
              flag={o.flag}
              selected={value === o.label}
              onPress={() => onChange(o.label)}
            />
          ))}
        </View>
      ) : numeric ? (
        <View className="flex-row items-center gap-2">
          <TextInput
            keyboardType="numeric"
            value={value != null ? String(value) : ""}
            onChangeText={(t) => onChange(t === "" ? undefined : Number(t))}
            placeholder={
              q.min != null || q.max != null
                ? `${q.min ?? ""}–${q.max ?? ""}`
                : "0"
            }
            placeholderTextColor={PLACEHOLDER}
            className={`flex-1 ${INPUT} tabular-nums`}
          />
          {q.unit ? (
            <Text className="font-heading text-[18px] uppercase tracking-wide text-muted-foreground">
              {q.unit}
            </Text>
          ) : null}
        </View>
      ) : q.type === "date" || q.type === "datetime" ? (
        <TextInput
          value={typeof value === "string" ? value : ""}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={PLACEHOLDER}
          className={`${INPUT} tabular-nums`}
        />
      ) : q.type === "text" ? (
        <TextInput
          multiline
          value={typeof value === "string" ? value : ""}
          onChangeText={onChange}
          placeholder="Type a response…"
          placeholderTextColor={PLACEHOLDER}
          className={`min-h-14 ${INPUT}`}
        />
      ) : (
        <Text className="font-body text-[13px] text-muted-foreground">
          Attach a photo or document above.
        </Text>
      )}

      {/* Inline note — auto-shown when an answer fails or a note is required */}
      {onNote && showNote ? (
        <View className="mt-2">
          <TextInput
            multiline
            value={note ?? ""}
            onChangeText={onNote}
            placeholder={
              noteRequired ? "Add a note (required)…" : "Add a note…"
            }
            placeholderTextColor={PLACEHOLDER}
            className={`min-h-12 rounded-xl border-2 bg-card px-3.5 py-2.5 font-body text-[15px] text-foreground ${
              noteMissing ? "border-fail" : "border-border"
            }`}
          />
        </View>
      ) : null}

      {photoMissing ? (
        <Text className="mt-1.5 font-body-medium text-[12px] text-hivis">
          Evidence required — attach a photo or document.
        </Text>
      ) : null}

      {photos.length > 0 ? <Thumbnails photos={photos} onRemove={remove} /> : null}
      {docs.length > 0 ? <DocChips docs={docs} onRemove={remove} /> : null}

      {q.helpText ? (
        <Text className="mt-2 font-body text-[13px] leading-4 text-muted-foreground">
          {q.helpText}
        </Text>
      ) : null}
    </View>
  );
}
