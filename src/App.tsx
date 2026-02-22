import { useEffect, useState } from "react";
import { ThemeProvider } from "next-themes";
import { Layout } from "./components/layout/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { checkAgentAvailable } from "./lib/agent";
import { useOrphanedProcessCleanup } from "./hooks/useOrphanedProcessCleanup";
import { requestNotificationPermission, registerNotificationClickHandler } from "./lib/notifications";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

function App() {
  const [claudeError, setClaudeError] = useState<string | null>(null);
  useOrphanedProcessCleanup();

  useEffect(() => {
    requestNotificationPermission();
    const unregisterPromise = registerNotificationClickHandler();
    checkAgentAvailable().catch((err) => {
      setClaudeError(String(err));
    });
    return () => {
      unregisterPromise.then((u) => u.unregister());
    };
  }, []);

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
