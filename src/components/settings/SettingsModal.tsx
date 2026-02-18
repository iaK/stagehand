import { useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { isSpecialStage } from "../../lib/repositories";
import { ArchivedProjectsSettings } from "./ArchivedProjectsSettings";
import { SingleTemplateEditor } from "../project/StageTemplateEditor";
import { LinearSettingsContent } from "../linear/LinearSettings";
import { GitHubSettingsContent } from "../github/GitHubSettings";
import { GitHubConventionsContent } from "../github/GitHubConventions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { OutputFormat } from "../../lib/types";

type Section = string; // "archived" | "template:<id>" | "linear" | "github" | "conventions"

type NavItem =
  | { header: string; actions?: React.ReactNode }
  | { section: Section; label: string; projectRequired?: boolean; templateId?: string };

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const createTemplate = useTaskStore((s) => s.createStageTemplate);
  const deleteTemplate = useTaskStore((s) => s.deleteStageTemplate);
  const duplicateTemplate = useTaskStore((s) => s.duplicateStageTemplate);
  const reorderTemplates = useTaskStore((s) => s.reorderStageTemplates);
  const [activeSection, setActiveSection] = useState<Section>("archived");
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const handleNewStage = async () => {
    if (!activeProject) return;
    setPipelineError(null);
    try {
      const maxOrder = Math.max(...stageTemplates.map((t) => t.sort_order), -1);
      const created = await createTemplate(activeProject.id, {
        project_id: activeProject.id,
        name: "New Stage",
        description: "",
        sort_order: maxOrder + 1,
        prompt_template: "Task: {{task_description}}\n\n{{#if previous_output}}\nPrevious output:\n{{previous_output}}\n{{/if}}",
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
      });
      setActiveSection(`template:${created.id}`);
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteStage = async (id: string) => {
    if (!activeProject) return;
    setPipelineError(null);
    try {
      await deleteTemplate(activeProject.id, id);
      if (activeSection === `template:${id}`) {
        const remaining = stageTemplates.find((t) => t.id !== id);
        setActiveSection(remaining ? `template:${remaining.id}` : "archived");
      }
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDuplicateStage = async (id: string) => {
    if (!activeProject) return;
    setPipelineError(null);
    try {
      const created = await duplicateTemplate(activeProject.id, id);
      setActiveSection(`template:${created.id}`);
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
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

  const navItems: NavItem[] = [
    { header: "GENERAL" },
    { section: "archived", label: "Archived Projects" },
    {
      header: "PIPELINE",
      actions: activeProject ? (
        <button
          onClick={handleNewStage}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Add stage"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      ) : undefined,
    },
    ...stageTemplates.map((t) => ({
      section: `template:${t.id}`,
      label: t.name,
      projectRequired: true as const,
      templateId: t.id,
    })),
    { header: "INTEGRATIONS" },
    { section: "linear", label: "Linear", projectRequired: true },
    { section: "github", label: "Git", projectRequired: true },
    { header: "WORKFLOW" },
    { section: "conventions", label: "Conventions", projectRequired: true },
  ];

  const currentItem = navItems.find(
    (i): i is Extract<NavItem, { section: Section }> =>
      "section" in i && i.section === activeSection,
  );
  const needsProject = currentItem?.projectRequired && !activeProject;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[800px] h-[85vh] flex flex-col p-0" showCloseButton={false}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <DialogHeader className="p-0">
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left Nav */}
          <nav className="w-48 border-r border-border py-2 overflow-y-auto flex-shrink-0">
            {navItems.map((item, i) => {
              if ("header" in item) {
                return (
                  <div
                    key={i}
                    className="px-4 pt-4 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between"
                  >
                    {item.header}
                    {item.actions}
                  </div>
                );
              }

              const isActive = activeSection === item.section;
              const templateIdx = item.templateId
                ? stageTemplates.findIndex((t) => t.id === item.templateId)
                : -1;

              return (
                <div
                  key={item.section}
                  className={`group flex items-center transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  <button
                    onClick={() => setActiveSection(item.section)}
                    className="flex-1 text-left px-4 py-1.5 text-sm truncate"
                  >
                    {item.label}
                  </button>
                  {item.templateId && (() => {
                    const tpl = stageTemplates.find((t) => t.id === item.templateId);
                    const special = tpl ? isSpecialStage(tpl.output_format as OutputFormat) : false;
                    return (
                      <div className="hidden group-hover:flex items-center gap-0.5 pr-2">
                        {templateIdx > 0 && (
                          <button
                            onClick={() => handleMoveUp(item.templateId!)}
                            className="p-0.5 text-muted-foreground hover:text-foreground"
                            title="Move up"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                        )}
                        {templateIdx < stageTemplates.length - 1 && (
                          <button
                            onClick={() => handleMoveDown(item.templateId!)}
                            className="p-0.5 text-muted-foreground hover:text-foreground"
                            title="Move down"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        )}
                        {!special && (
                          <>
                            <button
                              onClick={() => handleDuplicateStage(item.templateId!)}
                              className="p-0.5 text-muted-foreground hover:text-foreground"
                              title="Duplicate"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteStage(item.templateId!)}
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
                    );
                  })()}
                </div>
              );
            })}
            {pipelineError && (
              <div className="px-2 pt-2">
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">{pipelineError}</AlertDescription>
                </Alert>
              </div>
            )}
          </nav>

          {/* Right Content */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-6">
              {needsProject ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">
                      Select a project to configure these settings
                    </p>
                  </div>
                </div>
              ) : (
                <SectionContent
                  section={activeSection}
                  projectId={activeProject?.id}
                />
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionContent({
  section,
  projectId,
}: {
  section: Section;
  projectId?: string;
}) {
  if (section.startsWith("template:")) {
    const templateId = section.slice("template:".length);
    return <SingleTemplateEditor templateId={templateId} />;
  }
  switch (section) {
    case "archived":
      return <ArchivedProjectsSettings />;
    case "linear":
      return <LinearSettingsContent projectId={projectId!} />;
    case "github":
      return <GitHubSettingsContent projectId={projectId!} />;
    case "conventions":
      return <GitHubConventionsContent projectId={projectId!} />;
    default:
      return null;
  }
}
