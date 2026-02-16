import { useState } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sendNotification } from "../../lib/notifications";
import type { Task } from "../../lib/types";

interface TaskCreateProps {
  projectId: string;
  onClose: () => void;
  task?: Task;
}

export function TaskCreate({ projectId, onClose, task }: TaskCreateProps) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const isEditing = !!task;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    try {
      if (isEditing) {
        await updateTask(projectId, task.id, { title: title.trim() });
        sendNotification("Task updated", title.trim());
      } else {
        await addTask(projectId, title.trim());
        sendNotification("Task created", title.trim());
      }
      onClose();
    } catch (err) {
      setError(`Failed to ${isEditing ? "update" : "create"} task: ${err}`);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Task" : "New Task"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div>
            <Label>Title</Label>
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
              className="mt-1"
            />
          </div>
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              {isEditing ? "Save" : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
