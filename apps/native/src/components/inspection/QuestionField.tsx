import { Pressable, Switch, Text, TextInput, View } from "react-native";

export type Question = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  helpText?: string;
  options?: { label: string; flag?: boolean }[];
  min?: number;
  max?: number;
  unit?: string;
};

type Props = {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
};

type Tone = "pass" | "fail" | "neutral";

/** Field-instrument segmented control — full-width cells, big targets, one bar. */
function Segmented({
  cells,
  value,
  onChange,
}: {
  cells: { value: string; label: string; tone: Tone }[];
  value: unknown;
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

/** Selectable option pill (multiple choice / list). Flag = "risk" option. */
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

const INPUT =
  "rounded-xl border-2 border-border bg-card px-3.5 py-3 font-body text-[16px] text-foreground";

export function QuestionField({ question: q, value, onChange }: Props) {
  // Instructions read as quiet guidance, not a question.
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

  return (
    <View className="mb-6">
      <Text className="mb-2.5 font-body-semibold text-[16px] leading-5 text-foreground">
        {q.label}
        {q.required ? <Text className="text-hivis"> *</Text> : null}
      </Text>

      {q.type === "passFailNA" || q.type === "question" ? (
        <Segmented
          cells={[
            { value: "pass", label: "Pass", tone: "pass" },
            { value: "fail", label: "Fail", tone: "fail" },
            { value: "na", label: "N/A", tone: "neutral" },
          ]}
          value={value}
          onChange={onChange}
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
      ) : q.type === "checkbox" ? (
        <View className="flex-row items-center justify-between rounded-xl border-2 border-border bg-card px-4 py-3">
          <Text className="font-body-medium text-[15px] text-foreground">
            {value ? "Yes" : "No"}
          </Text>
          <Switch value={value === true} onValueChange={(v) => onChange(v)} />
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
            placeholderTextColor="oklch(0.6 0.01 80)"
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
          placeholderTextColor="oklch(0.6 0.01 80)"
          className={`${INPUT} tabular-nums`}
        />
      ) : q.type === "text" ? (
        <TextInput
          multiline
          value={typeof value === "string" ? value : ""}
          onChangeText={onChange}
          placeholder="Type a response…"
          placeholderTextColor="oklch(0.6 0.01 80)"
          className={`min-h-14 ${INPUT}`}
        />
      ) : (
        // signature / photo / media / drawing / assetScan / siteSelect / address
        <View className="rounded-xl border-2 border-dashed border-border px-4 py-3.5">
          <Text className="font-body text-[13px] text-muted-foreground">
            Captured in the field — {q.type}
          </Text>
        </View>
      )}

      {q.helpText && q.type !== "instruction" ? (
        <Text className="mt-2 font-body text-[13px] leading-4 text-muted-foreground">
          {q.helpText}
        </Text>
      ) : null}
    </View>
  );
}
