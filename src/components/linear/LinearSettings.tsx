import { useState, useEffect } from "react";
import { useLinearStore } from "../../stores/linearStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendNotification } from "../../lib/notifications";

interface LinearSettingsProps {
  projectId: string;
  onClose: () => void;
}

export function LinearSettings({ projectId, onClose }: LinearSettingsProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Linear Integration</DialogTitle>
        </DialogHeader>
        <LinearSettingsContent projectId={projectId} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LinearSettingsContent({ projectId }: { projectId: string }) {
  const {
    apiKey, userName, orgName, loading, error,
    teams, projects, selectedTeamId, selectedProjectId,
    teamsLoading, projectsLoading,
    saveApiKey, disconnect, clearError,
    fetchTeams, fetchProjects, selectTeam, selectProject,
  } = useLinearStore();
  const [keyInput, setKeyInput] = useState("");

  const connected = !!apiKey && !!userName;

  // Load teams when connected
  useEffect(() => {
    if (connected && teams.length === 0) {
      fetchTeams();
    }
  }, [connected, teams.length, fetchTeams]);

  // Load projects when team is selected
  useEffect(() => {
    if (connected && selectedTeamId) {
      fetchProjects(selectedTeamId);
    }
  }, [connected, selectedTeamId, fetchProjects]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    const ok = await saveApiKey(projectId, keyInput.trim());
    if (ok) {
      setKeyInput("");
      sendNotification("Linear connected", `Signed in successfully`, "success", { projectId });
    }
  };

  const handleDisconnect = async () => {
    await disconnect(projectId);
    sendNotification("Linear disconnected", undefined, "info", { projectId });
  };

  const handleTeamChange = async (teamId: string) => {
    const team = teams.find((t) => t.id === teamId);
    if (team) {
      await selectTeam(projectId, team.id, team.name);
    }
  };

  const handleProjectChange = async (value: string) => {
    if (value === "__none__") {
      await selectProject(projectId, null, null);
    } else {
      const proj = projects.find((p) => p.id === value);
      if (proj) {
        await selectProject(projectId, proj.id, proj.name);
      }
    }
  };

  if (connected) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4 p-3 bg-muted rounded-lg">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm text-muted-foreground">
            Connected as <span className="font-medium text-foreground">{userName}</span>
            {orgName && (
              <span className="text-muted-foreground"> ({orgName})</span>
            )}
          </span>
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <Label className="text-xs text-muted-foreground">Team</Label>
            <Select
              value={selectedTeamId ?? undefined}
              onValueChange={handleTeamChange}
              disabled={teamsLoading}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={teamsLoading ? "Loading teams..." : "Select a team"} />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.key} — {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTeamId && (
            <div>
              <Label className="text-xs text-muted-foreground">Project (optional)</Label>
              <Select
                value={selectedProjectId ?? "__none__"}
                onValueChange={handleProjectChange}
                disabled={projectsLoading}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={projectsLoading ? "Loading projects..." : "All projects"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">All projects</SelectItem>
                  {projects.map((proj) => (
                    <SelectItem key={proj.id} value={proj.id}>
                      {proj.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="destructive" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleConnect}>
      <div className="mb-4">
        <Label>Personal API Key</Label>
        <Input
          type="password"
          value={keyInput}
          onChange={(e) => {
            setKeyInput(e.target.value);
            if (error) clearError();
          }}
          placeholder="lin_api_..."
          autoFocus
          className="mt-1"
        />
        {error && (
          <p className="text-xs text-destructive mt-1">{error}</p>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          Generate a key at{" "}
          <span className="text-foreground">
            Linear Settings &gt; API &gt; Personal API keys
          </span>
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!keyInput.trim() || loading}>
          {loading ? "Verifying..." : "Connect"}
        </Button>
      </div>
    </form>
  );
}
