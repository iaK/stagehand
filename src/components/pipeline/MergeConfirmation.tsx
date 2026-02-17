import { useState } from "react";
import { useProcessStore } from "../../stores/processStore";
import { useStageExecution } from "../../hooks/useStageExecution";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Task } from "../../lib/types";

interface MergeConfirmationProps {
  task: Task;
}

export function MergeConfirmation({ task }: MergeConfirmationProps) {
  const pendingMerge = useProcessStore((s) => s.pendingMerge);
  const { performDirectMerge, skipMerge } = useStageExecution();
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pendingMerge) return null;

  const handleMerge = async () => {
    setMerging(true);
    setError(null);
    try {
      await performDirectMerge(task);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMerging(false);
    }
  };

  const handleSkip = async () => {
    await skipMerge(task);
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="p-4 bg-muted/50 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span className="text-sm font-medium text-foreground">
            Merge Branch
          </span>
        </div>

        <p className="text-sm text-muted-foreground mb-3">
          All stages complete. Merge <code className="font-mono text-foreground bg-zinc-100 px-1 rounded">{pendingMerge.branchName}</code> into <code className="font-mono text-foreground bg-zinc-100 px-1 rounded">{pendingMerge.targetBranch}</code>?
        </p>

        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleMerge}
            disabled={merging}
            size="sm"
          >
            {merging ? "Merging..." : "Merge & Push"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            disabled={merging}
          >
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}
