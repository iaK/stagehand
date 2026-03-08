import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "next-themes";

import { ArchivedProjectsSettings } from "./ArchivedProjectsSettings";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsStore, TEXT_SIZE_PX, EXTERNAL_EDITOR_OPTIONS, type TextSize, type ExternalEditor } from "@/stores/settingsStore";
import { KEYBINDING_ACTIONS, formatShortcut, shortcutFromEvent, type KeyBindingAction } from "@/lib/keybindings";

export type AppSettingsSection = "appearance" | "editor" | "keybindings" | "archived";
type Section = AppSettingsSection;

type NavItem =
  | { header: string }
  | { section: Section; label: string };

interface AppSettingsModalProps {
  onClose: () => void;
  initialSection?: Section;
}

export function AppSettingsModal({ onClose, initialSection }: AppSettingsModalProps) {
  const [activeSection, setActiveSection] = useState<Section>(initialSection ?? "appearance");

  const navItems: NavItem[] = [
    { header: "GENERAL" },
    { section: "appearance", label: "Appearance" },
    { section: "editor", label: "Editor" },
    { section: "keybindings", label: "Keybindings" },
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
                    className="px-4 pt-4 pb-1 text-[0.77rem] font-semibold text-muted-foreground uppercase tracking-wider"
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
              {activeSection === "editor" && <EditorSettings />}
              {activeSection === "keybindings" && <KeybindingsSettings />}
              {activeSection === "archived" && <ArchivedProjectsSettings />}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RadioGroup({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: { value: string; label: string; description: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
            value === opt.value
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="sr-only"
          />
          <div
            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
              value === opt.value
                ? "border-foreground"
                : "border-muted-foreground/40"
            }`}
          >
            {value === opt.value && (
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
  );
}

function FontSizeSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="bg-background border border-border rounded-md px-2 py-1.5 text-sm"
    >
      {Array.from({ length: 10 }, (_, i) => i + 11).map((size) => (
        <option key={size} value={size}>
          {size}px
        </option>
      ))}
    </select>
  );
}

function EditorSettings() {
  const editorSidebarPosition = useSettingsStore((s) => s.editorSidebarPosition);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const diffViewMode = useSettingsStore((s) => s.diffViewMode);
  const externalEditor = useSettingsStore((s) => s.externalEditor);
  const externalEditorCommand = useSettingsStore((s) => s.externalEditorCommand);
  const setEditorSidebarPosition = useSettingsStore((s) => s.setEditorSidebarPosition);
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const setDiffViewMode = useSettingsStore((s) => s.setDiffViewMode);
  const setExternalEditor = useSettingsStore((s) => s.setExternalEditor);
  const setExternalEditorCommand = useSettingsStore((s) => s.setExternalEditorCommand);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">Editor</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Choose which editor to open when clicking the editor button.
        </p>
        <RadioGroup
          name="externalEditor"
          value={externalEditor}
          options={EXTERNAL_EDITOR_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
            description: opt.value === "builtin"
              ? "Use the built-in code editor"
              : opt.value === "custom"
              ? "Specify a custom editor command"
              : `Open worktree in ${opt.label}`,
          }))}
          onChange={(v) => setExternalEditor(v as ExternalEditor)}
        />
        {externalEditor === "custom" && (
          <div className="mt-3">
            <label className="text-xs text-muted-foreground block mb-1">
              Command (e.g. <code className="text-foreground">vim</code>, <code className="text-foreground">emacs</code>)
            </label>
            <input
              type="text"
              value={externalEditorCommand}
              onChange={(e) => setExternalEditorCommand(e.target.value)}
              placeholder="editor-command"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-sm w-full"
            />
          </div>
        )}
      </div>

      {externalEditor === "builtin" && (
        <>
          <div>
            <h3 className="text-sm font-medium text-foreground mb-1">File Tree Position</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Which side the file tree and changes panel appears on.
            </p>
            <RadioGroup
              name="editorSidebarPosition"
              value={editorSidebarPosition}
              options={[
                { value: "left", label: "Left", description: "File tree on the left side" },
                { value: "right", label: "Right", description: "File tree on the right side" },
              ]}
              onChange={(v) => setEditorSidebarPosition(v as "left" | "right")}
            />
          </div>

          <div>
            <h3 className="text-sm font-medium text-foreground mb-1">Editor Font Size</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Font size for the code editor.
            </p>
            <FontSizeSelect value={editorFontSize} onChange={setEditorFontSize} />
          </div>

          <div>
            <h3 className="text-sm font-medium text-foreground mb-1">Terminal Font Size</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Font size for the integrated terminal.
            </p>
            <FontSizeSelect value={terminalFontSize} onChange={setTerminalFontSize} />
          </div>

          <div>
            <h3 className="text-sm font-medium text-foreground mb-1">Diff View</h3>
            <p className="text-xs text-muted-foreground mb-4">
              How file diffs are displayed in the editor.
            </p>
            <RadioGroup
              name="diffViewMode"
              value={diffViewMode}
              options={[
                { value: "inline", label: "Inline", description: "Show changes in a single column" },
                { value: "sideBySide", label: "Side by Side", description: "Show old and new side by side" },
              ]}
              onChange={(v) => setDiffViewMode(v as "inline" | "sideBySide")}
            />
          </div>
        </>
      )}
    </div>
  );
}

function KeybindingsSettings() {
  const keybindings = useSettingsStore((s) => s.keybindings);
  const setKeybinding = useSettingsStore((s) => s.setKeybinding);
  const resetKeybindings = useSettingsStore((s) => s.resetKeybindings);
  const [recording, setRecording] = useState<KeyBindingAction | null>(null);

  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  const handleRecord = useCallback((e: KeyboardEvent) => {
    if (!recordingRef.current) return;
    const shortcut = shortcutFromEvent(e);
    if (!shortcut) return;
    e.preventDefault();
    e.stopPropagation();
    setKeybinding(recordingRef.current, shortcut);
    setRecording(null);
  }, [setKeybinding]);

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleRecord, true);
    return () => window.removeEventListener("keydown", handleRecord, true);
  }, [recording, handleRecord]);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-foreground">Keyboard Shortcuts</h3>
          <button
            onClick={resetKeybindings}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset to defaults
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Click a shortcut to re-record it. Press the new key combination to assign.
        </p>
        <div className="space-y-1">
          {KEYBINDING_ACTIONS.map(({ action, label }) => (
            <div
              key={action}
              className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-accent/50"
            >
              <span className="text-sm">{label}</span>
              <button
                onClick={() => setRecording(recording === action ? null : action)}
                className={`px-2.5 py-1 rounded text-xs font-mono min-w-[80px] text-center transition-colors ${
                  recording === action
                    ? "bg-foreground text-background animate-pulse"
                    : "bg-accent text-accent-foreground hover:bg-accent/80"
                }`}
              >
                {recording === action
                  ? "Press keys..."
                  : formatShortcut(keybindings[action])}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: "xs", label: "XS" },
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const appTextSize = useSettingsStore((s) => s.appTextSize);
  const setAppTextSize = useSettingsStore((s) => s.setAppTextSize);
  const appSidebarPosition = useSettingsStore((s) => s.appSidebarPosition);
  const setAppSidebarPosition = useSettingsStore((s) => s.setAppSidebarPosition);

  const options = [
    { value: "system", label: "System", description: "Follow your OS preference" },
    { value: "light", label: "Light", description: "Always use light mode" },
    { value: "dark", label: "Dark", description: "Always use dark mode" },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
      <h3 className="text-sm font-medium text-foreground mb-1">Theme</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Choose how Stagehand looks.
      </p>
      <RadioGroup
        name="theme"
        value={theme ?? "system"}
        options={options.map((opt) => ({
          value: opt.value,
          label: opt.label,
          description: opt.description,
        }))}
        onChange={(v) => setTheme(v)}
      />
      </div>

      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">Text Size</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Adjust the base text size across the app ({TEXT_SIZE_PX[appTextSize]}px).
        </p>
        <div className="flex gap-1">
          {TEXT_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAppTextSize(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                appTextSize === opt.value
                  ? "bg-foreground text-background"
                  : "bg-accent/50 text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">Sidebar Position</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Which side the app sidebar appears on.
        </p>
        <RadioGroup
          name="appSidebarPosition"
          value={appSidebarPosition}
          options={[
            { value: "left", label: "Left", description: "Sidebar on the left side" },
            { value: "right", label: "Right", description: "Sidebar on the right side" },
          ]}
          onChange={(v) => setAppSidebarPosition(v as "left" | "right")}
        />
      </div>
    </div>
  );
}
