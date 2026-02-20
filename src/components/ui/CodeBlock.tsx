import { useState, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { codeToHtml } from "shiki";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const { resolvedTheme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const shikiTheme = resolvedTheme === "dark" ? "github-dark" : "github-light";

  useEffect(() => {
    let cancelled = false;
    setHtml(null);

    codeToHtml(code, {
      lang: language || "text",
      theme: shikiTheme,
    })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        // If highlighting fails (e.g. unknown language), leave as plain
      });

    return () => {
      cancelled = true;
    };
  }, [code, language, shikiTheme]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <div className="relative group">
      {language && (
        <div className="flex items-center justify-between px-4 py-1.5 text-xs text-muted-foreground bg-zinc-100 dark:bg-zinc-800 rounded-t-lg border border-b-0 border-border">
          <span>{language}</span>
        </div>
      )}
      <div className="relative">
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 z-10 px-2 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-300 dark:hover:bg-zinc-600"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        {html ? (
          <div
            ref={containerRef}
            className={`overflow-x-auto text-sm [&_pre]:!p-4 [&_pre]:!m-0 ${language ? "[&_pre]:!rounded-t-none [&_pre]:!rounded-b-lg" : "[&_pre]:!rounded-lg"} [&_pre]:!overflow-x-auto`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className={`p-4 overflow-x-auto text-sm bg-zinc-50 dark:bg-zinc-900 border border-border text-foreground ${language ? "rounded-t-none rounded-b-lg border-t-0" : "rounded-lg"}`}>
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
