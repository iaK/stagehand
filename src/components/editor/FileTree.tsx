import { useState, useEffect, useCallback } from "react";
import { ChevronRight, ChevronDown, File, Folder } from "lucide-react";
import { runGit } from "../../lib/git";
import { useEditorStore } from "../../stores/editorStore";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: string[], rootPath: string): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const partialPath = parts.slice(0, i + 1).join("/");

      let existing = current.find((n) => n.name === name);
      if (!existing) {
        existing = {
          name,
          path: isLast ? `${rootPath}/${file}` : `${rootPath}/${partialPath}`,
          isDir: !isLast,
          children: [],
        };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  // Sort: directories first, then alphabetical
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
    return nodes;
  };

  return sortNodes(root);
}

interface FileTreeNodeProps {
  node: TreeNode;
  depth: number;
  gitStatusMap: Map<string, string>;
  rootPath: string;
}

function FileTreeNode({ node, depth, gitStatusMap, rootPath }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const activeFilePath = useEditorStore((s) => s.activeFilePath());
  const openFile = useEditorStore((s) => s.openFile);

  const isActive = activeFilePath === node.path;
  const relativePath = node.path.startsWith(rootPath + "/")
    ? node.path.slice(rootPath.length + 1)
    : node.name;
  const statusIndicator = gitStatusMap.get(relativePath);

  if (node.isDir) {
    return (
      <div>
        <button
          className="flex items-center w-full text-left py-0.5 px-1 hover:bg-accent/50 rounded-sm gap-1"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
          )}
          <Folder className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                gitStatusMap={gitStatusMap}
                rootPath={rootPath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={`flex items-center w-full text-left py-0.5 px-1 rounded-sm gap-1 ${
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      }`}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      onClick={() => openFile(node.path)}
    >
      <span className="w-3 h-3 shrink-0" /> {/* spacer matching chevron */}
      <File className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
      {/* Git status indicators: Yellow for modified (M), Green for untracked (?) */}
      {statusIndicator === "M" && (
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0 ml-auto" />
      )}
      {statusIndicator === "?" && (
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 ml-auto" />
      )}
    </button>
  );
}

interface FileTreeProps {
  workingDir: string;
}

export function FileTree({ workingDir }: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const loadFiles = useCallback(async () => {
    try {
      const output = await runGit(workingDir, "ls-files");
      const files = output.trim().split("\n").filter((f) => f.length > 0);
      setTree(buildTree(files, workingDir));
    } catch {
      setTree([]);
    }
    setLoading(false);
  }, [workingDir]);

  const loadGitStatus = useCallback(async () => {
    try {
      const status = await runGit(workingDir, "status", "--porcelain");
      const map = new Map<string, string>();
      for (const line of status.trim().split("\n")) {
        if (!line) continue;
        const code = line[1] === " " ? line[0] : line[1];
        const relativePath = line.slice(3).trim();
        if (code === "?" || code === "M" || code === "A") {
          map.set(relativePath, code === "?" ? "?" : "M");
        }
      }
      setGitStatusMap(map);
    } catch {
      // ignore
    }
  }, [workingDir]);

  useEffect(() => {
    loadFiles();
    loadGitStatus();
  }, [loadFiles, loadGitStatus]);

  if (loading) {
    return (
      <div className="p-2 text-muted-foreground">Loading files...</div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="p-2 text-muted-foreground">No files found</div>
    );
  }

  return (
    <div className="py-1 overflow-y-auto h-full select-none">
      {tree.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={0} gitStatusMap={gitStatusMap} rootPath={workingDir} />
      ))}
    </div>
  );
}
