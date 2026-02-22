import { Sidebar } from "./Sidebar";
import { PipelineView } from "../pipeline/PipelineView";
import logoSrc from "../../assets/logo.png";

export function Layout() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0">
            <PipelineView />
          </div>
        </div>
        <img
          src={logoSrc}
          alt="Stagehand"
          className="absolute bottom-3 right-3 w-8 h-8 opacity-20 pointer-events-none select-none"
        />
      </div>
    </div>
  );
}
