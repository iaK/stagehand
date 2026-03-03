import { useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { ProjectCreate } from "../project/ProjectCreate";
import { AppSettingsModal } from "../settings/AppSettingsModal";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { ProjectLogoInfo } from "../../lib/projectLogo";
import logoSrc from "../../assets/logo.png";

function ProjectAvatar({
  logo,
  size = 32,
  active = false,
  statusClass,
}: {
  logo: ProjectLogoInfo;
  size?: number;
  active?: boolean;
  statusClass?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const showImage = logo.src && !imgError;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {showImage ? (
        <img
          src={logo.src}
          alt=""
          className={`rounded-lg object-cover transition-all ${
            active ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
          }`}
          style={{ width: size, height: size }}
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={`rounded-lg flex items-center justify-center text-white font-semibold transition-all ${
            active ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
          }`}
          style={{
            width: size,
            height: size,
            backgroundColor: logo.color,
            fontSize: size * (logo.initials.length > 2 ? 0.3 : 0.38),
          }}
        >
          {logo.initials}
        </div>
      )}
      {statusClass && (
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${statusClass}`}
        />
      )}
    </div>
  );
}

export { ProjectAvatar };

export function ProjectRail() {
  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => s.activeProject);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const projectStatuses = useProjectStore((s) => s.projectStatuses);
  const projectLogos = useProjectStore((s) => s.projectLogos);
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);

  return (
    <div className="w-14 flex-shrink-0 border-r border-border bg-muted/50 flex flex-col items-center">
      {/* Stagehand logo — opens app settings, aligned with header bar */}
      <div className="flex items-center justify-center h-[57px] shrink-0 w-full">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowAppSettings(true)}
              className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-accent transition-colors"
            >
              <img src={logoSrc} alt="Stagehand" className="w-6 h-6" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </div>

      <div className="w-6 h-px bg-border" />

      {/* Project avatars + add button */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center gap-5 pt-5 pb-3 px-1">
        {projects.map((p) => {
          const logo = projectLogos[p.id];
          if (!logo) return null;

          return (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    useTaskStore.getState().setActiveTask(null);
                    setActiveProject(p);
                  }}
                  className="flex-shrink-0 rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ProjectAvatar
                    logo={logo}
                    active={activeProject?.id === p.id}
                    statusClass={projectStatuses[p.id]}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{p.name}</TooltipContent>
            </Tooltip>
          );
        })}

        {/* Add project button — sits right after the last avatar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowProjectCreate(true)}
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">New Project</TooltipContent>
        </Tooltip>
      </div>

      {showProjectCreate && (
        <ProjectCreate onClose={() => setShowProjectCreate(false)} />
      )}
      {showAppSettings && (
        <AppSettingsModal onClose={() => setShowAppSettings(false)} />
      )}
    </div>
  );
}
