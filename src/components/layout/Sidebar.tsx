import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useLinearStore } from "../../stores/linearStore";
import { useGitHubStore } from "../../stores/githubStore";
import { TaskList } from "../task/TaskList";
import { TaskCreate } from "../task/TaskCreate";
import { ProjectCreate } from "../project/ProjectCreate";
import { LinearImport } from "../linear/LinearImport";
import { SettingsModal } from "../settings/SettingsModal";
import type { Project, Task } from "../../lib/types";

export function Sidebar() {
  const {
    projects,
    activeProject,
    loadProjects,
    setActiveProject,
    archiveProject,
  } = useProjectStore();
  const { loadTasks, loadStageTemplates } = useTaskStore();
  const [showTaskCreate, setShowTaskCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const [showLinearImport, setShowLinearImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null);
  const { apiKey: linearApiKey, loadForProject: loadLinearForProject } = useLinearStore();
  const { loadForProject: loadGitHubForProject } = useGitHubStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (activeProject) {
      loadTasks(activeProject.id);
      loadStageTemplates(activeProject.id);
      loadLinearForProject(activeProject.id);
      loadGitHubForProject(activeProject.id);
    }
  }, [activeProject, loadTasks, loadStageTemplates, loadLinearForProject, loadGitHubForProject]);

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    await archiveProject(archiveTarget.id);
    setArchiveTarget(null);
  };

  return (
    <div className="w-64 flex-shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-100">Stagehand</h1>
        <p className="text-xs text-zinc-500 mt-1">AI Development Workflow</p>
      </div>

      {/* Project Selector */}
      <div className="p-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <select
            value={activeProject?.id ?? ""}
            onChange={(e) => {
              const p = projects.find((p) => p.id === e.target.value);
              setActiveProject(p ?? null);
            }}
            className="flex-1 bg-zinc-800 text-zinc-200 text-sm rounded px-2 py-1.5 border border-zinc-700 focus:outline-none focus:border-blue-500"
          >
            {projects.length === 0 && (
              <option value="">No projects</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {activeProject && (
            <button
              onClick={() => setArchiveTarget(activeProject)}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
              title="Archive Project"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setShowProjectCreate(true)}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="New Project"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Tasks */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">
            Tasks
          </span>
          {activeProject && (
            <div className="flex items-center gap-2">
              {linearApiKey && (
                <button
                  onClick={() => setShowLinearImport(true)}
                  className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  Import
                </button>
              )}
              <button
                onClick={() => setShowTaskCreate(true)}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                + New
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          <TaskList onEdit={setEditingTask} />
        </div>
      </div>

      {/* Settings */}
      <div className="p-3 border-t border-zinc-800">
        <button
          onClick={() => setShowSettings(true)}
          className="w-full text-left text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-2"
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
      {archiveTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[400px] max-w-[90vw]">
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">Archive Project</h2>
            <p className="text-sm text-zinc-400 mb-6">
              Are you sure you want to archive <span className="text-zinc-200">"{archiveTarget.name}"</span>? You can unarchive it later.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setArchiveTarget(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmArchive}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
