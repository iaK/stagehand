import { useState, useEffect, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../../stores/projectStore";
import { AVAILABLE_AGENTS } from "../../lib/agents";
import { checkAllAgents, checkGhAvailable, checkGhAuth, type ToolStatus } from "../../lib/toolCheck";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface SetupWizardProps {
  onComplete: () => void;
}

type Step = "welcome" | "agents" | "github" | "project";

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>("welcome");

  return (
    <div className="h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        {step === "welcome" && <WelcomeStep onNext={() => setStep("agents")} />}
        {step === "agents" && <AgentStep onNext={() => setStep("github")} />}
        {step === "github" && <GithubStep onNext={() => setStep("project")} />}
        {step === "project" && <ProjectStep onComplete={onComplete} onBack={() => setStep("github")} />}
      </div>
    </div>
  );
}

// Step indicators
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all ${
            i === current ? "w-8 bg-primary" : i < current ? "w-2 bg-primary/50" : "w-2 bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

// Step 1: Welcome
function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <StepIndicator current={0} total={4} />
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to Stagehand</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">
            Stagehand helps you manage AI-assisted development workflows with structured stage pipelines.
          </p>
          <p className="text-muted-foreground text-sm">
            Let's make sure you have everything set up before getting started.
          </p>
          <div className="pt-4">
            <Button onClick={onNext} size="lg">
              Get Started
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// Step 2: AI Agent Check
function AgentStep({ onNext }: { onNext: () => void }) {
  const [agents, setAgents] = useState<Record<string, ToolStatus>>({});
  const [checking, setChecking] = useState(true);

  const runCheck = useCallback(async () => {
    setChecking(true);
    const results = await checkAllAgents();
    setAgents(results);
    setChecking(false);
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const hasAnyAgent = Object.values(agents).some((a) => a.available);
  const visibleAgents = AVAILABLE_AGENTS.filter((a) => !a.hidden || agents[a.value]?.available);

  return (
    <>
      <StepIndicator current={1} total={4} />
      <Card>
        <CardHeader>
          <CardTitle>AI Agent Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Stagehand requires at least one AI coding agent. Checking what's installed…
          </p>

          <div className="space-y-2">
            {visibleAgents.map((agent) => {
              const status = agents[agent.value];
              return (
                <div key={agent.value} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{agent.label}</span>
                    <span className="text-xs text-muted-foreground">{agent.description}</span>
                  </div>
                  {checking ? (
                    <Badge variant="secondary">Checking…</Badge>
                  ) : status?.available ? (
                    <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      Installed
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Not found</Badge>
                  )}
                </div>
              );
            })}
          </div>

          {!checking && !hasAnyAgent && (
            <>
              <Separator />
              <div className="space-y-2 text-sm">
                <p className="font-medium">Install an agent to continue:</p>
                <div className="space-y-1 text-muted-foreground font-mono text-xs">
                  <p>npm install -g @anthropic-ai/claude-code</p>
                  <p>npm install -g @openai/codex</p>
                </div>
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={runCheck} disabled={checking}>
              {checking ? "Checking…" : "Re-check"}
            </Button>
            <Button onClick={onNext} disabled={!hasAnyAgent && !checking}>
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// Step 3: GitHub CLI Check
function GithubStep({ onNext }: { onNext: () => void }) {
  const [ghStatus, setGhStatus] = useState<ToolStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<{ authenticated: boolean; account?: string } | null>(null);
  const [checking, setChecking] = useState(true);

  const runCheck = useCallback(async () => {
    setChecking(true);
    const gh = await checkGhAvailable();
    setGhStatus(gh);
    if (gh.available) {
      const auth = await checkGhAuth();
      setAuthStatus(auth);
    } else {
      setAuthStatus(null);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  return (
    <>
      <StepIndicator current={2} total={4} />
      <Card>
        <CardHeader>
          <CardTitle>GitHub CLI (optional)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The GitHub CLI is needed for PR creation and GitHub features. You can skip this if you don't need those.
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between py-2">
              <span className="font-medium">gh CLI</span>
              {checking ? (
                <Badge variant="secondary">Checking…</Badge>
              ) : ghStatus?.available ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                  v{ghStatus.version}
                </Badge>
              ) : (
                <Badge variant="secondary">Not found</Badge>
              )}
            </div>

            {ghStatus?.available && (
              <div className="flex items-center justify-between py-2">
                <span className="font-medium">Authentication</span>
                {checking ? (
                  <Badge variant="secondary">Checking…</Badge>
                ) : authStatus?.authenticated ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    {authStatus.account ? `Logged in as ${authStatus.account}` : "Logged in"}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not logged in</Badge>
                )}
              </div>
            )}
          </div>

          {!checking && !ghStatus?.available && (
            <>
              <Separator />
              <div className="space-y-2 text-sm">
                <p className="font-medium">To install:</p>
                <p className="text-muted-foreground font-mono text-xs">brew install gh</p>
                <p className="text-muted-foreground text-xs">
                  Or visit{" "}
                  <a href="https://cli.github.com" target="_blank" rel="noreferrer" className="underline">
                    cli.github.com
                  </a>
                </p>
              </div>
            </>
          )}

          {!checking && ghStatus?.available && !authStatus?.authenticated && (
            <>
              <Separator />
              <div className="space-y-2 text-sm">
                <p className="font-medium">To authenticate:</p>
                <p className="text-muted-foreground font-mono text-xs">gh auth login</p>
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={runCheck} disabled={checking}>
              {checking ? "Checking…" : "Re-check"}
            </Button>
            <Button onClick={onNext}>
              {ghStatus?.available ? "Continue" : "Skip"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// Step 4: Create First Project
function ProjectStep({ onComplete, onBack }: { onComplete: () => void; onBack: () => void }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
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
    if (!path.trim().startsWith("/")) {
      setPathError("Path must be absolute (start with /)");
      return;
    }
    setError(null);
    setPathError(null);
    setCreating(true);
    try {
      await addProject(name.trim(), path.trim());
      onComplete();
    } catch (err) {
      setError(`Failed to create project: ${err}`);
      setCreating(false);
    }
  };

  return (
    <>
      <StepIndicator current={3} total={4} />
      <Card>
        <CardHeader>
          <CardTitle>Create Your First Project</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                  onChange={(e) => {
                    setPath(e.target.value);
                    setPathError(null);
                  }}
                  placeholder="/path/to/project"
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={handleBrowse}>
                  Browse
                </Button>
              </div>
              {pathError && <p className="text-xs text-destructive mt-1">{pathError}</p>}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="ghost" onClick={onBack}>
                Back
              </Button>
              <Button type="submit" disabled={!name.trim() || !path.trim() || creating}>
                {creating ? "Creating…" : "Create Project"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
