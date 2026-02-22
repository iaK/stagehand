import { useEffect, useState } from "react";
import { getProjectSetting, setProjectSetting, deleteProjectSetting } from "../../lib/repositories";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendNotification } from "../../lib/notifications";
import { Skeleton } from "@/components/ui/skeleton";
import { AVAILABLE_AGENTS } from "../../lib/agents";

export function AgentSettingsContent({ projectId }: { projectId: string }) {
  const [defaultAgent, setDefaultAgent] = useState<string>("claude");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await getProjectSetting(projectId, "default_agent");
      if (saved) setDefaultAgent(saved);
      setLoading(false);
    })();
  }, [projectId]);

  const handleSave = async () => {
    setSaving(true);
    if (defaultAgent === "claude") {
      await deleteProjectSetting(projectId, "default_agent");
    } else {
      await setProjectSetting(projectId, "default_agent", defaultAgent);
    }
    setSaving(false);
    sendNotification("AI Agent settings saved", "", "success", { projectId });
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">AI Agents</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the default AI agent for this project's pipeline stages.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4 py-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-semibold">Default Agent</Label>
            <Select value={defaultAgent} onValueChange={setDefaultAgent}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_AGENTS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    <div>
                      <span className="font-medium">{a.label}</span>
                      <span className="text-muted-foreground text-xs ml-2">{a.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Individual stages can override this in the Pipeline settings.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end pt-6">
        <Button onClick={handleSave} disabled={saving || loading}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </>
  );
}
