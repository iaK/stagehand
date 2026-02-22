import { useState, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { updateStageTemplate } from "../../lib/repositories";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendNotification } from "../../lib/notifications";
import { isSpecialStage } from "../../lib/repositories";
import { AVAILABLE_AGENTS } from "../../lib/agents";
import type { StageTemplate, OutputFormat } from "../../lib/types";

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
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
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
      gate_rules: editingTemplate.gate_rules,
      persona_system_prompt: editingTemplate.persona_system_prompt,
      persona_model: editingTemplate.persona_model,
      agent: editingTemplate.agent,
      allowed_tools: editingTemplate.allowed_tools,
      output_schema: editingTemplate.output_schema,
      requires_user_input: editingTemplate.requires_user_input,
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

      <div>
        <Label>AI Agent</Label>
        <Select
          value={editingTemplate.agent ?? ""}
          onValueChange={(v) =>
            setEditingTemplate({
              ...editingTemplate,
              agent: v === "" ? null : v,
            })
          }
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Project Default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Project Default</SelectItem>
            {AVAILABLE_AGENTS.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {editingTemplate.agent && editingTemplate.agent !== "claude" && (
          <div className="mt-1 space-y-0.5">
            {editingTemplate.output_schema && (
              <p className="text-xs text-amber-600 dark:text-amber-400">This agent does not support JSON schema output</p>
            )}
            {editingTemplate.persona_system_prompt && (
              <p className="text-xs text-amber-600 dark:text-amber-400">This agent does not support --append-system-prompt</p>
            )}
            {editingTemplate.allowed_tools && (() => { try { return JSON.parse(editingTemplate.allowed_tools!).length > 0; } catch { return false; } })() && (
              <p className="text-xs text-amber-600 dark:text-amber-400">This agent may not support tool restrictions</p>
            )}
            {editingTemplate.agent !== "amp" && (
              <p className="text-xs text-amber-600 dark:text-amber-400">This agent does not support MCP tools — stage context access will be unavailable</p>
            )}
          </div>
        )}
      </div>

      <div>
        <Label>Model Override</Label>
        <Input
          value={editingTemplate.persona_model ?? ""}
          onChange={(e) =>
            setEditingTemplate({
              ...editingTemplate,
              persona_model: e.target.value || null,
            })
          }
          placeholder="Optional — e.g. claude-sonnet-4-5-20250514"
          className="mt-1 font-mono text-xs"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={!!editingTemplate.requires_user_input}
          onCheckedChange={(v) =>
            setEditingTemplate({
              ...editingTemplate,
              requires_user_input: v ? 1 : 0,
            })
          }
        />
        Requires user input
      </label>

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
          Variables: {"{{task_description}}"}, {"{{user_input}}"},
          {"{{user_decision}}"}, {"{{prior_attempt_output}}"},
          {"{{available_stages}}"}. Prior stage summaries are auto-injected
          into the system prompt; use MCP tools for full outputs.
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
          onChange={(e) => {
            setEditingTemplate({
              ...editingTemplate,
              allowed_tools: e.target.value || null,
            });
            setToolsError(null);
          }}
          onBlur={(e) => {
            const val = e.target.value.trim();
            if (!val) { setToolsError(null); return; }
            try {
              const parsed = JSON.parse(val);
              if (!Array.isArray(parsed)) {
                setToolsError("Must be a JSON array, e.g. [\"Read\", \"Glob\"]");
              } else {
                setToolsError(null);
              }
            } catch {
              setToolsError("Invalid JSON");
            }
          }}
          placeholder='e.g. ["Read", "Glob", "Grep"] — empty for full access'
          className="mt-1 font-mono text-xs"
        />
        {toolsError && <p className="text-xs text-destructive mt-1">{toolsError}</p>}
      </div>

      <div>
        <Label>Output Schema (JSON)</Label>
        <Textarea
          value={editingTemplate.output_schema ?? ""}
          onChange={(e) => {
            setEditingTemplate({
              ...editingTemplate,
              output_schema: e.target.value || null,
            });
            setSchemaError(null);
          }}
          onBlur={(e) => {
            const val = e.target.value.trim();
            if (!val) { setSchemaError(null); return; }
            try {
              JSON.parse(val);
              setSchemaError(null);
            } catch {
              setSchemaError("Invalid JSON");
            }
          }}
          rows={4}
          className="mt-1 font-mono text-xs resize-none"
          placeholder="Optional JSON schema for structured output"
        />
        {schemaError && <p className="text-xs text-destructive mt-1">{schemaError}</p>}
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button onClick={handleSave} disabled={!editingTemplate.name.trim() || !!toolsError || !!schemaError}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}

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
      const maxOrder = Math.max(...stageTemplates.map((t) => t.sort_order), 0);
      const created = await createTemplate(activeProject.id, {
        project_id: activeProject.id,
        name: "New Stage",
        description: "",
        sort_order: maxOrder + 100,
        prompt_template: "Task: {{task_description}}\n\nReview the completed stages in your system prompt for context. Use the get_stage_output MCP tool to retrieve full details from any prior stage.",
        input_source: "previous_stage",
        output_format: "auto",
        output_schema: null,
        gate_rules: JSON.stringify({ type: "require_approval" }),
        persona_name: null,
        persona_system_prompt: null,
        persona_model: null,
        agent: null,
        preparation_prompt: null,
        allowed_tools: null,
        requires_user_input: 0,
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
                {!isSpecialStage(t.output_format as OutputFormat) && (
                  <>
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
                  </>
                )}
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
