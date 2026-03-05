import { create } from "zustand";
import { getSetting, setSetting } from "../lib/repositories";

export type TextSize = "xs" | "s" | "m" | "l" | "xl";

export const TEXT_SIZE_PX: Record<TextSize, number> = {
  xs: 12,
  s: 13,
  m: 14,
  l: 15,
  xl: 16,
};

interface SettingsState {
  appTextSize: TextSize;
  appSidebarPosition: "left" | "right";
  editorSidebarPosition: "left" | "right";
  editorFontSize: number;
  diffViewMode: "inline" | "sideBySide";
  terminalFontSize: number;
  loaded: boolean;

  load: () => Promise<void>;
  setAppTextSize: (v: TextSize) => void;
  setAppSidebarPosition: (v: "left" | "right") => void;
  setEditorSidebarPosition: (v: "left" | "right") => void;
  setEditorFontSize: (v: number) => void;
  setDiffViewMode: (v: "inline" | "sideBySide") => void;
  setTerminalFontSize: (v: number) => void;
}

const VALID_TEXT_SIZES = new Set<string>(["xs", "s", "m", "l", "xl"]);

export const useSettingsStore = create<SettingsState>((set) => ({
  appTextSize: "s",
  appSidebarPosition: "left",
  editorSidebarPosition: "left",
  editorFontSize: 13,
  diffViewMode: "inline",
  terminalFontSize: 13,
  loaded: false,

  async load() {
    const [appTextSize, appSidebar, editorSidebar, editorFont, diffView, termFont] = await Promise.all([
      getSetting("appTextSize"),
      getSetting("appSidebarPosition"),
      getSetting("editorSidebarPosition"),
      getSetting("editorFontSize"),
      getSetting("diffViewMode"),
      getSetting("terminalFontSize"),
    ]);
    set({
      appTextSize: appTextSize && VALID_TEXT_SIZES.has(appTextSize) ? appTextSize as TextSize : "s",
      appSidebarPosition: appSidebar === "right" ? "right" : "left",
      editorSidebarPosition: editorSidebar === "right" ? "right" : "left",
      editorFontSize: editorFont ? Number(editorFont) : 13,
      diffViewMode: diffView === "sideBySide" ? "sideBySide" : "inline",
      terminalFontSize: termFont ? Number(termFont) : 13,
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
}));
