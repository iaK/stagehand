import { useState, useEffect } from "react";
import { AVAILABLE_AGENTS } from "../../lib/agents";
import * as repo from "../../lib/repositories";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AgentSettingsContentProps {
  projectId: string;
}

export function AgentSettingsContent({ projectId }: AgentSettingsContentProps) {
  const [defaultAgent, setDefaultAgent] = useState<string>("claude");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    repo.getProjectSetting(projectId, "default_agent").then((val) => {
      if (val) setDefaultAgent(val);
      setLoading(false);
    });
  }, [projectId]);

  const handleChange = async (value: string) => {
    setDefaultAgent(value);
    await repo.setProjectSetting(projectId, "default_agent", value);
  };

  if (loading) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">AI Agents</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        Choose the default AI coding agent for this project. Individual stages can override this in the Pipeline settings.
      </p>

      <div className="border border-border rounded-md p-4 space-y-3">
        <div>
          <label className="text-sm font-medium text-foreground">Default Agent</label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">
            Used for all stages unless a stage specifies its own agent.
          </p>
          <Select value={defaultAgent} onValueChange={handleChange}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_AGENTS.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  <span className="font-medium">{a.label}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{a.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
