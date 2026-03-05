import { useEffect } from "react";
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { KeyMod, KeyCode } from "monaco-editor";
import { useTheme } from "next-themes";
import { X, Lock, RefreshCw } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import { useProcessStore } from "../../stores/processStore";
import { useTaskStore } from "../../stores/taskStore";
import { useSettingsStore } from "../../stores/settingsStore";

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  // JavaScript / TypeScript
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  // Web
  html: "html",
  htm: "html",
  xhtml: "html",
  css: "css",
  scss: "scss",
  less: "less",
  // Data / Config
  json: "json",
  jsonc: "json",
  json5: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "ini",
  env: "ini",
  xml: "xml",
  svg: "xml",
  xsl: "xml",
  xslt: "xml",
  plist: "xml",
  graphql: "graphql",
  gql: "graphql",
  // Markdown / Text
  md: "markdown",
  mdx: "markdown",
  txt: "plaintext",
  log: "plaintext",
  // Shell
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ksh: "shell",
  csh: "shell",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "bat",
  cmd: "bat",
  // Systems
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  hh: "cpp",
  rs: "rust",
  go: "go",
  zig: "zig",
  // JVM
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  sc: "scala",
  groovy: "groovy",
  gradle: "groovy",
  // .NET
  cs: "csharp",
  csx: "csharp",
  fs: "fsharp",
  fsx: "fsharp",
  vb: "vb",
  // Scripting
  py: "python",
  pyw: "python",
  pyi: "python",
  rb: "ruby",
  erb: "html",
  rake: "ruby",
  gemspec: "ruby",
  php: "php",
  phtml: "php",
  pl: "perl",
  pm: "perl",
  lua: "lua",
  r: "r",
  R: "r",
  jl: "julia",
  // Functional
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  hs: "haskell",
  lhs: "haskell",
  ml: "fsharp",
  mli: "fsharp",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  lisp: "scheme",
  cl: "scheme",
  scm: "scheme",
  rkt: "scheme",
  // Apple
  swift: "swift",
  m: "objective-c",
  mm: "objective-c",
  // Mobile
  dart: "dart",
  // Database
  sql: "sql",
  mysql: "sql",
  pgsql: "sql",
  // DevOps / IaC
  dockerfile: "dockerfile",
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
  // Templates
  hbs: "handlebars",
  handlebars: "handlebars",
  mustache: "handlebars",
  pug: "pug",
  jade: "pug",
  ejs: "html",
  twig: "twig",
  // Misc
  proto: "protobuf",
  sol: "sol",
  asm: "mips",
  s: "mips",
  pas: "pascal",
  pp: "pascal",
  coffee: "coffeescript",
  tex: "latex",
  ltx: "latex",
  bib: "bibtex",
  diff: "diff",
  patch: "diff",
  v: "systemverilog",
  sv: "systemverilog",
  vhd: "vhdl",
  vhdl: "vhdl",
  tcl: "tcl",
  tk: "tcl",
  cmake: "cmake",
  mk: "makefile",
  rst: "restructuredtext",
  adoc: "plaintext",
  csv: "plaintext",
  tsv: "plaintext",
};

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp",
  "woff", "woff2", "ttf", "eot", "otf",
  "zip", "tar", "gz", "bz2", "7z", "rar",
  "pdf", "doc", "docx", "xls", "xlsx",
  "mp3", "mp4", "avi", "mov", "wav",
  "exe", "dll", "so", "dylib",
]);

function getLanguage(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? "";
  const lowerName = fileName.toLowerCase();

  // Special filenames
  if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) return "dockerfile";
  if (lowerName === "makefile" || lowerName === "gnumakefile") return "makefile";
  if (lowerName === "cmakelists.txt") return "cmake";
  if (lowerName === "gemfile" || lowerName === "rakefile" || lowerName === "guardfile") return "ruby";
  if (lowerName === "vagrantfile") return "ruby";
  if (lowerName === ".gitignore" || lowerName === ".dockerignore" || lowerName === ".editorconfig") return "ini";
  if (lowerName === "jenkinsfile") return "groovy";
  if (lowerName === "podfile") return "ruby";

  const ext = lowerName.split(".").pop() ?? "";
  return EXTENSION_LANGUAGE_MAP[ext] ?? "plaintext";
}

function isBinaryFile(filePath: string): boolean {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export function CodeEditor() {
  const { resolvedTheme } = useTheme();
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFileKey = useEditorStore((s) => s.activeFileKey);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const updateFileContent = useEditorStore((s) => s.updateFileContent);
  const saveError = useEditorStore((s) => s.saveError);
  const clearSaveError = useEditorStore((s) => s.clearSaveError);
  const isSaving = useEditorStore((s) => s.isSaving);
  const originalContent = useEditorStore((s) => s.originalContent);

  const reloadFileFromDisk = useEditorStore((s) => s.reloadFileFromDisk);
  const dismissDiskChanged = useEditorStore((s) => s.dismissDiskChanged);

  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const diffViewMode = useSettingsStore((s) => s.diffViewMode);

  const activeTaskId = useTaskStore((s) => s.activeTask?.id);
  const isAgentRunning = useProcessStore((s) => {
    if (!activeTaskId) return false;
    return Object.entries(s.stages).some(
      ([key, state]) => key.startsWith(`${activeTaskId}:`) && state.isRunning,
    );
  });

  const activeFile = openFiles.find((f) => f.key === activeFileKey);
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const handleEditorMount: OnMount = (editor) => {
    editor.addAction({
      id: "save-file",
      label: "Save File",
      keybindings: [
        KeyMod.CtrlCmd | KeyCode.KeyS,
      ],
      run: async () => {
        const key = useEditorStore.getState().activeFileKey;
        if (key) await useEditorStore.getState().saveFile(key);
      },
    });
  };

  if (openFiles.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a file from the tree to start editing
      </div>
    );
  }

  const fileName = (path: string) => path.split("/").pop() ?? path;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center overflow-x-auto flex-1">
          {openFiles.map((file) => {
            const isActive = file.key === activeFileKey;
            const isSavingThisFile = isSaving && isActive;
            return (
              <div
                key={file.key}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-border shrink-0 ${
                  isActive
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-background/50"
                }`}
                onClick={() => setActiveFile(file.key)}
              >
                <span className="truncate max-w-[160px]">
                  {fileName(file.path)}
                  {file.isDiff && (
                    <span className="text-muted-foreground ml-1">(diff)</span>
                  )}
                </span>
                {isSavingThisFile ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 animate-pulse" />
                ) : file.isDirty ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                ) : null}
                <button
                  className="ml-1 hover:bg-accent rounded p-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFile(file.key);
                  }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Read-only banner when agent is running */}
      {isAgentRunning && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-b border-yellow-500/20">
          <Lock className="w-3 h-3 shrink-0" />
          <span>Editor is read-only while the agent is running</span>
        </div>
      )}

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-destructive/10 text-destructive border-b border-destructive/20">
          <span className="truncate">Save failed: {saveError}</span>
          <button className="ml-auto shrink-0 hover:underline" onClick={clearSaveError}>
            Dismiss
          </button>
        </div>
      )}

      {/* Disk changed banner */}
      {activeFile?.diskChanged && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-orange-500/10 text-orange-600 dark:text-orange-400 border-b border-orange-500/20">
          <RefreshCw className="w-3 h-3 shrink-0" />
          <span className="truncate">
            This file changed on disk. You have unsaved edits — save to keep your version, or reload to use the disk version.
          </span>
          <button
            className="ml-auto shrink-0 hover:underline font-medium"
            onClick={() => activeFileKey && reloadFileFromDisk(activeFileKey)}
          >
            Reload
          </button>
          <button
            className="shrink-0 hover:underline"
            onClick={() => activeFileKey && dismissDiskChanged(activeFileKey)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Editor area */}
      {activeFile && (
        isBinaryFile(activeFile.path) ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Binary file — cannot edit
          </div>
        ) : activeFile.isDiff ? (
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <DiffEditor
              key={activeFile.key}
              theme={monacoTheme}
              language={getLanguage(activeFile.path)}
              original={originalContent[activeFile.path] ?? ""}
              modified={activeFile.content}
              onMount={(editor) => {
                const modified = editor.getModifiedEditor();
                modified.onDidChangeModelContent(() => {
                  const key = useEditorStore.getState().activeFileKey;
                  if (key) {
                    updateFileContent(key, modified.getValue());
                  }
                });
                modified.addAction({
                  id: "save-file",
                  label: "Save File",
                  keybindings: [KeyMod.CtrlCmd | KeyCode.KeyS],
                  run: async () => {
                    const k = useEditorStore.getState().activeFileKey;
                    if (k) await useEditorStore.getState().saveFile(k);
                  },
                });
              }}
              options={{
                minimap: { enabled: false },
                fontSize: editorFontSize,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                automaticLayout: true,
                readOnly: isAgentRunning,
                renderSideBySide: diffViewMode === "sideBySide",
              }}
            />
          </div>
        ) : (
          <Editor
            theme={monacoTheme}
            language={getLanguage(activeFile.path)}
            value={activeFile.content}
            onChange={(value) => {
              if (value !== undefined && activeFileKey) {
                updateFileContent(activeFileKey, value);
              }
            }}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: editorFontSize,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2,
              readOnly: isAgentRunning,
            }}
          />
        )
      )}

    </div>
  );
}
