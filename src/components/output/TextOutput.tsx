import { Children, isValidElement } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { CodeBlock } from "../ui/CodeBlock";

interface TextOutputProps {
  content: string;
}

function extractText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText((node.props as { children?: unknown }).children);
  }
  return "";
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold text-foreground mt-8 mb-4">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold text-foreground mt-6 mb-3">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-medium text-foreground mt-5 mb-2">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed my-4">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-4 space-y-2 text-zinc-700 dark:text-zinc-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-4 space-y-2 text-zinc-700 dark:text-zinc-300">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{children}</li>
  ),
  pre: ({ children }) => {
    // Extract code text and language from the <code> child
    const codeChild = Children.toArray(children).find(
      (child) => isValidElement(child) && child.type === "code",
    );
    if (isValidElement(codeChild)) {
      const className = (codeChild.props as { className?: string }).className ?? "";
      const lang = className.replace("language-", "") || undefined;
      const text = extractText((codeChild.props as { children?: unknown }).children);
      return (
        <div className="my-5">
          <CodeBlock code={text} language={lang} />
        </div>
      );
    }
    return (
      <pre className="bg-zinc-50 dark:bg-zinc-900 border border-border rounded-lg p-4 my-5 overflow-x-auto text-sm">{children}</pre>
    );
  },
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      // Block code is handled by the pre override above
      return <code>{children}</code>;
    }
    return (
      <code className="bg-zinc-100 dark:bg-zinc-800 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded text-sm">{children}</code>
    );
  },
  hr: () => <hr className="border-border my-8" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-4 my-4 text-muted-foreground italic">{children}</blockquote>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  a: ({ children, href }) => (
    <a href={href} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto">
      <table className="min-w-full border-collapse border border-border text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-left text-foreground font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-3 py-2 text-zinc-700 dark:text-zinc-300">{children}</td>
  ),
};

export function TextOutput({ content }: TextOutputProps) {
  return (
    <div className="max-w-none [&>:first-child]:!mt-0 [&>:last-child]:!mb-0">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  );
}
