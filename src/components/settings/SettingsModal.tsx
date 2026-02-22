import { useState } from "react";

import { useProjectStore } from "../../stores/projectStore";
import { sendNotification } from "../../lib/notifications";

import { StageTemplateEditorContent } from "../project/StageTemplateEditor";
import { LinearSettingsContent } from "../linear/LinearSettings";
import { GitHubSettingsContent } from "../github/GitHubSettings";
import { GitHubConventionsContent } from "../github/GitHubConventions";
import { AgentSettingsContent } from "../agents/AgentSettings";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

type Section = "project" | "pipeline" | "linear" | "github" | "conventions" | "agents";

type NavItem =
  | { header: string }
  | { section: Section; label: string; projectRequired?: boolean };

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [activeSection, setActiveSection] = useState<Section>("project");

  const navItems: NavItem[] = [
    { header: "GENERAL" },
    { section: "project", label: "Project", projectRequired: true },
    { section: "pipeline", label: "Pipeline", projectRequired: true },
    { header: "INTEGRATIONS" },
    { section: "linear", label: "Linear", projectRequired: true },
    { section: "github", label: "Git", projectRequired: true },
    { header: "WORKFLOW" },
    { section: "agents", label: "AI Agents", projectRequired: true },
    { section: "conventions", label: "Conventions", projectRequired: true },
  ];

  const currentItem = navItems.find(
    (i): i is Extract<NavItem, { section: Section }> =>
      "section" in i && i.section === activeSection,
  );
  const needsProject = currentItem?.projectRequired && !activeProject;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[1100px] h-[90vh] flex flex-col p-0" showCloseButton={false}>
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
                    className="px-4 pt-4 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                  >
                    {item.header}
                  </div>
                );
              }

              const isActive = activeSection === item.section;

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
                </div>
              );
            })}
          </nav>

          {/* Right Content */}
          {needsProject ? (
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Select a project to configure these settings
              </p>
            </div>
          ) : activeSection === "pipeline" ? (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <StageTemplateEditorContent />
            </div>
          ) : (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-6">
                <SectionContent
                  section={activeSection}
                  projectId={activeProject?.id}
                />
              </div>
            </ScrollArea>
          )}
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
  switch (section) {
    case "project":
      return <ProjectSettings projectId={projectId!} />;
    case "linear":
      return <LinearSettingsContent projectId={projectId!} />;
    case "github":
      return <GitHubSettingsContent projectId={projectId!} />;
    case "conventions":
      return <GitHubConventionsContent projectId={projectId!} />;
    case "agents":
      return <AgentSettingsContent projectId={projectId!} />;
    default:
      return null;
  }
}

function ProjectSettings({ projectId }: { projectId: string }) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const archiveProject = useProjectStore((s) => s.archiveProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(activeProject?.name ?? "");
  const nameChanged = name.trim() !== "" && name.trim() !== activeProject?.name;

  const handleRename = async () => {
    if (!nameChanged) return;
    await renameProject(projectId, name.trim());
    sendNotification("Project renamed", name.trim(), "success", { projectId });
  };

  const handleArchive = async () => {
    if (!activeProject) return;
    await archiveProject(activeProject.id);
    sendNotification("Project archived", activeProject.name, "success", { projectId });
    setConfirming(false);
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Project</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        Manage the current project.
      </p>

      <div className="border border-border rounded-md p-4 space-y-1 mb-4">
        <p className="text-sm font-medium text-foreground">Name</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {nameChanged && (
            <Button size="sm" onClick={handleRename}>
              Save
            </Button>
          )}
        </div>
      </div>

      <div className="border border-border rounded-md p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Archive project</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Remove this project from the sidebar. You can restore it later from Archived Projects.
          </p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleArchive}>
              Confirm
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="flex-shrink-0" onClick={() => setConfirming(true)}>
            Archive
          </Button>
        )}
      </div>
    </div>
  );
}
