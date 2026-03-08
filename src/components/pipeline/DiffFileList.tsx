import type { DiffFileStat } from "../../lib/git";

const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  M: { text: "M", color: "text-yellow-700 dark:text-yellow-300", bg: "bg-yellow-100 dark:bg-yellow-500/20" },
  A: { text: "A", color: "text-green-700 dark:text-green-300", bg: "bg-green-100 dark:bg-green-500/20" },
  D: { text: "D", color: "text-red-700 dark:text-red-300", bg: "bg-red-100 dark:bg-red-500/20" },
  R: { text: "R", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-500/20" },
  C: { text: "C", color: "text-purple-700 dark:text-purple-300", bg: "bg-purple-100 dark:bg-purple-500/20" },
  U: { text: "U", color: "text-orange-700 dark:text-orange-300", bg: "bg-orange-100 dark:bg-orange-500/20" },
};

const BLOCK_COUNT = 5;

function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return <span className="w-[60px]" />;

  const addBlocks = Math.round((additions / total) * BLOCK_COUNT);
  const delBlocks = BLOCK_COUNT - addBlocks;

  return (
    <span className="inline-flex gap-px ml-1.5">
      {Array.from({ length: addBlocks }, (_, i) => (
        <span key={`a${i}`} className="w-1.5 h-1.5 rounded-[1px] bg-green-500 dark:bg-green-400" />
      ))}
      {Array.from({ length: delBlocks }, (_, i) => (
        <span key={`d${i}`} className="w-1.5 h-1.5 rounded-[1px] bg-red-500 dark:bg-red-400" />
      ))}
    </span>
  );
}

interface DiffFileListProps {
  files: DiffFileStat[];
  maxHeight?: string;
}

export function DiffFileList({ files, maxHeight = "max-h-48" }: DiffFileListProps) {
  if (files.length === 0) return null;

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {files.length} file{files.length !== 1 ? "s" : ""} changed
        </span>
        {(totalAdditions > 0 || totalDeletions > 0) && (
          <span className="text-xs text-muted-foreground">
            {totalAdditions > 0 && (
              <span className="text-green-600 dark:text-green-400">+{totalAdditions}</span>
            )}
            {totalAdditions > 0 && totalDeletions > 0 && " "}
            {totalDeletions > 0 && (
              <span className="text-red-600 dark:text-red-400">-{totalDeletions}</span>
            )}
          </span>
        )}
      </div>
      <div className={`${maxHeight} overflow-y-auto rounded-md border border-border bg-zinc-50 dark:bg-zinc-900/60`}>
        {files.map((file) => {
          const fileName = file.path.split("/").pop() ?? file.path;
          const dirPath = file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : null;
          const st = STATUS_LABEL[file.status] ?? STATUS_LABEL.M;

          return (
            <div
              key={file.path}
              className="flex items-center gap-2 px-2.5 py-1 text-xs border-b border-border/50 last:border-b-0 hover:bg-accent/30 transition-colors"
            >
              <span className={`shrink-0 w-4 text-center text-xs font-semibold rounded px-0.5 ${st.color} ${st.bg}`}>
                {st.text}
              </span>
              <span className="truncate flex-1 font-mono text-foreground/90">
                {fileName}
                {dirPath && (
                  <span className="text-muted-foreground font-sans ml-1.5 text-xs">{dirPath}</span>
                )}
              </span>
              <span className="shrink-0 flex items-center gap-1 tabular-nums text-xs">
                {file.additions > 0 && (
                  <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                )}
                <ChangeBar additions={file.additions} deletions={file.deletions} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
