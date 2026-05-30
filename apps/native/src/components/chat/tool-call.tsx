import { Text, View } from "react-native";
import type { ChatToolPart } from "./types";

// Static class strings so uniwind can extract them.
const STATES: Record<
  string,
  { label: string; badge: string; text: string; busy: boolean }
> = {
  "input-streaming": {
    label: "Preparing",
    badge: "bg-amber-100",
    text: "text-amber-700",
    busy: true,
  },
  "input-available": {
    label: "Running",
    badge: "bg-blue-100",
    text: "text-blue-700",
    busy: true,
  },
  "output-available": {
    label: "Done",
    badge: "bg-green-100",
    text: "text-green-700",
    busy: false,
  },
  "output-error": {
    label: "Error",
    badge: "bg-red-100",
    text: "text-red-700",
    busy: false,
  },
};

export function ToolCall({ tool }: { tool: ChatToolPart }) {
  const s = STATES[tool.state] ?? {
    label: tool.state || "tool",
    badge: "bg-muted",
    text: "text-muted-foreground",
    busy: false,
  };

  return (
    <View className="mb-2 overflow-hidden rounded-xl border border-border bg-card">
      <View className="flex-row items-center gap-2 px-3 py-2">
        <Text className="text-[13px] font-medium text-foreground">{`🛠 ${tool.name}`}</Text>
        <View className={`rounded-full px-2 py-0.5 ${s.badge}`}>
          <Text className={`text-[11px] ${s.text}`}>
            {s.busy ? `${s.label}…` : s.label}
          </Text>
        </View>
      </View>
      {tool.input != null && (
        <Text className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
          {JSON.stringify(tool.input, null, 2)}
        </Text>
      )}
      {tool.state === "output-available" && tool.output != null && (
        <Text className="border-t border-border px-3 py-2 text-[12px] text-foreground">
          {JSON.stringify(tool.output, null, 2)}
        </Text>
      )}
      {tool.state === "output-error" && (
        <Text className="border-t border-border px-3 py-2 text-[12px] text-red-600">
          {tool.errorText ?? "Tool error"}
        </Text>
      )}
    </View>
  );
}
