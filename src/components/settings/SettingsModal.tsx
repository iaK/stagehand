import { useState, useEffect, useRef } from "react";

import { useProjectStore } from "../../stores/projectStore";
import { sendNotification } from "../../lib/notifications";
import { resolveProjectLogo, LOGO_NONE } from "../../lib/projectLogo";
import { ProjectAvatar } from "../layout/ProjectRail";
import * as repo from "../../lib/repositories";

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

const LOGO_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#64748b",
];

function resizeImageToDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, 64, 64);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}


function ProjectSettings({ projectId }: { projectId: string }) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const archiveProject = useProjectStore((s) => s.archiveProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const loadProjectLogos = useProjectStore((s) => s.loadProjectLogos);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(activeProject?.name ?? "");
  const nameChanged = name.trim() !== "" && name.trim() !== activeProject?.name;

  // Worktree location
  const [worktreeLocation, setWorktreeLocation] = useState<string>("");
  const [worktreeDefault, setWorktreeDefault] = useState<string>("");
  const [worktreeChanged, setWorktreeChanged] = useState(false);

  // Logo settings
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoColor, setLogoColor] = useState<string | null>(null);
  const [logoInitials, setLogoInitials] = useState<string>("");
  const [githubOwner, setGithubOwner] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [url, color, initials, owner, wtLoc, wtDefault] = await Promise.all([
        repo.getProjectSetting(projectId, "logo_url"),
        repo.getProjectSetting(projectId, "logo_color"),
        repo.getProjectSetting(projectId, "logo_initials"),
        repo.getProjectSetting(projectId, "github_repo_owner"),
        repo.getProjectSetting(projectId, "worktree_location"),
        repo.getWorktreeBaseDir(projectId),
      ]);
      if (cancelled) return;
      setLogoUrl(url);
      setLogoColor(color);
      setLogoInitials(initials ?? "");
      setGithubOwner(owner);
      setWorktreeLocation(wtLoc ?? "");
      setWorktreeDefault(wtDefault);
      setWorktreeChanged(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const currentLogo = resolveProjectLogo({
    logoUrl,
    githubOwner,
    projectName: activeProject?.name ?? "",
    logoColor,
    logoInitials: logoInitials || null,
  });
  const hasImageLogo = currentLogo.type === "custom" || currentLogo.type === "github";

  const handleRename = async () => {
    if (!nameChanged) return;
    await renameProject(projectId, name.trim());
    sendNotification("Project renamed", name.trim(), "success", { projectId });
    loadProjectLogos();
  };

  const handleArchive = async () => {
    if (!activeProject) return;
    await archiveProject(activeProject.id);
    sendNotification("Project archived", activeProject.name, "success", { projectId });
    setConfirming(false);
  };

  const saveLogoDataUrl = async (dataUrl: string) => {
    setLogoUrl(dataUrl);
    await repo.setProjectSetting(projectId, "logo_url", dataUrl);
    loadProjectLogos();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = await resizeImageToDataUrl(reader.result as string);
        saveLogoDataUrl(dataUrl);
      } catch { /* ignore bad image */ }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRemoveLogo = async () => {
    setLogoUrl(LOGO_NONE);
    await repo.setProjectSetting(projectId, "logo_url", LOGO_NONE);
    loadProjectLogos();
  };

  const handleColorChange = async (color: string) => {
    setLogoColor(color);
    await repo.setProjectSetting(projectId, "logo_color", color);
    loadProjectLogos();
  };

  const handleInitialsChange = async (value: string) => {
    const v = value.slice(0, 3).toUpperCase();
    setLogoInitials(v);
    if (v) {
      await repo.setProjectSetting(projectId, "logo_initials", v);
    } else {
      await repo.deleteProjectSetting(projectId, "logo_initials");
    }
    loadProjectLogos();
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
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {nameChanged && (
            <Button size="sm" onClick={handleRename}>
              Save
            </Button>
          )}
        </div>
      </div>

      {/* Worktree location */}
      <div className="border border-border rounded-md p-4 space-y-1 mb-4">
        <p className="text-sm font-medium text-foreground">Worktree Location</p>
        <p className="text-xs text-muted-foreground mb-2">
          Base directory for git worktrees. Leave empty to use the default.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={worktreeLocation}
            onChange={(e) => { setWorktreeLocation(e.target.value); setWorktreeChanged(true); }}
            placeholder={worktreeDefault}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {worktreeChanged && (
            <Button
              size="sm"
              onClick={async () => {
                const trimmed = worktreeLocation.trim();
                if (trimmed) {
                  await repo.setProjectSetting(projectId, "worktree_location", trimmed);
                } else {
                  await repo.deleteProjectSetting(projectId, "worktree_location");
                }
                setWorktreeChanged(false);
              }}
            >
              Save
            </Button>
          )}
        </div>
      </div>

      {/* Logo customization */}
      <div className="border border-border rounded-md p-4 space-y-4 mb-4">
        <p className="text-sm font-medium text-foreground">Project Logo</p>

        <div className="flex items-center gap-4">
          <ProjectAvatar logo={currentLogo} size={48} />
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUpload}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload
              </Button>
            </div>
            {hasImageLogo && (
              <Button variant="ghost" size="sm" className="w-fit text-destructive hover:text-destructive" onClick={handleRemoveLogo}>
                Remove logo
              </Button>
            )}
          </div>
        </div>

        {!hasImageLogo && (
          <>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Initials (max 3 chars)</p>
              <input
                type="text"
                value={logoInitials}
                onChange={(e) => handleInitialsChange(e.target.value)}
                placeholder={activeProject?.name.slice(0, 3).toUpperCase()}
                maxLength={3}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-20 h-8 rounded-md border border-input bg-background px-2 text-sm text-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Color</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {LOGO_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => handleColorChange(c)}
                    className={`w-6 h-6 rounded-full transition-all ${
                      logoColor === c ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:scale-110"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
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
