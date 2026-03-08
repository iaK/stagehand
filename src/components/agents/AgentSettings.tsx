import { useState, useEffect } from "react";
import { AVAILABLE_AGENTS } from "../../lib/agents";
import * as repo from "../../lib/repositories";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AgentSettingsContentProps {
  projectId: string;
}

function AgentModelList({ projectId, agentValue, agentLabel }: { projectId: string; agentValue: string; agentLabel: string }) {
  const [models, setModels] = useState<string[]>([]);
  const [newModel, setNewModel] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    repo.getAgentModels(projectId, agentValue).then((m) => {
      setModels(m);
      setLoaded(true);
    });
  }, [projectId, agentValue]);

  const persist = async (updated: string[]) => {
    setModels(updated);
    await repo.setAgentModels(projectId, agentValue, updated);
  };

  const handleAdd = async () => {
    const slug = newModel.trim();
    if (!slug || models.includes(slug)) return;
    await persist([...models, slug]);
    setNewModel("");
  };

  const handleRemove = async (slug: string) => {
    await persist(models.filter((m) => m !== slug));
  };

  if (!loaded) return null;

  return (
    <div>
      <label className="text-sm font-medium text-foreground">{agentLabel} Models</label>
      <div className="flex flex-wrap gap-1.5 mt-1.5 min-h-[28px]">
        {models.map((m) => (
          <span
            key={m}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent text-accent-foreground text-xs font-mono"
          >
            {m}
            <button
              onClick={() => handleRemove(m)}
              className="text-muted-foreground hover:text-destructive ml-0.5"
            >
              &times;
            </button>
          </span>
        ))}
        {models.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No models configured</span>
        )}
      </div>
      <div className="flex gap-2 mt-2">
        <Input
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Add model slug..."
          className="flex-1 font-mono text-xs h-8"
        />
        <Button variant="outline" size="sm" onClick={handleAdd} disabled={!newModel.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

export function AgentSettingsContent({ projectId }: AgentSettingsContentProps) {
  const [defaultAgent, setDefaultAgent] = useState<string>("claude");
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [agentModels, setAgentModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      repo.getProjectSetting(projectId, "default_agent"),
      repo.getProjectSetting(projectId, "default_model"),
    ]).then(([agent, model]) => {
      if (agent) setDefaultAgent(agent);
      setDefaultModel(model ?? "");
      setLoading(false);
    });
  }, [projectId]);

  // Load model list for the current default agent
  useEffect(() => {
    repo.getAgentModels(projectId, defaultAgent).then(setAgentModels);
  }, [projectId, defaultAgent]);

  const handleAgentChange = async (value: string) => {
    setDefaultAgent(value);
    await repo.setProjectSetting(projectId, "default_agent", value);
    // Clear model when agent changes (the model list is different)
    setDefaultModel("");
    await repo.deleteProjectSetting(projectId, "default_model");
  };

  const handleModelChange = async (value: string) => {
    if (value === "__agent_default__") {
      setDefaultModel("");
      await repo.deleteProjectSetting(projectId, "default_model");
    } else {
      setDefaultModel(value);
      await repo.setProjectSetting(projectId, "default_model", value);
    }
  };

  if (loading) return null;

  const visibleAgents = AVAILABLE_AGENTS.filter((a) => !a.hidden);

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">AI Agents</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        Choose the default AI agent and model for this project. Individual stages can override these in the Pipeline settings.
      </p>

      <div className="border border-border rounded-md p-4 space-y-4">
        <div>
          <label className="text-sm font-medium text-foreground">Default Agent</label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">
            Used for all stages unless a stage specifies its own agent.
          </p>
          <Select value={defaultAgent} onValueChange={handleAgentChange}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {visibleAgents.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  <span className="font-medium">{a.label}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{a.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">Default Model</label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">
            Used for all AI calls (stages, commit messages, PR reviews, suggestions) unless overridden per stage.
          </p>
          <Select value={defaultModel || "__agent_default__"} onValueChange={handleModelChange}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__agent_default__">
                <span className="text-muted-foreground">Agent default</span>
              </SelectItem>
              {agentModels.map((m) => (
                <SelectItem key={m} value={m}>
                  <span className="font-mono text-sm">{m}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-foreground mt-6 mb-1">Model Lists</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Configure available models per agent. These appear in the Default Model dropdown above and in the Model Override dropdown when editing stage templates.
      </p>
      <div className="space-y-4">
        {visibleAgents.map((a) => (
          <div key={a.value} className="border border-border rounded-md p-4">
            <AgentModelList projectId={projectId} agentValue={a.value} agentLabel={a.label} />
          </div>
        ))}
      </div>
    </div>
  );
}
