export type ChatToolPart = {
  id: string;
  name: string;
  // input-streaming | input-available | output-available | output-error
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ChatToolPart[];
};
