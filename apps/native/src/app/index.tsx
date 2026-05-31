import {
  ChatProvider,
  Conversation,
  ConversationScrollButton,
  Message,
  MessageResponse,
  PromptInput,
  PromptInputAction,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
  StreamingMessage,
  ToolCall,
  createStreamingStore,
  useChatContext,
  type ChatMessage,
  type ChatToolPart,
} from "@/components/chat";
import { Icon } from "@/components/icon";
import { MainHeader } from "@/components/main-header";
import { useAuth } from "@/auth/WorkOSAuthProvider";
import { Pressable, Text, View } from "react-native";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { fetch as expoFetch } from "expo/fetch";
import * as Haptics from "expo-haptics";
import { Link, useLocalSearchParams } from "expo-router";
import { Plus } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const USE_MOCK = process.env.EXPO_PUBLIC_MOCK_AI === "1";

/** Convex HTTP actions are served from the `.site` domain (or an explicit local URL). */
function chatApiUrl() {
  const site =
    process.env.EXPO_PUBLIC_CONVEX_SITE_URL ??
    (process.env.EXPO_PUBLIC_CONVEX_URL ?? "").replace(
      /\.convex\.cloud$/,
      ".convex.site",
    );
  return `${site}/chat`;
}

// Throttle interval for streaming UI updates (~30fps)
const STREAMING_THROTTLE_MS = 32;

const MOCK_RESPONSES = [
  "That's a great question! Here's what I think:\n\nThe key insight is that **simplicity** often beats complexity. When you break down the problem into smaller pieces, the solution becomes much clearer.\n\n```javascript\nconst answer = problems\n  .map(simplify)\n  .reduce(combine, []);\n```\n\nHope that helps!",
  "I'd be happy to help with that. Let me walk you through it step by step:\n\n1. **First**, identify the core requirements\n2. **Then**, design the interface\n3. **Finally**, implement and test\n\nThe most important thing is to start simple and iterate. You can always add more features later.",
  "Interesting! Here's a quick overview:\n\n> The best code is the code you don't have to write.\n\nThat said, when you *do* need to write code, keep these principles in mind:\n\n- **Readability** over cleverness\n- **Composition** over inheritance\n- **Explicit** over implicit\n\nLet me know if you want me to dive deeper into any of these!",
  "Sure thing! Here's a concise answer:\n\nThe approach I'd recommend is to use a **streaming architecture** where data flows through the system in real-time. This gives you:\n\n- Lower latency\n- Better resource utilization\n- Simpler error handling\n\n```python\nasync for chunk in stream:\n    process(chunk)\n```\n\nWant me to elaborate on any part?",
];

async function mockStreamResponse(
  text: string,
  onToken: (token: string) => void,
  signal?: AbortSignal,
) {
  const words = text.split(/(?<=\s)/);
  for (const word of words) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 40));
    onToken(word);
  }
}

/** Extract text content from a UIMessage's parts array. */
function getTextFromParts(
  parts: { type: string; text?: string }[],
): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("");
}

type RawPart = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** Extract tool-call parts (waiting / received / error) from a UIMessage. */
function getToolsFromParts(parts: RawPart[]): ChatToolPart[] {
  return parts
    .filter((p) => p.type === "dynamic-tool" || p.type.startsWith("tool-"))
    .map((p, i) => ({
      id: p.toolCallId ?? `tool-${i}`,
      name:
        p.type === "dynamic-tool"
          ? (p.toolName ?? "tool")
          : p.type.replace(/^tool-/, ""),
      state: p.state ?? "",
      input: p.input,
      output: p.output,
      errorText: p.errorText,
    }));
}

function useAIChat(inspectionId?: string) {
  const [input, setInput] = useState("");
  const streamingStore = useMemo(() => createStreamingStore(), []);
  const prevStreamingTextRef = useRef("");
  const { getToken } = useAuth();

  // Stream from the authenticated Convex /chat endpoint. expo/fetch supports
  // response-body streaming (React Native's global fetch does not). We wrap it
  // to attach the current auth token on every request.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: chatApiUrl(),
        // When an inspection is active, the server fills/completes it via tools.
        body: inspectionId ? { inspectionId } : undefined,
        fetch: (async (url: string, options?: RequestInit) => {
          const token = await getToken();
          const headers = {
            ...(options?.headers as Record<string, string> | undefined),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          };
          return expoFetch(url, { ...options, headers } as never);
        }) as unknown as typeof globalThis.fetch,
      }),
    [getToken, inspectionId],
  );

  const {
    messages: uiMessages,
    sendMessage,
    status,
    error,
  } = useChat({ transport });

  const isStreaming = status === "streaming";

  // Map UIMessages to ChatMessages
  const messages: ChatMessage[] = useMemo(() => {
    return uiMessages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content:
        isStreaming &&
        m.role === "assistant" &&
        m === uiMessages[uiMessages.length - 1]
          ? "" // Signal streaming — content comes from store
          : getTextFromParts(m.parts as { type: string; text?: string }[]),
      tools: getToolsFromParts(m.parts as RawPart[]),
    }));
  }, [uiMessages, isStreaming]);

  // Sync streaming text to the store
  useEffect(() => {
    if (!isStreaming) {
      if (prevStreamingTextRef.current) {
        prevStreamingTextRef.current = "";
        streamingStore.set("");
      }
      return;
    }
    const lastMessage = uiMessages[uiMessages.length - 1];
    if (lastMessage?.role === "assistant") {
      const text = getTextFromParts(
        lastMessage.parts as { type: string; text?: string }[],
      );
      if (text !== prevStreamingTextRef.current) {
        prevStreamingTextRef.current = text;
        streamingStore.set(text);
      }
    }
  }, [uiMessages, isStreaming, streamingStore]);

  const onSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage({ text: input });
    setInput("");
  }, [input, isStreaming, sendMessage]);

  return {
    messages,
    input,
    setInput,
    isGenerating: isStreaming,
    onSend,
    streamingStore,
    error: error ?? null,
  };
}

function useMockChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const streamingStore = useMemo(() => createStreamingStore(), []);
  const streamingRef = useRef("");
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mockIndexRef = useRef(0);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isGenerating) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: "",
    };

    const newMessages = [...messages, userMessage, assistantMessage];
    setMessages(newMessages);
    setInput("");
    setIsGenerating(true);

    streamingRef.current = "";
    streamingStore.set("");

    try {
      const mockText =
        MOCK_RESPONSES[mockIndexRef.current % MOCK_RESPONSES.length];
      mockIndexRef.current++;

      await mockStreamResponse(mockText, (token) => {
        streamingRef.current += token;
        if (!throttleRef.current) {
          throttleRef.current = setTimeout(() => {
            streamingStore.set(streamingRef.current);
            throttleRef.current = null;
          }, STREAMING_THROTTLE_MS);
        }
      });
    } catch (err) {
      console.error("Generation error:", err);
      streamingRef.current = "Error generating response";
    } finally {
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
      const finalContent = streamingRef.current;
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        updated[lastIdx] = {
          ...updated[lastIdx],
          content: finalContent,
        };
        return updated;
      });
      streamingRef.current = "";
      streamingStore.set("");
      setIsGenerating(false);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [input, isGenerating, messages, streamingStore]);

  return {
    messages,
    input,
    setInput,
    isGenerating,
    onSend: handleSend,
    streamingStore,
  };
}

const SUGGESTED_PROMPTS = [
  "What can you do?",
  "Explain React Server Components simply",
  "Write a haiku about the ocean",
];

function ChatEmptyState() {
  const { setInput } = useChatContext();
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text className="text-2xl font-semibold text-foreground">Chat</Text>
      <Text className="mt-2 text-center text-muted-foreground">
        Ask anything, or try one of these:
      </Text>
      <View className="mt-5 w-full gap-2">
        {SUGGESTED_PROMPTS.map((p) => (
          <Pressable
            key={p}
            onPress={() => setInput(p)}
            className="rounded-2xl border border-border bg-card px-4 py-3 active:bg-muted"
          >
            <Text className="text-foreground">{p}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function ChatScreen() {
  // An active inspection (passed from the runner's "Complete with the assistant").
  const params = useLocalSearchParams<{ inspectionId?: string }>();
  const inspectionId =
    typeof params.inspectionId === "string" ? params.inspectionId : undefined;
  // Call both hooks unconditionally (rules-of-hooks); select by the build-time flag.
  const aiChat = useAIChat(inspectionId);
  const mockChat = useMockChat();
  const chat = USE_MOCK ? mockChat : aiChat;
  const { isGenerating, streamingStore } = chat;

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      if (item.role === "user") {
        return <Message from="user">{item.content}</Message>;
      }

      const isStreaming = isGenerating && item.content === "";
      return (
        <Message from="assistant">
          {item.tools?.map((t) => (
            <ToolCall key={t.id} tool={t} />
          ))}
          {isStreaming ? (
            <StreamingMessage store={streamingStore} />
          ) : item.content ? (
            <MessageResponse>{item.content}</MessageResponse>
          ) : null}
        </Message>
      );
    },
    [isGenerating, streamingStore],
  );

  return (
    <>
      <ChatProvider value={chat}>
        <Conversation
          renderMessage={renderMessage}
          emptyState={<ChatEmptyState />}
        >
          <ConversationScrollButton />
          <PromptInput>
            <Link href="/attachments" asChild>
              <PromptInputAction>
                <Icon icon={Plus} className="w-5 h-5 text-muted-foreground" />
              </PromptInputAction>
            </Link>
            <PromptInputBody>
              <PromptInputTextarea />
              <PromptInputSubmit />
            </PromptInputBody>
          </PromptInput>
        </Conversation>
      </ChatProvider>
      <MainHeader />
    </>
  );
}
