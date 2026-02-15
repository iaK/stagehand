import { useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { ArchivedProjectsSettings } from "./ArchivedProjectsSettings";
import { StageTemplateEditorContent } from "../project/StageTemplateEditor";
import { LinearSettingsContent } from "../linear/LinearSettings";
import { GitHubSettingsContent } from "../github/GitHubSettings";
import { GitHubConventionsContent } from "../github/GitHubConventions";

type Section =
  | "archived"
  | "templates"
  | "linear"
  | "github"
  | "conventions";

type NavItem =
  | { header: string }
  | { section: Section; label: string; projectRequired?: boolean };

const NAV_ITEMS: NavItem[] = [
  { header: "GENERAL" },
  { section: "archived", label: "Archived Projects" },
  { header: "PIPELINE" },
  { section: "templates", label: "Stage Templates", projectRequired: true },
  { header: "INTEGRATIONS" },
  { section: "linear", label: "Linear", projectRequired: true },
  { section: "github", label: "GitHub", projectRequired: true },
  { header: "WORKFLOW" },
  { section: "conventions", label: "Conventions", projectRequired: true },
];

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [activeSection, setActiveSection] = useState<Section>("archived");

  const currentItem = NAV_ITEMS.find(
    (i): i is Extract<NavItem, { section: Section }> =>
      "section" in i && i.section === activeSection,
  );
  const needsProject = currentItem?.projectRequired && !activeProject;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[800px] max-w-[90vw] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">Settings</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left Nav */}
          <nav className="w-48 border-r border-zinc-800 py-2 overflow-y-auto flex-shrink-0">
            {NAV_ITEMS.map((item, i) => {
              if ("header" in item) {
                return (
                  <div
                    key={i}
                    className="px-4 pt-4 pb-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider"
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
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right Content */}
          <div className="flex-1 overflow-y-auto p-6 min-h-0">
            {needsProject ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-sm text-zinc-500">
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
        </div>
      </div>
    </div>
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
    case "templates":
      return <StageTemplateEditorContent />;
    case "linear":
      return <LinearSettingsContent projectId={projectId!} />;
    case "github":
      return <GitHubSettingsContent projectId={projectId!} />;
    case "conventions":
      return <GitHubConventionsContent projectId={projectId!} />;
  }
}
