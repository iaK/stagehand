import Editor, { type OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { X } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  dockerfile: "dockerfile",
  graphql: "graphql",
  gql: "graphql",
};

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
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
  if (lowerName === "dockerfile") return "dockerfile";
  if (lowerName === "makefile") return "makefile";

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
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const updateFileContent = useEditorStore((s) => s.updateFileContent);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const handleEditorMount: OnMount = (editor) => {
    // Add Cmd+S / Ctrl+S save action scoped to Monaco
    editor.addAction({
      id: "save-file",
      label: "Save File",
      keybindings: [
        // Monaco KeyMod.CtrlCmd = 2048, KeyCode.KeyS = 49
        2048 | 49,
      ],
      run: () => {
        const path = useEditorStore.getState().activeFilePath;
        if (path) useEditorStore.getState().saveFile(path);
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
      <div className="flex items-center border-b border-border bg-muted/30 overflow-x-auto shrink-0">
        {openFiles.map((file) => {
          const isActive = file.path === activeFilePath;
          return (
            <div
              key={file.path}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-border shrink-0 ${
                isActive
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/50"
              }`}
              onClick={() => setActiveFile(file.path)}
            >
              <span className="truncate max-w-[120px]">{fileName(file.path)}</span>
              {file.isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
              )}
              <button
                className="ml-1 hover:bg-accent rounded p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.path);
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Editor area */}
      {activeFile && (
        isBinaryFile(activeFile.path) ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Binary file — cannot edit
          </div>
        ) : (
          <Editor
            key={activeFile.path}
            theme={monacoTheme}
            language={getLanguage(activeFile.path)}
            value={activeFile.content}
            onChange={(value) => {
              if (value !== undefined) {
                updateFileContent(activeFile.path, value);
              }
            }}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        )
      )}
    </div>
  );
}
