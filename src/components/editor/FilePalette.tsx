import { useState, useEffect, useRef, useCallback } from "react";
import { File, GitCompareArrows } from "lucide-react";
import { runGit } from "../../lib/git";
import { useEditorStore } from "../../stores/editorStore";

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

interface PaletteEntry {
  /** Relative path for display/matching */
  relativePath: string;
  isDiff: boolean;
}

export function FilePalette() {
  const visible = useEditorStore((s) => s.quickOpenVisible);
  const setQuickOpen = useEditorStore((s) => s.setQuickOpen);
  const worktreeRoot = useEditorStore((s) => s.worktreeRoot);
  const openFile = useEditorStore((s) => s.openFile);
  const openDiffFile = useEditorStore((s) => s.openDiffFile);
  const changedFiles = useEditorStore((s) => s.changedFiles);
  const loadChangedFiles = useEditorStore((s) => s.loadChangedFiles);

  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load file list + changed files when palette opens
  useEffect(() => {
    if (!visible || !worktreeRoot) return;
    setQuery("");
    setSelectedIndex(0);

    // Load changed files if not already loaded
    if (changedFiles.length === 0) {
      loadChangedFiles();
    }

    runGit(worktreeRoot, "ls-files")
      .then((output) => {
        const allFiles = output.trim().split("\n").filter((f) => f.length > 0);
        setEntries(allFiles.map((relativePath) => ({ relativePath, isDiff: false })));
      })
      .catch(() => setEntries([]));
  }, [visible, worktreeRoot]);

  // Focus input when visible
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  // Build combined list: changed files (diff) first, then all files
  const diffEntries: PaletteEntry[] = changedFiles.map((f) => ({
    relativePath: f.path,
    isDiff: true,
  }));
  const allEntries = [...diffEntries, ...entries];

  const filtered = query
    ? allEntries.filter((e) => fuzzyMatch(query, e.relativePath))
    : allEntries;

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const select = useCallback(
    (entry: PaletteEntry) => {
      if (!worktreeRoot) return;
      const fullPath = `${worktreeRoot}/${entry.relativePath}`;
      if (entry.isDiff) {
        openDiffFile(fullPath);
      } else {
        openFile(fullPath);
      }
      setQuickOpen(false);
    },
    [worktreeRoot, openFile, openDiffFile, setQuickOpen],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) select(filtered[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setQuickOpen(false);
      }
    },
    [filtered, selectedIndex, select, setQuickOpen],
  );

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center pt-[15%]"
      onClick={() => setQuickOpen(false)}
    >
      <div
        className="w-[500px] max-w-[90vw] h-fit max-h-[60vh] flex flex-col bg-popover border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="w-full px-3 py-2.5 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground"
          placeholder="Search files by name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div ref={listRef} className="overflow-y-auto max-h-[50vh]">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              No matching files
            </div>
          ) : (
            filtered.slice(0, 200).map((entry, i) => {
              const fileName = entry.relativePath.split("/").pop() ?? entry.relativePath;
              const dir = entry.relativePath.includes("/")
                ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/"))
                : "";
              const key = entry.isDiff ? `diff:${entry.relativePath}` : entry.relativePath;
              return (
                <button
                  key={key}
                  className={`flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm ${
                    i === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                  onClick={() => select(entry)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  {entry.isDiff ? (
                    <GitCompareArrows className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                  ) : (
                    <File className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">
                    {fileName}
                    {entry.isDiff && (
                      <span className="text-muted-foreground ml-1">(diff)</span>
                    )}
                  </span>
                  {dir && (
                    <span className="ml-auto text-xs text-muted-foreground truncate max-w-[200px]">
                      {dir}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
