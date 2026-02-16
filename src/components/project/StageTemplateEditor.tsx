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
import type { StageTemplate, InputSource, OutputFormat } from "../../lib/types";

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

export function StageTemplateEditorContent() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const loadStageTemplates = useTaskStore((s) => s.loadStageTemplates);
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
      <div className="w-48 border-r border-border overflow-y-auto">
        {stageTemplates.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedId(t.id)}
            className={`w-full text-left px-3 py-2 text-sm ${
              selectedId === t.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Edit Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                <SelectItem value="pr_review">PR Review</SelectItem>
              </SelectContent>
            </Select>
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
            {"{{user_input}}"}, {"{{user_decision}}"}, {"{{stage_summaries}}"}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="text-xs text-emerald-600">Saved</span>
          )}
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
