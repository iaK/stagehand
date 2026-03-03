import { useEffect, useState } from "react";
import { ThemeProvider } from "next-themes";
import { Layout } from "./components/layout/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SetupWizard } from "./components/onboarding/SetupWizard";
import { checkAgentAvailable } from "./lib/agent";
import { getSetting, setSetting } from "./lib/repositories";
import { useProjectStore } from "./stores/projectStore";
import { useOrphanedProcessCleanup } from "./hooks/useOrphanedProcessCleanup";
import { requestNotificationPermission, registerNotificationClickHandler } from "./lib/notifications";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

function App() {
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState<boolean | null>(null); // null = loading
  useOrphanedProcessCleanup();

  useEffect(() => {
    requestNotificationPermission();
    const unregisterPromise = registerNotificationClickHandler();
    checkAgentAvailable().catch((err) => {
      setClaudeError(String(err));
    });

    // Check if we need to show the setup wizard
    (async () => {
      try {
        const completed = await getSetting("setup_wizard_completed");
        if (completed === "true") {
          setShowWizard(false);
          return;
        }
        // Not completed — check if there are existing projects (existing user)
        await useProjectStore.getState().loadProjects();
        const projects = useProjectStore.getState().projects;
        if (projects.length > 0) {
          // Existing user with projects — skip wizard, mark as done
          await setSetting("setup_wizard_completed", "true");
          setShowWizard(false);
        } else {
          setShowWizard(true);
        }
      } catch {
        // If settings DB isn't ready yet, skip wizard
        setShowWizard(false);
      }
    })();

    return () => {
      unregisterPromise.then((u) => u.unregister());
    };
  }, []);

  const handleWizardComplete = async () => {
    await setSetting("setup_wizard_completed", "true");
    setShowWizard(false);
  };

  // Still loading — show nothing while we check
  if (showWizard === null) {
    return (
      <ErrorBoundary>
        <ThemeProvider attribute="class" defaultTheme="system" storageKey="stagehand-theme">
          <div className="h-screen" />
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  if (showWizard) {
    return (
      <ErrorBoundary>
        <ThemeProvider attribute="class" defaultTheme="system" storageKey="stagehand-theme">
          <TooltipProvider>
            <SetupWizard onComplete={handleWizardComplete} />
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
    <ThemeProvider attribute="class" defaultTheme="system" storageKey="stagehand-theme">
    <TooltipProvider>
      <div className="h-screen overflow-hidden">
        {claudeError && (
          <Alert className="rounded-none border-x-0 border-t-0 border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <AlertDescription className="flex items-center gap-2 text-amber-800 dark:text-amber-400">
              <span>
                Claude Code CLI not found. Install it to use Stagehand.
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setClaudeError(null)}
                className="ml-auto text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
              >
                &times;
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Layout />
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
