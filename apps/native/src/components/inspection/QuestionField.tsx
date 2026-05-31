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

function Chip({
  label,
  selected,
  tone,
  onPress,
}: {
  label: string;
  selected: boolean;
  tone?: "pass" | "fail" | "default";
  onPress: () => void;
}) {
  const sel =
    tone === "pass"
      ? "bg-green-600 border-green-600"
      : tone === "fail"
        ? "bg-red-600 border-red-600"
        : "bg-foreground border-foreground";
  return (
    <Pressable
      onPress={onPress}
      className={`mr-2 mb-2 rounded-full border px-4 py-2 ${
        selected ? sel : "border-border bg-card active:bg-muted"
      }`}
    >
      <Text
        className={`text-[13px] ${selected ? "text-background" : "text-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function QuestionField({ question: q, value, onChange }: Props) {
  if (q.type === "instruction") {
    return (
      <View className="mb-4">
        <Text className="text-[15px] text-muted-foreground">{q.label}</Text>
        {q.helpText ? (
          <Text className="mt-1 text-[13px] text-muted-foreground">
            {q.helpText}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className="mb-5">
      <Text className="mb-2 text-[15px] font-medium text-foreground">
        {q.label}
        {q.required ? <Text className="text-red-600"> *</Text> : null}
        {q.unit ? (
          <Text className="text-muted-foreground"> ({q.unit})</Text>
        ) : null}
      </Text>

      {q.type === "passFailNA" || q.type === "question" ? (
        <View className="flex-row flex-wrap">
          <Chip
            label="Pass"
            tone="pass"
            selected={value === "pass"}
            onPress={() => onChange("pass")}
          />
          <Chip
            label="Fail"
            tone="fail"
            selected={value === "fail"}
            onPress={() => onChange("fail")}
          />
          <Chip
            label="N/A"
            selected={value === "na"}
            onPress={() => onChange("na")}
          />
        </View>
      ) : q.type === "multipleChoice" || q.type === "list" ? (
        <View className="flex-row flex-wrap">
          {(q.options ?? []).map((o) => (
            <Chip
              key={o.label}
              label={o.label}
              tone={o.flag ? "fail" : "default"}
              selected={value === o.label}
              onPress={() => onChange(o.label)}
            />
          ))}
        </View>
      ) : q.type === "checkbox" ? (
        <View className="flex-row items-center gap-3">
          <Switch
            value={value === true}
            onValueChange={(v) => onChange(v)}
          />
          <Text className="text-foreground">{value ? "Yes" : "No"}</Text>
        </View>
      ) : q.type === "number" ||
        q.type === "temperature" ||
        q.type === "slider" ? (
        <TextInput
          keyboardType="numeric"
          value={value != null ? String(value) : ""}
          onChangeText={(t) => onChange(t === "" ? undefined : Number(t))}
          placeholder={
            q.min != null || q.max != null ? `${q.min ?? ""}–${q.max ?? ""}` : "0"
          }
          placeholderTextColor="#9ca3af"
          className="rounded-xl border border-border bg-card px-3 py-2.5 text-[15px] text-foreground"
        />
      ) : q.type === "date" || q.type === "datetime" ? (
        <TextInput
          value={typeof value === "string" ? value : ""}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9ca3af"
          className="rounded-xl border border-border bg-card px-3 py-2.5 text-[15px] text-foreground"
        />
      ) : q.type === "text" ? (
        <TextInput
          multiline
          value={typeof value === "string" ? value : ""}
          onChangeText={onChange}
          placeholder="Type a response…"
          placeholderTextColor="#9ca3af"
          className="min-h-12 rounded-xl border border-border bg-card px-3 py-2.5 text-[15px] text-foreground"
        />
      ) : (
        // signature / photo / media / drawing / assetScan / siteSelect / address
        <Text className="rounded-xl border border-dashed border-border px-3 py-2.5 text-[13px] text-muted-foreground">
          {q.type} — captured in the field (not in this demo)
        </Text>
      )}

      {q.helpText ? (
        <Text className="mt-1 text-[12px] text-muted-foreground">
          {q.helpText}
        </Text>
      ) : null}
    </View>
  );
}
