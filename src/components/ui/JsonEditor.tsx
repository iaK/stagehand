import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "next-themes";
import { codeToHtml } from "shiki";

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
}

export function JsonEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
}: JsonEditorProps) {
  const { resolvedTheme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const shikiTheme = resolvedTheme === "dark" ? "github-dark" : "github-light";

  // Auto-resize textarea to fit content
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 72)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  useEffect(() => {
    if (!value) {
      setHtml(null);
      return;
    }

    let cancelled = false;
    codeToHtml(value, {
      lang: "json",
      theme: shikiTheme,
    })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [value, shikiTheme]);

  return (
    <div className={`relative ${className ?? ""}`}>
      {/* Syntax-highlighted layer — matches textarea size exactly */}
      {html && (
        <div
          ref={highlightRef}
          aria-hidden
          className="absolute inset-0 pointer-events-none overflow-hidden rounded-md [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!font-mono [&_pre]:!text-xs [&_pre]:!leading-[1.45] [&_pre]:!p-2 [&_pre]:!whitespace-pre-wrap [&_pre]:!break-words [&_code]:!text-xs [&_code]:!leading-[1.45]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {/* Editable textarea — transparent text when highlighted, visible caret */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="relative w-full p-2 font-mono text-xs leading-[1.45] bg-transparent border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-ring whitespace-pre-wrap break-words"
        style={{
          color: html ? "transparent" : undefined,
          caretColor: resolvedTheme === "dark" ? "#e4e4e7" : "#18181b",
          overflow: "hidden",
        }}
        spellCheck={false}
      />
    </div>
  );
}
