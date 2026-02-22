import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import type { PendingCommit } from "../../stores/processStore";

interface CommitWorkflowProps {
  pendingCommit: PendingCommit | null;
  stageId: string;
  commitMessage: string;
  setCommitMessage: (msg: string) => void;
  commitError: string | null;
  committing: boolean;
  onCommit: () => void;
  noChangesToCommit: boolean;
  outputHasOwnActionButton: boolean;
  onApprove: () => void;
  approving: boolean;
  commitPrepTimedOut: boolean;
  onAskAgentToFix?: () => void;
  agentFixRunning?: boolean;
}

export function CommitWorkflow({
  pendingCommit,
  stageId,
  commitMessage,
  setCommitMessage,
  commitError,
  committing,
  onCommit,
  noChangesToCommit,
  outputHasOwnActionButton,
  onApprove,
  approving,
  commitPrepTimedOut,
  onAskAgentToFix,
  agentFixRunning,
}: CommitWorkflowProps) {
  if (pendingCommit?.stageId === stageId) {
    return (
      <div className="mt-4 p-4 bg-muted/50 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          <span className="text-sm font-medium text-foreground">
            Commit Changes
          </span>
        </div>

        {pendingCommit.diffStat && (
          <pre className="text-xs text-muted-foreground bg-zinc-50 dark:bg-zinc-900 border border-border rounded p-2 mb-3 overflow-x-auto">
            {pendingCommit.diffStat}
          </pre>
        )}

        <Textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          rows={3}
          className="font-mono mb-3 resize-none"
        />

        {commitError && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{commitError}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2">
          {agentFixRunning ? (
            <Button size="sm" variant="outline" disabled>
              <Loader2 className="w-4 h-4 animate-spin" />
              Agent fixing...
            </Button>
          ) : (
            <>
              <Button
                onClick={onCommit}
                disabled={committing || !commitMessage.trim()}
                size="sm"
                variant="success"
              >
                {committing && <Loader2 className="w-4 h-4 animate-spin" />}
                {committing ? "Committing..." : "Commit & Continue"}
              </Button>
              {commitError && onAskAgentToFix && (
                <Button
                  onClick={onAskAgentToFix}
                  size="sm"
                  variant="outline"
                >
                  Ask agent to fix
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (noChangesToCommit) {
    if (outputHasOwnActionButton) return null;
    return (
      <Button
        variant="success"
        onClick={onApprove}
        disabled={approving}
        className="mt-4"
      >
        {approving && <Loader2 className="w-4 h-4 animate-spin" />}
        {approving ? "Approving..." : "Approve & Continue"}
      </Button>
    );
  }

  if (outputHasOwnActionButton) return null;

  if (commitPrepTimedOut) {
    return (
      <Button
        variant="success"
        onClick={onApprove}
        disabled={approving}
        className="mt-4"
      >
        {approving && <Loader2 className="w-4 h-4 animate-spin" />}
        {approving ? "Approving..." : "Approve & Continue"}
      </Button>
    );
  }

  return (
    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" />
      Preparing commit...
    </div>
  );
}
