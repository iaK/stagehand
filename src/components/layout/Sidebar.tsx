import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { TaskList } from "../task/TaskList";
import { TaskCreate } from "../task/TaskCreate";
import { ProjectCreate } from "../project/ProjectCreate";
import { StageTemplateEditor } from "../project/StageTemplateEditor";
import type { Task } from "../../lib/types";

export function Sidebar() {
  const { projects, activeProject, loadProjects, setActiveProject } =
    useProjectStore();
  const { loadTasks, loadStageTemplates } = useTaskStore();
  const [showTaskCreate, setShowTaskCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (activeProject) {
      loadTasks(activeProject.id);
      loadStageTemplates(activeProject.id);
    }
  }, [activeProject, loadTasks, loadStageTemplates]);

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
            <button
              onClick={() => setShowTaskCreate(true)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              + New
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          <TaskList onEdit={setEditingTask} />
        </div>
      </div>

      {/* Settings */}
      {activeProject && (
        <div className="p-3 border-t border-zinc-800">
          <button
            onClick={() => setShowTemplateEditor(true)}
            className="w-full text-left text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Stage Templates
          </button>
        </div>
      )}

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
      {showTemplateEditor && activeProject && (
        <StageTemplateEditor onClose={() => setShowTemplateEditor(false)} />
      )}
    </div>
  );
}
