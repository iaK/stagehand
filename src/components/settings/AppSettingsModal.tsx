import { useState } from "react";
import { useTheme } from "next-themes";

import { ArchivedProjectsSettings } from "./ArchivedProjectsSettings";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type Section = "appearance" | "archived";

type NavItem =
  | { header: string }
  | { section: Section; label: string };

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps) {
  const [activeSection, setActiveSection] = useState<Section>("appearance");

  const navItems: NavItem[] = [
    { header: "GENERAL" },
    { section: "appearance", label: "Appearance" },
    { header: "PROJECTS" },
    { section: "archived", label: "Archived Projects" },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[700px] h-[70vh] flex flex-col p-0" showCloseButton={false}>
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
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-6">
              {activeSection === "appearance" && <AppearanceSettings />}
              {activeSection === "archived" && <ArchivedProjectsSettings />}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  const options = [
    { value: "system", label: "System", description: "Follow your OS preference" },
    { value: "light", label: "Light", description: "Always use light mode" },
    { value: "dark", label: "Dark", description: "Always use dark mode" },
  ] as const;

  return (
    <div>
      <h3 className="text-sm font-medium text-foreground mb-1">Theme</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Choose how Stagehand looks.
      </p>
      <div className="space-y-1">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
              theme === opt.value
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50"
            }`}
          >
            <input
              type="radio"
              name="theme"
              value={opt.value}
              checked={theme === opt.value}
              onChange={() => setTheme(opt.value)}
              className="sr-only"
            />
            <div
              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                theme === opt.value
                  ? "border-foreground"
                  : "border-muted-foreground/40"
              }`}
            >
              {theme === opt.value && (
                <div className="w-2 h-2 rounded-full bg-foreground" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
