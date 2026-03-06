import { useState, useEffect, useRef } from "react";
import { ProjectRail } from "./ProjectRail";
import { Sidebar } from "./Sidebar";
import { PipelineView } from "../pipeline/PipelineView";
import { PrReviewsPanel } from "../pr-reviews/PrReviewsPanel";
import { CommandPanel, addRecentTask } from "../CommandPanel";
import { SettingsModal } from "../settings/SettingsModal";
import { AppSettingsModal } from "../settings/AppSettingsModal";
import { useSettingsStore } from "@/stores/settingsStore";
import { usePrReviewsStore } from "@/stores/prReviewsStore";
import { useProjectStore } from "@/stores/projectStore";
import { useTaskStore } from "@/stores/taskStore";
import { matchesShortcut } from "@/lib/keybindings";

export function Layout() {
  const appSidebarPosition = useSettingsStore((s) => s.appSidebarPosition);
  const prReviewsOpen = usePrReviewsStore((s) => s.open);
  const [commandPanelOpen, setCommandPanelOpen] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);

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
          onOpenProjectSettings={() => setShowProjectSettings(true)}
          onOpenAppSettings={() => setShowAppSettings(true)}
          onOpenPrReviews={() => usePrReviewsStore.getState().setOpen(true)}
        />
      )}
      {showProjectSettings && (
        <SettingsModal onClose={() => setShowProjectSettings(false)} />
      )}
      {showAppSettings && (
        <AppSettingsModal onClose={() => setShowAppSettings(false)} />
      )}
    </div>
  );
}
