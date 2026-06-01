import { ActivityIndicator, Text, View } from "react-native";
import { Check, X } from "lucide-react-native";
import { Icon } from "@/components/icon";
import type { ChatToolPart } from "./types";

type Rec = Record<string, unknown>;

/** A boolean-ish answer rendered as a ✓/✗ toggle; anything else as plain text. */
function valueChip(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).toLowerCase();
  const truthy = value === true || ["pass", "yes", "true", "ok"].includes(s);
  const falsy = value === false || ["fail", "no", "false"].includes(s);
  const na = s === "na" || s === "n/a";

  if (truthy || falsy) {
    const label =
      value === true ? "Yes" : value === false ? "No" : String(value);
    return (
      <View
        className={`flex-row items-center gap-1 rounded-md px-2 py-1 ${
          truthy ? "bg-pass/15" : "bg-fail/15"
        }`}
      >
        <Icon
          icon={truthy ? Check : X}
          className={`h-3.5 w-3.5 ${truthy ? "text-pass" : "text-fail"}`}
        />
        <Text
          className={`font-body-medium text-[12px] capitalize ${
            truthy ? "text-pass" : "text-fail"
          }`}
        >
          {label}
        </Text>
      </View>
    );
  }
  return (
    <View className="rounded-md bg-muted px-2 py-1">
      <Text className="font-body-medium text-[12px] text-foreground" numberOfLines={1}>
        {na ? "N/A" : String(value)}
      </Text>
    </View>
  );
}

/** Turn a raw tool part into a plain-language command + optional trailing detail. */
function describe(tool: ChatToolPart): {
  title: string;
  detail?: string;
  value?: unknown;
} {
  const input = (tool.input ?? {}) as Rec;
  const output = (tool.output ?? {}) as Rec;
  switch (tool.name) {
    case "getInspectionForm": {
      const n =
        typeof output.questions === "number"
          ? output.questions
          : Array.isArray(output.sections)
            ? (output.sections as { questions?: unknown[] }[]).reduce(
                (a, s) => a + (s.questions?.length ?? 0),
                0,
              )
            : undefined;
      return { title: "Read the inspection form", detail: n ? `${n} questions` : undefined };
    }
    case "setAnswer":
      return {
        title: String(input.label ?? input.questionId ?? "Set answer"),
        value: input.value,
      };
    case "completeInspection": {
      const score = output.score;
      const actions = output.actionsCreated;
      return {
        title: "Complete inspection",
        detail:
          typeof score === "number"
            ? `Scored ${score}%${typeof actions === "number" ? ` · ${actions} actions` : ""}`
            : undefined,
      };
    }
    case "getWeather": {
      const t = output.temperatureC;
      const cond = output.condition;
      return {
        title: "Check the weather",
        detail:
          typeof t === "number"
            ? `${Math.round(t)}°C${cond ? ` · ${cond}` : ""}`
            : undefined,
      };
    }
    case "getCurrentLocation":
      return {
        title: "Get your location",
        detail: output.address ? String(output.address) : undefined,
      };
    case "getCurrentDateTime":
      return {
        title: "Read the date & time",
        detail: output.iso ? String(output.iso).slice(0, 16).replace("T", " ") : undefined,
      };
    case "getOutstandingRequired": {
      const n = output.count;
      return {
        title: "Check what's still needed",
        detail:
          typeof n === "number" ? (n === 0 ? "All required done" : `${n} remaining`) : undefined,
      };
    }
    case "findTemplates": {
      const n = Array.isArray(output.templates) ? output.templates.length : output.count;
      return {
        title: `Search templates: "${String(input.query ?? "")}"`,
        detail: typeof n === "number" ? `${n} found` : undefined,
      };
    }
    case "startInspection":
      return { title: "Start a new inspection" };
    case "checkCurrency": {
      const n = output.urgentCount;
      return {
        title: "Check register currency",
        detail: typeof n === "number" ? (n === 0 ? "All current" : `${n} need attention`) : undefined,
      };
    }
    case "raiseAction":
      return { title: `Raise action: ${String(input.title ?? "")}` };
    case "reportIncident":
      return {
        title: `Report incident${input.incidentType ? `: ${String(input.incidentType).replace("_", " ")}` : ""}`,
        detail: output.notifiable ? "Notifiable" : undefined,
      };
    case "lookupAsset":
      return {
        title: `Look up asset: ${String(input.qrCode ?? "")}`,
        detail: output.name ? String(output.name) : undefined,
      };
    case "reviewPhotos": {
      const n = output.photosAnalyzed;
      return {
        title: "Review attached photos",
        detail: typeof n === "number" ? `${n} analysed` : undefined,
      };
    }
    default:
      return { title: tool.name };
  }
}

export function ToolCall({ tool }: { tool: ChatToolPart }) {
  const busy =
    tool.state === "input-streaming" || tool.state === "input-available";
  const error = tool.state === "output-error";
  const { title, detail, value } = describe(tool);

  return (
    <View className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
      {/* Status lamp — amber while running, green done, red error */}
      {busy ? (
        <ActivityIndicator size="small" />
      ) : (
        <View
          className={`h-2 w-2 rounded-full ${error ? "bg-fail" : "bg-pass"}`}
        />
      )}

      <Text
        className="flex-1 font-body-medium text-[14px] text-foreground"
        numberOfLines={1}
      >
        {title}
      </Text>

      {error ? (
        <Text className="font-body-medium text-[12px] text-fail" numberOfLines={1}>
          {tool.errorText ?? "Failed"}
        </Text>
      ) : value !== undefined ? (
        valueChip(value)
      ) : detail ? (
        <Text
          className="font-body-medium text-[12px] text-muted-foreground"
          numberOfLines={1}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
}
