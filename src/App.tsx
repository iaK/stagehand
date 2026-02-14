import { useEffect, useState } from "react";
import { Layout } from "./components/layout/Layout";
import { checkClaudeAvailable } from "./lib/claude";

function App() {
  const [claudeError, setClaudeError] = useState<string | null>(null);

  useEffect(() => {
    checkClaudeAvailable().catch((err) => {
      setClaudeError(String(err));
    });
  }, []);

  return (
    <div className="h-screen overflow-hidden">
      {claudeError && (
        <div className="bg-amber-900/50 border-b border-amber-700 px-4 py-2 text-sm text-amber-200 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span>
            Claude Code CLI not found. Install it to use Stagehand.
          </span>
          <button
            onClick={() => setClaudeError(null)}
            className="ml-auto text-amber-400 hover:text-amber-200"
          >
            &times;
          </button>
        </div>
      )}
      <Layout />
    </div>
  );
}

export default App;
