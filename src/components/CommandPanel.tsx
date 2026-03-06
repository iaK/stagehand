import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { statusColors } from "../lib/taskStatus";
import * as repo from "../lib/repositories";
import type { Task } from "../lib/types";
import { Settings, SlidersHorizontal, Inbox } from "lucide-react";

const MAX_RECENT = 5;
const RECENT_TASKS_KEY = "recentTasks";

interface RecentTaskEntry {
  projectId: string;
  taskId: string;
  visitedAt: number;
}

async function loadRecentTasks(): Promise<RecentTaskEntry[]> {
  const raw = await repo.getSetting(RECENT_TASKS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveRecentTasks(entries: RecentTaskEntry[]): Promise<void> {
  await repo.setSetting(RECENT_TASKS_KEY, JSON.stringify(entries.slice(0, MAX_RECENT)));
}

export async function addRecentTask(projectId: string, taskId: string): Promise<void> {
  const entries = await loadRecentTasks();
  const filtered = entries.filter(e => !(e.projectId === projectId && e.taskId === taskId));
  filtered.unshift({ projectId, taskId, visitedAt: Date.now() });
  await saveRecentTasks(filtered.slice(0, MAX_RECENT));
}

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

interface TaskEntry {
  projectId: string;
  projectName: string;
  task: Task;
}

interface CommandItem {
  type: "task" | "action";
  id: string;
  label: string;
  sublabel?: string;
  dotClass?: string;
  actionId?: string;
  data?: TaskEntry;
}

export function CommandPanel({
  onClose,
  onOpenProjectSettings,
  onOpenAppSettings,
  onOpenPrReviews,
}: {
  onClose: () => void;
  onOpenProjectSettings: () => void;
  onOpenAppSettings: () => void;
  onOpenPrReviews: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allTasks, setAllTasks] = useState<TaskEntry[]>([]);
  const [recentEntries, setRecentEntries] = useState<RecentTaskEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => s.activeProject);

  // Load all tasks from all projects + recent entries
  useEffect(() => {
    (async () => {
      const [recents, ...taskResults] = await Promise.all([
        loadRecentTasks(),
        ...projects.map(async (p) => {
          try {
            const tasks = await repo.listTasks(p.id);
            return tasks.map(t => ({ projectId: p.id, projectName: p.name, task: t }));
          } catch { return [] as TaskEntry[]; }
        }),
      ]);
      setRecentEntries(recents);
      setAllTasks(taskResults.flat());
      setLoading(false);
    })();
  }, [projects]);

  // Focus input
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Action items
  const actions: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];
    if (activeProject) {
      items.push({
        type: "action",
        id: "project-settings",
        actionId: "project-settings",
        label: "Project Settings",
        sublabel: activeProject.name,
      });
    }
    items.push({
      type: "action",
      id: "app-settings",
      actionId: "app-settings",
      label: "App Settings",
      sublabel: "Theme, keybindings, editor",
    });
    items.push({
      type: "action",
      id: "pr-reviews",
      actionId: "pr-reviews",
      label: "PR Reviews",
      sublabel: "PRs needing your review",
    });
    return items;
  }, [activeProject]);

  // Recent task items
  const recentItems: CommandItem[] = useMemo(() => {
    return recentEntries
      .map(entry => {
        const taskEntry = allTasks.find(
          t => t.projectId === entry.projectId && t.task.id === entry.taskId,
        );
        if (!taskEntry) return null;
        return {
          type: "task" as const,
          id: `recent:${entry.taskId}`,
          label: taskEntry.task.title,
          sublabel: taskEntry.projectName,
          dotClass: statusColors[taskEntry.task.status] ?? "bg-zinc-400",
          data: taskEntry,
        };
      })
      .filter(Boolean) as CommandItem[];
  }, [recentEntries, allTasks]);

  // Build visible items list
  const items: CommandItem[] = useMemo(() => {
    if (!query.trim()) {
      return [...recentItems, ...actions];
    }

    const matchingTasks = allTasks
      .filter(t => fuzzyMatch(query, `${t.projectName} ${t.task.title}`))
      .slice(0, 20)
      .map(t => ({
        type: "task" as const,
        id: t.task.id,
        label: t.task.title,
        sublabel: t.projectName,
        dotClass: statusColors[t.task.status] ?? "bg-zinc-400",
        data: t,
      }));

    const matchingActions = actions.filter(a =>
      fuzzyMatch(query, `${a.label} ${a.sublabel ?? ""}`),
    );

    return [...matchingTasks, ...matchingActions];
  }, [query, allTasks, recentItems, actions]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected into view
  useEffect(() => {
    document
      .querySelector(`[data-cmd-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const selectItem = useCallback(
    (item: CommandItem) => {
      if (item.type === "task" && item.data) {
        const { projectId, task } = item.data;
        const currentProject = useProjectStore.getState().activeProject;

        if (currentProject?.id !== projectId) {
          // Cross-project: write task ID directly so Sidebar restores it
          const project = useProjectStore.getState().projects.find(p => p.id === projectId);
          if (project) {
            repo.setProjectSetting(projectId, "nav:lastTaskId", task.id).then(() => {
              useProjectStore.getState().setActiveProject(project);
            });
          }
        } else {
          // Same project: set active task directly
          const tasks = useTaskStore.getState().tasks;
          const found = tasks.find(t => t.id === task.id);
          if (found) {
            useTaskStore.getState().setActiveTask(found);
          }
        }

        addRecentTask(projectId, task.id);
        onClose();
      } else if (item.type === "action") {
        onClose();
        if (item.actionId === "project-settings") onOpenProjectSettings();
        else if (item.actionId === "app-settings") onOpenAppSettings();
        else if (item.actionId === "pr-reviews") onOpenPrReviews();
      }
    },
    [onClose, onOpenProjectSettings, onOpenAppSettings],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items[selectedIndex]) selectItem(items[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [items, selectedIndex, selectItem, onClose],
  );

  // Determine section boundaries for headers
  const firstActionIndex = items.findIndex(i => i.type === "action");
  const hasRecent = !query.trim() && recentItems.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center pt-[15%]"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[90vw] h-fit max-h-[70vh] flex flex-col bg-popover border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="w-full px-4 py-3.5 text-base bg-transparent border-b border-border outline-none placeholder:text-muted-foreground"
          placeholder="Search tasks, settings..."
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div ref={listRef} className="overflow-y-auto max-h-[60vh] py-1">
          {loading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              Loading...
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              No results
            </div>
          ) : (
            <>
              {items.map((item, i) => {
                const showRecentHeader = hasRecent && i === 0;
                const showActionsHeader =
                  !query.trim() && i === firstActionIndex && firstActionIndex >= 0;

                return (
                  <div key={item.id}>
                    {showRecentHeader && (
                      <div className="px-4 pt-3 pb-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Recent
                      </div>
                    )}
                    {showActionsHeader && (
                      <div className="px-4 pt-3 pb-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Actions
                      </div>
                    )}
                    <button
                      data-cmd-index={i}
                      className={`flex items-center gap-3 w-full text-left px-4 py-2.5 text-sm ${
                        i === selectedIndex
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50"
                      }`}
                      onClick={() => selectItem(item)}
                      onMouseEnter={() => setSelectedIndex(i)}
                    >
                      {item.type === "task" ? (
                        <div
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${item.dotClass}`}
                        />
                      ) : item.actionId === "app-settings" ? (
                        <Settings className="w-4 h-4 shrink-0 text-muted-foreground" />
                      ) : item.actionId === "pr-reviews" ? (
                        <Inbox className="w-4 h-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <SlidersHorizontal className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{item.label}</span>
                      {item.sublabel && (
                        <span className="ml-auto text-xs text-muted-foreground truncate max-w-[200px]">
                          {item.sublabel}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
