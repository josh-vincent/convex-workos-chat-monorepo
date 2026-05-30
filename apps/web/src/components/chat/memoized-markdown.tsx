"use client";

import { marked } from "marked";
import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

// Split the markdown into top-level blocks so each block can be memoized —
// during streaming only the changed (last) block re-parses/re-renders.
function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

const components: Components = {
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-[#1e1e1e] p-3 text-[13px] text-gray-100">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) =>
    className?.includes("language-") ? (
      <code className={className} {...props}>
        {children}
      </code>
    ) : (
      <code
        className="rounded bg-black/[0.06] px-1 py-0.5 text-[13px]"
        {...props}
      >
        {children}
      </code>
    ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-5">{children}</ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gray-300 pl-3 italic text-gray-600">
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-[#0D87E1] underline"
      target="_blank"
      rel="noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const MemoizedMarkdownBlock = memo(
  ({ content }: { content: string }) => (
    <ReactMarkdown components={components}>{content}</ReactMarkdown>
  ),
  (prev, next) => prev.content === next.content,
);
MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

export const MemoizedMarkdown = memo(
  ({ content, id }: { content: string; id: string }) => {
    const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);
    return (
      <div className="space-y-2 text-[15px] leading-relaxed">
        {blocks.map((block, index) => (
          <MemoizedMarkdownBlock content={block} key={`${id}-block_${index}`} />
        ))}
      </div>
    );
  },
);
MemoizedMarkdown.displayName = "MemoizedMarkdown";
