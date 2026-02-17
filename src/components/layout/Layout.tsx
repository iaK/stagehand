import { Sidebar } from "./Sidebar";
import { PipelineView } from "../pipeline/PipelineView";

export function Layout() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0">
            <PipelineView />
          </div>
        </div>
      </div>
    </div>
  );
}
