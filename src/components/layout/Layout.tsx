import { useState, useEffect, useRef } from "react";
import { ProjectRail } from "./ProjectRail";
import { Sidebar } from "./Sidebar";
import { PipelineView } from "../pipeline/PipelineView";
import { PrReviewsPanel } from "../pr-reviews/PrReviewsPanel";
import { CommandPanel, addRecentTask } from "../CommandPanel";
import { SettingsModal, type ProjectSettingsSection } from "../settings/SettingsModal";
import { AppSettingsModal, type AppSettingsSection } from "../settings/AppSettingsModal";
import { useSettingsStore } from "@/stores/settingsStore";
import { usePrReviewsStore } from "@/stores/prReviewsStore";
import { useProjectStore } from "@/stores/projectStore";
import { useTaskStore } from "@/stores/taskStore";
import { matchesShortcut } from "@/lib/keybindings";

export function Layout() {
  const appSidebarPosition = useSettingsStore((s) => s.appSidebarPosition);
  const prReviewsOpen = usePrReviewsStore((s) => s.open);
  const [commandPanelOpen, setCommandPanelOpen] = useState(false);
  const [projectSettingsSection, setProjectSettingsSection] = useState<ProjectSettingsSection | null>(null);
  const [appSettingsSection, setAppSettingsSection] = useState<AppSettingsSection | null>(null);

  // Track recent tasks when activeTask changes
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTask = useTaskStore((s) => s.activeTask);
  const prevTaskRef = useRef<string | null>(null);

  useEffect(() => {
    const taskId = activeTask?.id ?? null;
    const projectId = activeProject?.id;
    if (taskId && projectId && taskId !== prevTaskRef.current) {
      prevTaskRef.current = taskId;
      addRecentTask(projectId, taskId);
    }
  }, [activeTask, activeProject]);

  // Global keybinding: Cmd+P opens command panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const kb = useSettingsStore.getState().keybindings;
      if (matchesShortcut(e, kb.quickOpen)) {
        e.preventDefault();
        e.stopPropagation();
        setCommandPanelOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", handler, true); // capture phase
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  return (
    <div className={`flex h-screen bg-background text-foreground ${appSidebarPosition === "right" ? "flex-row-reverse" : ""}`}>
      <ProjectRail />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0">
            {prReviewsOpen ? <PrReviewsPanel /> : <PipelineView />}
          </div>
        </div>
      </div>

      {commandPanelOpen && (
        <CommandPanel
          onClose={() => setCommandPanelOpen(false)}
          onOpenProjectSettings={(section) => setProjectSettingsSection(section ?? "project")}
          onOpenAppSettings={(section) => setAppSettingsSection(section ?? "appearance")}
          onOpenPrReviews={() => usePrReviewsStore.getState().setOpen(true)}
        />
      )}
      {projectSettingsSection !== null && (
        <SettingsModal onClose={() => setProjectSettingsSection(null)} initialSection={projectSettingsSection} />
      )}
      {appSettingsSection !== null && (
        <AppSettingsModal onClose={() => setAppSettingsSection(null)} initialSection={appSettingsSection} />
      )}
    </div>
  );
}
