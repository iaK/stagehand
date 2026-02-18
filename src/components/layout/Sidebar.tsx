import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useLinearStore } from "../../stores/linearStore";
import { TaskList } from "../task/TaskList";
import { TaskCreate } from "../task/TaskCreate";
import { ProjectCreate } from "../project/ProjectCreate";
import { LinearImport } from "../linear/LinearImport";
import { SettingsModal } from "../settings/SettingsModal";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { sendNotification } from "../../lib/notifications";
import type { Project, Task } from "../../lib/types";

export function Sidebar() {
  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => s.activeProject);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const archiveProject = useProjectStore((s) => s.archiveProject);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const loadStageTemplates = useTaskStore((s) => s.loadStageTemplates);
  const [showTaskCreate, setShowTaskCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const [showLinearImport, setShowLinearImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null);
  const { apiKey: linearApiKey, loadForProject: loadLinearForProject } = useLinearStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (activeProject) {
      loadTasks(activeProject.id).catch((err) =>
        console.error("Failed to load tasks:", err),
      );
      loadStageTemplates(activeProject.id).catch((err) =>
        console.error("Failed to load stage templates:", err),
      );
      loadLinearForProject(activeProject.id).catch((err) =>
        console.error("Failed to load Linear settings:", err),
      );
    }
  }, [activeProject, loadTasks, loadStageTemplates, loadLinearForProject]);

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    await archiveProject(archiveTarget.id);
    sendNotification("Project archived", archiveTarget.name, "success", { projectId: archiveTarget.id });
    setArchiveTarget(null);
  };

  return (
    <div className="w-64 flex-shrink-0 border-r border-border bg-muted/30 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">Stagehand</h1>
        <p className="text-xs text-muted-foreground mt-1">AI Development Workflow</p>
      </div>

      {/* Project Selector */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2">
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
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeProject && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setArchiveTarget(activeProject)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive Project</TooltipContent>
            </Tooltip>
          )}
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
                  className="text-violet-600"
                >
                  Import
                </Button>
              )}
              <Button
                variant="link"
                size="xs"
                onClick={() => setShowTaskCreate(true)}
                className="text-blue-600"
              >
                + New
              </Button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          <TaskList onEdit={setEditingTask} />
        </div>
      </div>

      {/* Settings */}
      <Separator />
      <div className="p-3">
        <button
          onClick={() => setShowSettings(true)}
          className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>

      {/* Modals */}
      {showTaskCreate && activeProject && (
        <TaskCreate
          projectId={activeProject.id}
          onClose={() => setShowTaskCreate(false)}
        />
      )}
      {editingTask && activeProject && (
        <TaskCreate
          projectId={activeProject.id}
          task={editingTask}
          onClose={() => setEditingTask(null)}
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

      {/* Archive Project Confirmation */}
      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive <span className="font-medium text-foreground">"{archiveTarget?.name}"</span>? You can unarchive it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmArchive}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
