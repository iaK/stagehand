import { useEffect, useState, useCallback, useRef } from "react";
import { useTheme } from "next-themes";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useLinearStore } from "../../stores/linearStore";
import { useGitHubStore } from "../../stores/githubStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { TaskList } from "../task/TaskList";
import { TaskCreate } from "../task/TaskCreate";
import { LinearImport } from "../linear/LinearImport";
import { SettingsModal } from "../settings/SettingsModal";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { logger } from "../../lib/logger";

export function Sidebar() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const loadProjectStatuses = useProjectStore((s) => s.loadProjectStatuses);
  const loadProjectLogos = useProjectStore((s) => s.loadProjectLogos);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const tasks = useTaskStore((s) => s.tasks);
  const taskExecStatuses = useTaskStore((s) => s.taskExecStatuses);
  const loadStageTemplates = useTaskStore((s) => s.loadStageTemplates);
  const [showTaskCreate, setShowTaskCreate] = useState(false);
  const [showLinearImport, setShowLinearImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { apiKey: linearApiKey, loadForProject: loadLinearForProject } = useLinearStore();
  const loadGitHubForProject = useGitHubStore((s) => s.loadForProject);

  useEffect(() => {
    loadProjects()
      .then(() => loadProjectLogos())
      .catch((err) => logger.error("Failed to load projects:", err));
  }, [loadProjects, loadProjectLogos]);

  // Track previous project to detect actual project switches
  const prevProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeProject) {
      const projectId = activeProject.id;
      const isSwitch = prevProjectIdRef.current !== null && prevProjectIdRef.current !== projectId;
      prevProjectIdRef.current = projectId;

      loadTasks(projectId)
        .then(async () => {
          // Restore the last active task for this project
          const nav = useNavigationStore.getState();
          const persistedTaskId = await nav.getPersistedTaskId(projectId);
          if (persistedTaskId) {
            const tasks = useTaskStore.getState().tasks;
            const found = tasks.find((t) => t.id === persistedTaskId);
            if (found) {
              useTaskStore.getState().setActiveTask(found);
            } else if (isSwitch) {
              // Persisted task no longer exists and we switched projects — clear
              useTaskStore.getState().setActiveTask(null);
            }
          } else if (isSwitch) {
            // No persisted task for this project — clear
            useTaskStore.getState().setActiveTask(null);
          }
        })
        .catch((err) => logger.error("Failed to load tasks:", err));
      loadStageTemplates(projectId).catch((err) =>
        logger.error("Failed to load stage templates:", err),
      );
      loadLinearForProject(projectId).catch((err) =>
        logger.error("Failed to load Linear settings:", err),
      );
      loadGitHubForProject(projectId, activeProject.path).catch((err) =>
        logger.error("Failed to load GitHub settings:", err),
      );
    }
  }, [activeProject, loadTasks, loadStageTemplates, loadLinearForProject, loadGitHubForProject]);

  // Refresh project status dots whenever tasks or execution statuses change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadProjectStatuses().catch((err) =>
        logger.error("Failed to load project statuses:", err),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [tasks, taskExecStatuses, loadProjectStatuses]);

  return (
    <div className="w-56 flex-shrink-0 border-r border-border bg-muted/30 flex flex-col">
      {/* Tasks */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-3 h-[57px] shrink-0">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Tasks
          </span>
          {activeProject && (
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      setSearchOpen((v) => !v);
                      if (searchOpen) setSearchQuery("");
                    }}
                    className={`p-1 rounded transition-colors ${
                      searchOpen
                        ? "text-foreground bg-accent"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Search</TooltipContent>
              </Tooltip>
              {linearApiKey && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowLinearImport(true)}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Import from Linear</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowTaskCreate(true)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent>New Task</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pt-2">
          <TaskList searchOpen={searchOpen} query={searchQuery} onQueryChange={setSearchQuery} />
        </div>
      </div>

      {/* Footer */}
      <Separator />
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowSettings(true)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <line x1="4" y1="21" x2="4" y2="14" />
                  <line x1="4" y1="10" x2="4" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12" y2="3" />
                  <line x1="20" y1="21" x2="20" y2="16" />
                  <line x1="20" y1="12" x2="20" y2="3" />
                  <line x1="1" y1="14" x2="7" y2="14" />
                  <line x1="9" y1="8" x2="15" y2="8" />
                  <line x1="17" y1="16" x2="23" y2="16" />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent>Project Settings</TooltipContent>
          </Tooltip>
        </div>
        <ThemeToggle />
      </div>

      {/* Modals */}
      {showTaskCreate && activeProject && (
        <TaskCreate
          projectId={activeProject.id}
          onClose={() => setShowTaskCreate(false)}
        />
      )}
      {showLinearImport && activeProject && (
        <LinearImport
          projectId={activeProject.id}
          onClose={() => setShowLinearImport(false)}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

    </div>
  );
}

const themeOrder = ["system", "light", "dark"] as const;

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycle = useCallback(() => {
    const idx = themeOrder.indexOf(theme as (typeof themeOrder)[number]);
    setTheme(themeOrder[(idx + 1) % themeOrder.length]);
  }, [theme, setTheme]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={cycle}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
        >
          {theme === "dark" ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : theme === "light" ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System"}
      </TooltipContent>
    </Tooltip>
  );
}
