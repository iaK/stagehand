import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../../stores/projectStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sendNotification } from "../../lib/notifications";

interface ProjectCreateProps {
  onClose: () => void;
}

export function ProjectCreate({ onClose }: ProjectCreateProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const addProject = useProjectStore((s) => s.addProject);

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true });
      if (selected) {
        setPath(selected);
        if (!name) {
          const parts = selected.split("/");
          setName(parts[parts.length - 1] || "");
        }
      }
    } catch (err) {
      setError(`Browse failed: ${err}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    setError(null);
    setCreating(true);
    try {
      await addProject(name.trim(), path.trim());
      sendNotification("Project created", name.trim(), "success");
      onClose();
    } catch (err) {
      setError(`Failed to create project: ${err}`);
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label>Project Name</Label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                autoFocus
                className="mt-1"
              />
            </div>
            <div>
              <Label>Project Directory</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/path/to/project"
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={handleBrowse}>
                  Browse
                </Button>
              </div>
            </div>
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
            <Button
              type="submit"
              disabled={!name.trim() || !path.trim() || creating}
            >
              {creating ? "Creating..." : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
