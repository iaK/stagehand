import { useEffect, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useLinearStore } from "../../stores/linearStore";
import { useGitHubStore } from "../../stores/githubStore";
import { TaskList } from "../task/TaskList";
import { TaskCreate } from "../task/TaskCreate";
import { ProjectCreate } from "../project/ProjectCreate";
import { LinearImport } from "../linear/LinearImport";
import { SettingsModal } from "../settings/SettingsModal";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { logger } from "../../lib/logger";
import logoSrc from "../../assets/logo.png";

export function Sidebar() {
  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => s.activeProject);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const projectStatuses = useProjectStore((s) => s.projectStatuses);
  const loadProjectStatuses = useProjectStore((s) => s.loadProjectStatuses);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const tasks = useTaskStore((s) => s.tasks);
  const taskExecStatuses = useTaskStore((s) => s.taskExecStatuses);
  const loadStageTemplates = useTaskStore((s) => s.loadStageTemplates);
  const [showTaskCreate, setShowTaskCreate] = useState(false);
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const [showLinearImport, setShowLinearImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { apiKey: linearApiKey, loadForProject: loadLinearForProject } = useLinearStore();
  const loadGitHubForProject = useGitHubStore((s) => s.loadForProject);

  useEffect(() => {
    loadProjects().catch((err) =>
      logger.error("Failed to load projects:", err),
    );
  }, [loadProjects]);

  useEffect(() => {
    if (activeProject) {
      loadTasks(activeProject.id)
        .catch((err) => logger.error("Failed to load tasks:", err));
      loadStageTemplates(activeProject.id).catch((err) =>
        logger.error("Failed to load stage templates:", err),
      );
      loadLinearForProject(activeProject.id).catch((err) =>
        logger.error("Failed to load Linear settings:", err),
      );
      loadGitHubForProject(activeProject.id, activeProject.path).catch((err) =>
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
    <div className="w-64 flex-shrink-0 border-r border-border bg-muted/30 flex flex-col">
      {/* Header + Project Selector */}
      <div className="px-3 border-b border-border flex items-center h-[57px] gap-2.5">
        <img src={logoSrc} alt="Stagehand" className="w-6 h-6 flex-shrink-0" />
        <div className="w-px h-5 bg-border flex-shrink-0" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Select
            value={activeProject?.id ?? ""}
            onValueChange={(value) => {
              const p = projects.find((p) => p.id === value);
              setActiveProject(p ?? null);
            }}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="No projects" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${projectStatuses[p.id] ?? "bg-zinc-400"}`}
                    />
                    {p.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowProjectCreate(true)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Project</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Tasks */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            Tasks
          </span>
          {activeProject && (
            <div className="flex items-center gap-2">
              {linearApiKey && (
                <Button
                  variant="link"
                  size="xs"
                  onClick={() => setShowLinearImport(true)}
                  className="text-violet-600 dark:text-violet-400"
                >
                  Import
                </Button>
              )}
              <Button
                variant="link"
                size="xs"
                onClick={() => setShowTaskCreate(true)}
                className="text-blue-600 dark:text-blue-400"
              >
                + New
              </Button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          <TaskList />
        </div>
      </div>

      {/* Footer */}
      <Separator />
      <div className="px-3 py-2 flex items-center justify-between">
        <button
          onClick={() => setShowSettings(true)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
        <ThemeToggle />
      </div>

      {/* Modals */}
      {showTaskCreate && activeProject && (
        <TaskCreate
          projectId={activeProject.id}
          onClose={() => setShowTaskCreate(false)}
        />
      )}
      {showProjectCreate && (
        <ProjectCreate onClose={() => setShowProjectCreate(false)} />
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
