import { useEffect, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import { ChevronLeft, Plus, Settings, Moon, Sun, Monitor } from "lucide-react";
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
  const activeTask = useTaskStore((s) => s.activeTask);
  const setActiveTask = useTaskStore((s) => s.setActiveTask);
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
              useTaskStore.getState().setActiveTask(null);
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
                <Plus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Project</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Tasks */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              Tasks
            </span>
            {activeTask && (
              <button
                onClick={() => setActiveTask(null)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
              >
                <ChevronLeft className="w-3 h-3" />
                Project
              </button>
            )}
          </div>
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
          <Settings className="w-3.5 h-3.5" />
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
            <Moon className="w-3.5 h-3.5" />
          ) : theme === "light" ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Monitor className="w-3.5 h-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System"}
      </TooltipContent>
    </Tooltip>
  );
}
