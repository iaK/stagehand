import { create } from "zustand";
import { getSetting, setSetting } from "../lib/repositories";
import { DEFAULT_KEYBINDINGS, type KeyBindingAction } from "../lib/keybindings";

export type TextSize = "xs" | "s" | "m" | "l" | "xl";

export const TEXT_SIZE_PX: Record<TextSize, number> = {
  xs: 12,
  s: 13,
  m: 14,
  l: 15,
  xl: 16,
};

export type ExternalEditor = "builtin" | "vscode" | "cursor" | "sublime" | "zed" | "custom";

export const EXTERNAL_EDITOR_OPTIONS: { value: ExternalEditor; label: string; command: string | null }[] = [
  { value: "builtin", label: "Built-in Editor", command: null },
  { value: "vscode", label: "VS Code", command: "code" },
  { value: "cursor", label: "Cursor", command: "cursor" },
  { value: "sublime", label: "Sublime Text", command: "subl" },
  { value: "zed", label: "Zed", command: "zed" },
  { value: "custom", label: "Custom", command: null },
];

interface SettingsState {
  appTextSize: TextSize;
  appSidebarPosition: "left" | "right";
  editorSidebarPosition: "left" | "right";
  editorFontSize: number;
  diffViewMode: "inline" | "sideBySide";
  terminalFontSize: number;
  externalEditor: ExternalEditor;
  externalEditorCommand: string;
  keybindings: Record<KeyBindingAction, string>;
  loaded: boolean;

  load: () => Promise<void>;
  setAppTextSize: (v: TextSize) => void;
  setAppSidebarPosition: (v: "left" | "right") => void;
  setEditorSidebarPosition: (v: "left" | "right") => void;
  setEditorFontSize: (v: number) => void;
  setDiffViewMode: (v: "inline" | "sideBySide") => void;
  setTerminalFontSize: (v: number) => void;
  setExternalEditor: (v: ExternalEditor) => void;
  setExternalEditorCommand: (v: string) => void;
  setKeybinding: (action: KeyBindingAction, shortcut: string) => void;
  resetKeybindings: () => void;
  /** Returns the shell command for the current external editor, or null if builtin. */
  getEditorCommand: () => string | null;
}

const VALID_TEXT_SIZES = new Set<string>(["xs", "s", "m", "l", "xl"]);
const VALID_EDITORS = new Set<string>(["builtin", "vscode", "cursor", "sublime", "zed", "custom"]);

export const useSettingsStore = create<SettingsState>((set, get) => ({
  appTextSize: "s",
  appSidebarPosition: "left",
  editorSidebarPosition: "left",
  editorFontSize: 13,
  diffViewMode: "inline",
  terminalFontSize: 13,
  externalEditor: "builtin",
  externalEditorCommand: "",
  keybindings: { ...DEFAULT_KEYBINDINGS },
  loaded: false,

  async load() {
    const [appTextSize, appSidebar, editorSidebar, editorFont, diffView, termFont, extEditor, extEditorCmd, keybindingsRaw] = await Promise.all([
      getSetting("appTextSize"),
      getSetting("appSidebarPosition"),
      getSetting("editorSidebarPosition"),
      getSetting("editorFontSize"),
      getSetting("diffViewMode"),
      getSetting("terminalFontSize"),
      getSetting("externalEditor"),
      getSetting("externalEditorCommand"),
      getSetting("keybindings"),
    ]);
    let keybindings = { ...DEFAULT_KEYBINDINGS };
    if (keybindingsRaw) {
      try {
        const parsed = JSON.parse(keybindingsRaw);
        keybindings = { ...DEFAULT_KEYBINDINGS, ...parsed };
      } catch { /* use defaults */ }
    }
    set({
      appTextSize: appTextSize && VALID_TEXT_SIZES.has(appTextSize) ? appTextSize as TextSize : "s",
      appSidebarPosition: appSidebar === "right" ? "right" : "left",
      editorSidebarPosition: editorSidebar === "right" ? "right" : "left",
      editorFontSize: editorFont ? Number(editorFont) : 13,
      diffViewMode: diffView === "sideBySide" ? "sideBySide" : "inline",
      terminalFontSize: termFont ? Number(termFont) : 13,
      externalEditor: extEditor && VALID_EDITORS.has(extEditor) ? extEditor as ExternalEditor : "builtin",
      externalEditorCommand: extEditorCmd ?? "",
      keybindings,
      loaded: true,
    });
  },

  setAppTextSize(v) {
    set({ appTextSize: v });
    setSetting("appTextSize", v);
  },
  setAppSidebarPosition(v) {
    set({ appSidebarPosition: v });
    setSetting("appSidebarPosition", v);
  },
  setEditorSidebarPosition(v) {
    set({ editorSidebarPosition: v });
    setSetting("editorSidebarPosition", v);
  },
  setEditorFontSize(v) {
    set({ editorFontSize: v });
    setSetting("editorFontSize", String(v));
  },
  setDiffViewMode(v) {
    set({ diffViewMode: v });
    setSetting("diffViewMode", v);
  },
  setTerminalFontSize(v) {
    set({ terminalFontSize: v });
    setSetting("terminalFontSize", String(v));
  },
  setExternalEditor(v) {
    set({ externalEditor: v });
    setSetting("externalEditor", v);
  },
  setExternalEditorCommand(v) {
    set({ externalEditorCommand: v });
    setSetting("externalEditorCommand", v);
  },
  setKeybinding(action, shortcut) {
    const keybindings = { ...get().keybindings, [action]: shortcut };
    set({ keybindings });
    setSetting("keybindings", JSON.stringify(keybindings));
  },
  resetKeybindings() {
    const keybindings = { ...DEFAULT_KEYBINDINGS };
    set({ keybindings });
    setSetting("keybindings", JSON.stringify(keybindings));
  },
  getEditorCommand() {
    const { externalEditor, externalEditorCommand } = get();
    if (externalEditor === "builtin") return null;
    if (externalEditor === "custom") return externalEditorCommand || null;
    const opt = EXTERNAL_EDITOR_OPTIONS.find((o) => o.value === externalEditor);
    return opt?.command ?? null;
  },
}));
