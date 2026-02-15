import { useState, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { updateStageTemplate } from "../../lib/repositories";
import type { StageTemplate, InputSource, OutputFormat } from "../../lib/types";

interface StageTemplateEditorProps {
  onClose: () => void;
}

export function StageTemplateEditor({ onClose }: StageTemplateEditorProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[800px] max-w-[90vw] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">
            Stage Templates
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300"
          >
            &times;
          </button>
        </div>

        <StageTemplateEditorContent />
      </div>
    </div>
  );
}

export function StageTemplateEditorContent() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const { stageTemplates, loadStageTemplates } = useTaskStore();
  const [selectedId, setSelectedId] = useState<string | null>(
    stageTemplates[0]?.id ?? null,
  );
  const [editingTemplate, setEditingTemplate] = useState<StageTemplate | null>(
    null,
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const template = stageTemplates.find((t) => t.id === selectedId);
    if (template) {
      setEditingTemplate({ ...template });
    }
  }, [selectedId, stageTemplates]);

  const handleSave = async () => {
    if (!activeProject || !editingTemplate) return;
    await updateStageTemplate(activeProject.id, editingTemplate.id, {
      name: editingTemplate.name,
      description: editingTemplate.description,
      prompt_template: editingTemplate.prompt_template,
      input_source: editingTemplate.input_source,
      output_format: editingTemplate.output_format,
      gate_rules: editingTemplate.gate_rules,
    });
    await loadStageTemplates(activeProject.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!editingTemplate) return null;

  return (
    <div className="flex flex-1 min-h-0">
      {/* Stage List */}
      <div className="w-48 border-r border-zinc-800 overflow-y-auto">
        {stageTemplates.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedId(t.id)}
            className={`w-full text-left px-3 py-2 text-sm ${
              selectedId === t.id
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800/50"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Edit Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Name</label>
          <input
            value={editingTemplate.name}
            onChange={(e) =>
              setEditingTemplate({
                ...editingTemplate,
                name: e.target.value,
              })
            }
            className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">
            Description
          </label>
          <input
            value={editingTemplate.description}
            onChange={(e) =>
              setEditingTemplate({
                ...editingTemplate,
                description: e.target.value,
              })
            }
            className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              Input Source
            </label>
            <select
              value={editingTemplate.input_source}
              onChange={(e) =>
                setEditingTemplate({
                  ...editingTemplate,
                  input_source: e.target.value as InputSource,
                })
              }
              className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-3 py-1.5 text-sm"
            >
              <option value="user">User</option>
              <option value="previous_stage">Previous Stage</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              Output Format
            </label>
            <select
              value={editingTemplate.output_format}
              onChange={(e) =>
                setEditingTemplate({
                  ...editingTemplate,
                  output_format: e.target.value as OutputFormat,
                })
              }
              className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-3 py-1.5 text-sm"
            >
              <option value="text">Text</option>
              <option value="options">Options</option>
              <option value="checklist">Checklist</option>
              <option value="structured">Structured</option>
              <option value="research">Research (Q&A)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">
            Prompt Template
          </label>
          <textarea
            value={editingTemplate.prompt_template}
            onChange={(e) =>
              setEditingTemplate({
                ...editingTemplate,
                prompt_template: e.target.value,
              })
            }
            rows={12}
            className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 resize-none"
          />
          <p className="text-[10px] text-zinc-600 mt-1">
            Variables: {"{{task_description}}"}, {"{{previous_output}}"},
            {"{{user_input}}"}, {"{{user_decision}}"}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="text-xs text-emerald-400">Saved</span>
          )}
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
