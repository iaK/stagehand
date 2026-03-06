export type KeyBindingAction =
  | "viewPipeline"
  | "viewEditor"
  | "viewTerminal"
  | "closeTab"
  | "quickOpen";

export const KEYBINDING_ACTIONS: { action: KeyBindingAction; label: string }[] = [
  { action: "viewPipeline", label: "Switch to Pipeline" },
  { action: "viewEditor", label: "Switch to Editor" },
  { action: "viewTerminal", label: "Switch to Terminal" },
  { action: "closeTab", label: "Close Editor Tab" },
  { action: "quickOpen", label: "Command Panel" },
];

export const DEFAULT_KEYBINDINGS: Record<KeyBindingAction, string> = {
  viewPipeline: "Cmd+1",
  viewEditor: "Cmd+2",
  viewTerminal: "Cmd+3",
  closeTab: "Cmd+W",
  quickOpen: "Cmd+P",
};

/** Display a shortcut string with macOS symbols. */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .replace(/Cmd\+/g, "\u2318")
    .replace(/Shift\+/g, "\u21E7")
    .replace(/Alt\+/g, "\u2325");
}

/** Check whether a KeyboardEvent matches a stored shortcut string. */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));

  if (mods.has("cmd") !== (e.metaKey || e.ctrlKey)) return false;
  if (mods.has("shift") !== e.shiftKey) return false;
  if (mods.has("alt") !== e.altKey) return false;

  return e.key.toLowerCase() === key.toLowerCase();
}

/** Build a shortcut string from a KeyboardEvent (for the recorder). Returns null for bare modifier keys. */
export function shortcutFromEvent(e: KeyboardEvent): string | null {
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return null;
  if (!(e.metaKey || e.ctrlKey)) return null;

  const parts: string[] = ["Cmd"];
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  let key = e.key;
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);

  return parts.join("+");
}
