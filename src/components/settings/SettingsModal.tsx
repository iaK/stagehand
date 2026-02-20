import { useState } from "react";
import { useTheme } from "next-themes";
import { useProjectStore } from "../../stores/projectStore";
import { ArchivedProjectsSettings } from "./ArchivedProjectsSettings";
import { StageTemplateEditorContent } from "../project/StageTemplateEditor";
import { LinearSettingsContent } from "../linear/LinearSettings";
import { GitHubSettingsContent } from "../github/GitHubSettings";
import { GitHubConventionsContent } from "../github/GitHubConventions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type Section = "archived" | "appearance" | "pipeline" | "linear" | "github" | "conventions";

type NavItem =
  | { header: string }
  | { section: Section; label: string; projectRequired?: boolean };

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [activeSection, setActiveSection] = useState<Section>("archived");

  const navItems: NavItem[] = [
    { header: "GENERAL" },
    { section: "archived", label: "Archived Projects" },
    { section: "appearance", label: "Appearance" },
    { section: "pipeline", label: "Pipeline", projectRequired: true },
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
    case "archived":
      return <ArchivedProjectsSettings />;
    case "appearance":
      return <AppearanceSettings />;
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

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  const options = [
    { value: "system", label: "System", description: "Follow your OS setting" },
    { value: "light", label: "Light", description: "Always use light mode" },
    { value: "dark", label: "Dark", description: "Always use dark mode" },
  ] as const;

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Choose how Stagehand looks.
      </p>
      <div className="space-y-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
              theme === opt.value
                ? "border-primary bg-accent"
                : "border-border hover:border-primary/50"
            }`}
          >
            <input
              type="radio"
              name="theme"
              value={opt.value}
              checked={theme === opt.value}
              onChange={() => setTheme(opt.value)}
              className="mt-0.5"
            />
            <div>
              <span className="text-sm font-medium text-foreground">{opt.label}</span>
              <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
