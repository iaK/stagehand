import { useEffect } from "react";

interface ShortcutHandlers {
  onNewTask?: () => void;
  onRunStage?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+N: New task
      if (meta && e.key === "n") {
        e.preventDefault();
        handlers.onNewTask?.();
      }

      // Cmd+Enter: Run stage
      if (meta && e.key === "Enter") {
        e.preventDefault();
        handlers.onRunStage?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
