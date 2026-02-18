import { useState, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { updateStageTemplate } from "../../lib/repositories";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sendNotification } from "../../lib/notifications";
import type { StageTemplate, InputSource, OutputFormat, ResultMode } from "../../lib/types";

interface StageTemplateEditorProps {
  onClose: () => void;
}

export function StageTemplateEditor({ onClose }: StageTemplateEditorProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] flex flex-col p-0" showCloseButton={false}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <DialogHeader className="p-0">
            <DialogTitle>Stage Templates</DialogTitle>
          </DialogHeader>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>

        <StageTemplateEditorContent />
      </DialogContent>
    </Dialog>
  );
}

export function SingleTemplateEditor({ templateId }: { templateId: string }) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const loadStageTemplates = useTaskStore((s) => s.loadStageTemplates);
  const [editingTemplate, setEditingTemplate] = useState<StageTemplate | null>(
    null,
  );
  useEffect(() => {
    const template = stageTemplates.find((t) => t.id === templateId);
    if (template) {
      setEditingTemplate({ ...template });
    }
  }, [templateId, stageTemplates]);

  const handleSave = async () => {
    if (!activeProject || !editingTemplate) return;
    await updateStageTemplate(activeProject.id, editingTemplate.id, {
      name: editingTemplate.name,
      description: editingTemplate.description,
      prompt_template: editingTemplate.prompt_template,
      input_source: editingTemplate.input_source,
      output_format: editingTemplate.output_format,
      gate_rules: editingTemplate.gate_rules,
      result_mode: editingTemplate.result_mode,
      persona_system_prompt: editingTemplate.persona_system_prompt,
      allowed_tools: editingTemplate.allowed_tools,
      output_schema: editingTemplate.output_schema,
      commits_changes: editingTemplate.commits_changes,
      creates_pr: editingTemplate.creates_pr,
      is_terminal: editingTemplate.is_terminal,
      triggers_stage_selection: editingTemplate.triggers_stage_selection,
      commit_prefix: editingTemplate.commit_prefix,
    });
    await loadStageTemplates(activeProject.id);
    sendNotification("Template saved", editingTemplate.name, "success", { projectId: activeProject.id });
  };

  if (!editingTemplate) return null;

  return (
    <div className="space-y-4">
      <div>
        <Label>Name</Label>
        <Input
          value={editingTemplate.name}
          onChange={(e) =>
            setEditingTemplate({
              ...editingTemplate,
              name: e.target.value,
            })
          }
          className="mt-1"
        />
      </div>

      <div>
        <Label>Description</Label>
        <Input
          value={editingTemplate.description}
          onChange={(e) =>
            setEditingTemplate({
              ...editingTemplate,
              description: e.target.value,
            })
          }
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Input Source</Label>
          <Select
            value={editingTemplate.input_source}
            onValueChange={(value) =>
              setEditingTemplate({
                ...editingTemplate,
                input_source: value as InputSource,
              })
            }
          >
            <SelectTrigger className="w-full mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="previous_stage">Previous Stage</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Output Format</Label>
          <Select
            value={editingTemplate.output_format}
            onValueChange={(value) =>
              setEditingTemplate({
                ...editingTemplate,
                output_format: value as OutputFormat,
              })
            }
          >
            <SelectTrigger className="w-full mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="options">Options</SelectItem>
              <SelectItem value="checklist">Checklist</SelectItem>
              <SelectItem value="structured">Structured</SelectItem>
              <SelectItem value="research">Research (Q&A)</SelectItem>
              <SelectItem value="plan">Plan (Q&A)</SelectItem>
              <SelectItem value="findings">Findings</SelectItem>
              <SelectItem value="pr_review">PR Review</SelectItem>
              <SelectItem value="merge">Merge</SelectItem>
              <SelectItem value="auto">Auto-detect</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Result Mode</Label>
          <Select
            value={editingTemplate.result_mode}
            onValueChange={(value) =>
              setEditingTemplate({
                ...editingTemplate,
                result_mode: value as ResultMode,
              })
            }
          >
            <SelectTrigger className="w-full mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="replace">Replace</SelectItem>
              <SelectItem value="append">Append</SelectItem>
              <SelectItem value="passthrough">Passthrough</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Commit Prefix</Label>
          <Input
            value={editingTemplate.commit_prefix ?? ""}
            onChange={(e) =>
              setEditingTemplate({
                ...editingTemplate,
                commit_prefix: e.target.value || null,
              })
            }
            placeholder="e.g. feat, fix"
            className="mt-1"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Behavior Flags</Label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={!!editingTemplate.commits_changes}
              onCheckedChange={(v) =>
                setEditingTemplate({
                  ...editingTemplate,
                  commits_changes: v ? 1 : 0,
                })
              }
            />
            Commits changes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={!!editingTemplate.creates_pr}
              onCheckedChange={(v) =>
                setEditingTemplate({
                  ...editingTemplate,
                  creates_pr: v ? 1 : 0,
                })
              }
            />
            Creates PR
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={!!editingTemplate.is_terminal}
              onCheckedChange={(v) =>
                setEditingTemplate({
                  ...editingTemplate,
                  is_terminal: v ? 1 : 0,
                })
              }
            />
            Terminal stage
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={!!editingTemplate.triggers_stage_selection}
              onCheckedChange={(v) =>
                setEditingTemplate({
                  ...editingTemplate,
                  triggers_stage_selection: v ? 1 : 0,
                })
              }
            />
            Stage selection
          </label>
        </div>
      </div>

      <div>
        <Label>Prompt Template</Label>
        <Textarea
          value={editingTemplate.prompt_template}
          onChange={(e) =>
            setEditingTemplate({
              ...editingTemplate,
              prompt_template: e.target.value,
            })
          }
          rows={12}
          className="mt-1 font-mono text-xs resize-none"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Variables: {"{{task_description}}"}, {"{{previous_output}}"},
          {"{{user_input}}"}, {"{{user_decision}}"}, {"{{stage_summaries}}"},
          {"{{stages.StageName.output}}"}, {"{{stages.StageName.summary}}"},
          {"{{all_stage_outputs}}"}, {"{{available_stages}}"}
        </p>
      </div>

      <div>
        <Label>Persona System Prompt</Label>
        <Textarea
          value={editingTemplate.persona_system_prompt ?? ""}
          onChange={(e) =>
            setEditingTemplate({
              ...editingTemplate,
              persona_system_prompt: e.target.value || null,
            })
          }
          rows={3}
          className="mt-1 font-mono text-xs resize-none"
          placeholder="Optional system prompt override"
        />
      </div>

      <div>
        <Label>Allowed Tools (JSON array)</Label>
        <Input
          value={editingTemplate.allowed_tools ?? ""}
          onChange={(e) =>
            setEditingTemplate({
              ...editingTemplate,
              allowed_tools: e.target.value || null,
            })
          }
          placeholder='e.g. ["Read", "Glob", "Grep"] — empty for full access'
          className="mt-1 font-mono text-xs"
        />
      </div>

      <div>
        <Label>Output Schema (JSON)</Label>
        <Textarea
          value={editingTemplate.output_schema ?? ""}
          onChange={(e) =>
            setEditingTemplate({
              ...editingTemplate,
              output_schema: e.target.value || null,
            })
          }
          rows={4}
          className="mt-1 font-mono text-xs resize-none"
          placeholder="Optional JSON schema for structured output"
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button onClick={handleSave}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}

/** @deprecated Use SingleTemplateEditor via SettingsModal instead */
export function StageTemplateEditorContent() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const createTemplate = useTaskStore((s) => s.createStageTemplate);
  const deleteTemplate = useTaskStore((s) => s.deleteStageTemplate);
  const duplicateTemplate = useTaskStore((s) => s.duplicateStageTemplate);
  const reorderTemplates = useTaskStore((s) => s.reorderStageTemplates);
  const [selectedId, setSelectedId] = useState<string | null>(
    stageTemplates[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  const handleNew = async () => {
    if (!activeProject) return;
    setError(null);
    try {
      const maxOrder = Math.max(...stageTemplates.map((t) => t.sort_order), -1);
      const created = await createTemplate(activeProject.id, {
        project_id: activeProject.id,
        name: "New Stage",
        description: "",
        sort_order: maxOrder + 1,
        prompt_template: "Task: {{task_description}}\n\n{{#if previous_output}}\nPrevious output:\n{{previous_output}}\n{{/if}}",
        input_source: "previous_stage",
        output_format: "text",
        output_schema: null,
        gate_rules: JSON.stringify({ type: "require_approval" }),
        persona_name: null,
        persona_system_prompt: null,
        persona_model: null,
        preparation_prompt: null,
        allowed_tools: null,
        result_mode: "replace",
        commits_changes: 0,
        creates_pr: 0,
        is_terminal: 0,
        triggers_stage_selection: 0,
        commit_prefix: null,
      });
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!activeProject) return;
    setError(null);
    try {
      await deleteTemplate(activeProject.id, id);
      if (selectedId === id) {
        setSelectedId(stageTemplates.find((t) => t.id !== id)?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDuplicate = async (id: string) => {
    if (!activeProject) return;
    setError(null);
    try {
      const created = await duplicateTemplate(activeProject.id, id);
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleMoveUp = async (id: string) => {
    if (!activeProject) return;
    const idx = stageTemplates.findIndex((t) => t.id === id);
    if (idx <= 0) return;
    const ids = stageTemplates.map((t) => t.id);
    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
    await reorderTemplates(activeProject.id, ids);
  };

  const handleMoveDown = async (id: string) => {
    if (!activeProject) return;
    const idx = stageTemplates.findIndex((t) => t.id === id);
    if (idx >= stageTemplates.length - 1) return;
    const ids = stageTemplates.map((t) => t.id);
    [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
    await reorderTemplates(activeProject.id, ids);
  };

  return (
    <div className="flex flex-1 min-h-0">
      <div className="w-56 border-r border-border flex flex-col">
        <div className="overflow-y-auto flex-1">
          {stageTemplates.map((t, idx) => (
            <div
              key={t.id}
              className={`group flex items-center px-2 py-1.5 text-sm ${
                selectedId === t.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <button
                onClick={() => setSelectedId(t.id)}
                className="flex-1 text-left truncate"
              >
                {t.name}
              </button>
              <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
                {idx > 0 && (
                  <button
                    onClick={() => handleMoveUp(t.id)}
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    title="Move up"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                )}
                {idx < stageTemplates.length - 1 && (
                  <button
                    onClick={() => handleMoveDown(t.id)}
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    title="Move down"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => handleDuplicate(t.id)}
                  className="p-0.5 text-muted-foreground hover:text-foreground"
                  title="Duplicate"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="p-0.5 text-muted-foreground hover:text-red-500"
                  title="Delete"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="p-2 border-t border-border">
          <Button variant="outline" size="sm" className="w-full" onClick={handleNew}>
            + New Stage
          </Button>
        </div>
        {error && (
          <div className="p-2">
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {selectedId && <SingleTemplateEditor templateId={selectedId} />}
      </div>
    </div>
  );
}
