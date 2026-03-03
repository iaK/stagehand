export interface ProjectLogoInfo {
  type: "custom" | "github" | "initials";
  src?: string; // image URL for custom/github
  initials: string;
  color: string;
}

interface ResolveLogoInput {
  logoUrl?: string | null;
  githubOwner?: string | null;
  projectName: string;
  logoColor?: string | null;
  logoInitials?: string | null;
}

const COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#64748b", // slate
];

export function generateColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 3) {
    return (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
  }
  if (words.length === 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 3).toUpperCase();
}

/** Sentinel value stored in logo_url to explicitly disable image logos */
export const LOGO_NONE = "none";

export function resolveProjectLogo(input: ResolveLogoInput): ProjectLogoInfo {
  const initials = input.logoInitials?.trim() || deriveInitials(input.projectName);
  const color = input.logoColor || generateColorFromName(input.projectName);

  // Explicit "no logo" — skip image sources, use initials only
  if (input.logoUrl === LOGO_NONE) {
    return { type: "initials", initials, color };
  }

  // Priority 1: custom uploaded logo (data URL or path)
  if (input.logoUrl) {
    return { type: "custom", src: input.logoUrl, initials, color };
  }

  // Priority 2: GitHub org avatar
  if (input.githubOwner) {
    return {
      type: "github",
      src: `https://github.com/${input.githubOwner}.png?size=64`,
      initials,
      color,
    };
  }

  // Priority 3: colored initials
  return { type: "initials", initials, color };
}
