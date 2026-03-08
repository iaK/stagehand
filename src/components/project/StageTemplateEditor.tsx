import { useState, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { updateStageTemplate, getAgentModels, getProjectSetting } from "../../lib/repositories";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sendNotification } from "../../lib/notifications";
import { isSpecialStage } from "../../lib/repositories";
import { AVAILABLE_AGENTS } from "../../lib/agents";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StageTemplate, OutputFormat } from "../../lib/types";

const USER_SELECTABLE_FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "auto", label: "Auto (detect from output)" },
  { value: "text", label: "Text" },
  { value: "findings", label: "Findings (selectable items)" },
  { value: "options", label: "Options (choice cards)" },
  { value: "plan", label: "Plan" },
  { value: "checklist", label: "Checklist" },
  { value: "structured", label: "Structured (schema)" },
];

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
  const [agentModels, setAgentModels] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState(false);

  useEffect(() => {
    const template = stageTemplates.find((t) => t.id === templateId);
    if (template) {
      let schema = template.output_schema;
      if (schema) {
        try { schema = JSON.stringify(JSON.parse(schema), null, 2); } catch {}
      }
      setEditingTemplate({ ...template, output_schema: schema });
    }
  }, [templateId, stageTemplates]);

  // Load model list for the effective agent
  useEffect(() => {
    if (!activeProject || !editingTemplate) return;
    const resolveAgent = async () => {
      const agent = editingTemplate.agent
        ?? (await getProjectSetting(activeProject.id, "default_agent"))
        ?? "claude";
      const models = await getAgentModels(activeProject.id, agent);
      setAgentModels(models);
      // If current model is set but not in the list, show custom input
      const current = editingTemplate.persona_model;
      setCustomModel(!!current && !models.includes(current));
    };
    resolveAgent();
  }, [activeProject?.id, editingTemplate?.agent, editingTemplate?.id]);

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
      allowed_tools: editingTemplate.allowed_tools,
      output_schema: editingTemplate.output_schema
        ? (() => { try { return JSON.stringify(JSON.parse(editingTemplate.output_schema)); } catch { return editingTemplate.output_schema; } })()
        : null,
      output_format: editingTemplate.output_format,
      requires_user_input: editingTemplate.requires_user_input,
      agent: editingTemplate.agent,
      can_follow: editingTemplate.can_follow,
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

      {!isSpecialStage(editingTemplate.output_format as OutputFormat) && (
        <div>
          <Label>Output Format</Label>
          <Select
            value={editingTemplate.output_format}
            onValueChange={(v) =>
              setEditingTemplate({
                ...editingTemplate,
                output_format: v as OutputFormat,
              })
            }
          >
            <SelectTrigger className="w-64 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {USER_SELECTABLE_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Controls how the stage output is rendered. "Auto" detects from output content.
          </p>
        </div>
      )}

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
        <Label>Can Follow Stages</Label>
        <p className="text-xs text-muted-foreground mb-1.5">
          Which stages can come before this one. If none selected, this stage can follow any stage.
        </p>
        <div className="mt-1 space-y-1 max-h-40 overflow-y-auto border border-border rounded-md p-2">
          {stageTemplates
            .filter((t) => t.id !== editingTemplate.id)
            .map((t) => {
              const canFollow: string[] = editingTemplate.can_follow
                ? (() => { try { return JSON.parse(editingTemplate.can_follow); } catch { return []; } })()
                : [];
              const checked = canFollow.includes(t.name);
              return (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      const updated = v
                        ? [...canFollow, t.name]
                        : canFollow.filter((n: string) => n !== t.name);
                      setEditingTemplate({
                        ...editingTemplate,
                        can_follow: updated.length > 0 ? JSON.stringify(updated) : null,
                      });
                    }}
                  />
                  {t.name}
                </label>
              );
            })}
        </div>
      </div>

      <div>
        <Label>AI Agent</Label>
        <Select
          value={editingTemplate.agent ?? "__default__"}
          onValueChange={(v) =>
            setEditingTemplate({
              ...editingTemplate,
              agent: v === "__default__" ? null : v,
            })
          }
        >
          <SelectTrigger className="w-64 mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">Project Default</SelectItem>
            {AVAILABLE_AGENTS.filter((a) => !a.hidden).map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {editingTemplate.agent && editingTemplate.agent !== "claude" && (
          <div className="mt-2 space-y-1">
            {editingTemplate.output_schema && !AVAILABLE_AGENTS.find((a) => a.value === editingTemplate.agent)?.supportsJsonSchema && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This agent does not support JSON schema — structured output enforcement will be skipped.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {AVAILABLE_AGENTS.find((a) => a.value === editingTemplate.agent)?.description}
            </p>
          </div>
        )}
      </div>

      <div>
        <Label>Model Override</Label>
        {customModel ? (
          <div className="flex gap-2 mt-1">
            <Input
              value={editingTemplate.persona_model ?? ""}
              onChange={(e) =>
                setEditingTemplate({
                  ...editingTemplate,
                  persona_model: e.target.value || null,
                })
              }
              placeholder="Enter model slug"
              className="flex-1 font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCustomModel(false);
                setEditingTemplate({ ...editingTemplate, persona_model: null });
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Select
            value={editingTemplate.persona_model ?? "__default__"}
            onValueChange={(v) => {
              if (v === "__custom__") {
                setCustomModel(true);
                return;
              }
              setEditingTemplate({
                ...editingTemplate,
                persona_model: v === "__default__" ? null : v,
              });
            }}
          >
            <SelectTrigger className="w-64 mt-1 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">Agent Default</SelectItem>
              {agentModels.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
              <SelectItem value="__custom__">Custom...</SelectItem>
            </SelectContent>
          </Select>
        )}
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
        <p className="text-xs text-muted-foreground mt-1">
          Variables: {"{{task_description}}"}, {"{{user_input}}"},
          {"{{user_decision}}"}, {"{{prior_attempt_output}}"},
          {"{{available_stages}}"}. Prior stage summaries are auto-injected
          into the system prompt; use MCP tools for full outputs.
        </p>
      </div>


      <div className="flex items-center justify-end gap-3">
        <Button onClick={handleSave} disabled={!editingTemplate.name.trim()}>
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
  const restoreDefaults = useTaskStore((s) => s.restoreDefaultTemplates);
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
        preparation_prompt: null,
        allowed_tools: null,
        requires_user_input: 0,
        agent: null,
        can_follow: null,
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

  const handleRestoreDefaults = async () => {
    if (!activeProject) return;
    const confirmed = window.confirm(
      "This will delete all custom stages and restore the default templates. Are you sure?",
    );
    if (!confirmed) return;
    setError(null);
    try {
      await restoreDefaults(activeProject.id);
      const templates = useTaskStore.getState().stageTemplates;
      setSelectedId(templates[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
        <div className="p-2 border-t border-border space-y-1">
          <Button variant="outline" size="sm" className="w-full" onClick={handleNew}>
            + New Stage
          </Button>
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleRestoreDefaults}>
            Restore Defaults
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
