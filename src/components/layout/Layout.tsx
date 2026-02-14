import { Sidebar } from "./Sidebar";
import { PipelineView } from "../pipeline/PipelineView";
import { TerminalView } from "../pipeline/TerminalView";
import { StageHistory } from "../pipeline/StageHistory";
import { useTaskStore } from "../../stores/taskStore";
import { useState } from "react";

export function Layout() {
  const activeTask = useTaskStore((s) => s.activeTask);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0">
            <PipelineView onToggleHistory={() => setShowHistory(!showHistory)} />
          </div>
          {showHistory && activeTask && (
            <StageHistory />
          )}
        </div>
        <TerminalView />
      </div>
    </div>
  );
}
