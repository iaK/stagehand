import { useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { ArchivedProjectsSettings } from "./ArchivedProjectsSettings";
import { SingleTemplateEditor } from "../project/StageTemplateEditor";
import { LinearSettingsContent } from "../linear/LinearSettings";
import { GitHubSettingsContent } from "../github/GitHubSettings";
import { GitHubConventionsContent } from "../github/GitHubConventions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type Section = string; // "archived" | "template:<id>" | "linear" | "github" | "conventions"

type NavItem =
  | { header: string }
  | { section: Section; label: string; projectRequired?: boolean };

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const [activeSection, setActiveSection] = useState<Section>("archived");

  const navItems: NavItem[] = [
    { header: "GENERAL" },
    { section: "archived", label: "Archived Projects" },
    { header: "PIPELINE" },
    ...stageTemplates.map((t) => ({
      section: `template:${t.id}`,
      label: t.name,
      projectRequired: true as const,
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
      <DialogContent className="sm:max-w-[800px] max-h-[85vh] flex flex-col p-0" showCloseButton={false}>
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
                <button
                  key={item.section}
                  onClick={() => setActiveSection(item.section)}
                  className={`w-full text-left px-4 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
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
