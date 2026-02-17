import { useState, useRef, useEffect } from "react";
import { TextOutput } from "../output/TextOutput";
import { Textarea } from "@/components/ui/textarea";

interface MarkdownTextareaProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function MarkdownTextarea({
  value,
  onChange,
  readOnly = false,
  rows = 4,
  placeholder,
  autoFocus,
  className,
}: MarkdownTextareaProps) {
  const [isEditing, setIsEditing] = useState(() => {
    if (readOnly) return false;
    if (autoFocus) return true;
    return !value;
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  const minHeight = `${rows * 1.5 + 1.5}rem`;

  const handleBlur = () => {
    if (value.trim()) {
      setIsEditing(false);
    }
  };

  const handlePreviewClick = () => {
    if (!readOnly) {
      setIsEditing(true);
    }
  };

  const handlePreviewKeyDown = (e: React.KeyboardEvent) => {
    if (!readOnly && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setIsEditing(true);
    }
  };

  if (isEditing) {
    return (
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        rows={rows}
        placeholder={placeholder}
        className={`resize-none ${className ?? ""}`}
      />
    );
  }

  return (
    <div
      onClick={handlePreviewClick}
      onKeyDown={handlePreviewKeyDown}
      tabIndex={readOnly ? undefined : 0}
      role={readOnly ? undefined : "button"}
      style={{ minHeight }}
      className={`w-full bg-background border border-input rounded-md px-4 py-3 text-sm ${
        readOnly ? "" : "cursor-pointer hover:border-zinc-400"
      } focus:outline-none focus:border-ring ${className ?? ""}`}
    >
      {value ? (
        <TextOutput content={value} />
      ) : (
        placeholder && (
          <span className="text-muted-foreground">{placeholder}</span>
        )
      )}
    </div>
  );
}
