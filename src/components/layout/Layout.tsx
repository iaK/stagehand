import { ProjectRail } from "./ProjectRail";
import { Sidebar } from "./Sidebar";
import { PipelineView } from "../pipeline/PipelineView";
import { useSettingsStore } from "@/stores/settingsStore";

export function Layout() {
  const appSidebarPosition = useSettingsStore((s) => s.appSidebarPosition);

  return (
    <div className={`flex h-screen bg-background text-foreground ${appSidebarPosition === "right" ? "flex-row-reverse" : ""}`}>
      <ProjectRail />
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
