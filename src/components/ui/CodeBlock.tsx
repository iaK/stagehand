import { useState, useEffect, useRef, useMemo } from "react";
import { useTheme } from "next-themes";
import { codeToHtml } from "shiki";

function detectLanguage(code: string): string | undefined {
  const trimmed = code.trimStart();

  // PHP — check before XML since <?php matches <[\w?!]
  if (/^<\?php/.test(trimmed)) return "php";

  // XML / HTML — starts with a tag or declaration
  if (/^<[\w?!]/.test(trimmed)) {
    if (/<!DOCTYPE\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) return "html";
    return "xml";
  }

  // JSON — starts with { or [
  if (/^[\[{]/.test(trimmed)) {
    try { JSON.parse(code); return "json"; } catch { /* not json */ }
  }

  // YAML — key: value on the first line, or starts with ---
  if (/^---\s*$/.test(trimmed.split("\n")[0]) || /^\w[\w\s]*:\s/.test(trimmed)) return "yaml";

  // Shell — starts with shebang or common shell commands
  if (/^#!\s*\//.test(trimmed)) return "bash";
  if (/^(\$\s|npm |yarn |pnpm |brew |apt |sudo |curl |wget |git |cd |mkdir |chmod |export )/.test(trimmed)) return "bash";

  // SQL
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\s/i.test(trimmed)) return "sql";

  // CSS
  if (/^(@import|@media|@keyframes|[.#][\w-]+\s*\{|:\s*root\s*\{)/.test(trimmed)) return "css";

  // TypeScript / JavaScript heuristics
  if (/^(import\s|export\s|const\s|let\s|var\s|function\s|class\s|interface\s|type\s|enum\s|async\s|declare\s)/.test(trimmed)) {
    // TypeScript signals
    if (/:\s*(string|number|boolean|void|any|never|unknown|Record<|Array<|Promise<)/.test(code) ||
        /^(interface|type|enum|declare)\s/m.test(code) ||
        /<[A-Z]\w*>/.test(code)) {
      return "typescript";
    }
    return "javascript";
  }

  // Python
  if (/^(def |class |import |from |if __name__|print\(|#\s)/.test(trimmed)) return "python";

  // Go
  if (/^(package |func |import \(|type \w+ struct)/.test(trimmed)) return "go";

  // Rust
  if (/^(fn |pub fn |use |mod |struct |impl |let mut |enum )/.test(trimmed)) return "rust";

  // Dockerfile
  if (/^(FROM |ARG |RUN |CMD |COPY |ENV |EXPOSE |WORKDIR )/.test(trimmed)) return "dockerfile";

  // Diff / patch
  if (/^(diff --git|---\s+a\/|@@\s)/.test(trimmed)) return "diff";

  // Markdown
  if (/^#{1,6}\s/.test(trimmed)) return "markdown";

  return undefined;
}

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
  const resolvedLang = useMemo(() => language || detectLanguage(code) || "text", [language, code]);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);

    codeToHtml(code, {
      lang: resolvedLang,
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
  }, [code, resolvedLang, shikiTheme]);

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
