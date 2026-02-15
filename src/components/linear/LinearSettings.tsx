import { useState } from "react";
import { useLinearStore } from "../../stores/linearStore";

interface LinearSettingsProps {
  projectId: string;
  onClose: () => void;
}

export function LinearSettings({ projectId, onClose }: LinearSettingsProps) {
  const { apiKey, userName, orgName, loading, error, saveApiKey, disconnect, clearError } =
    useLinearStore();
  const [keyInput, setKeyInput] = useState("");

  const connected = !!apiKey && !!userName;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    const ok = await saveApiKey(projectId, keyInput.trim());
    if (ok) setKeyInput("");
  };

  const handleDisconnect = async () => {
    await disconnect(projectId);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[480px] max-w-[90vw]">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">
          Linear Integration
        </h2>

        {connected ? (
          <div>
            <div className="flex items-center gap-2 mb-4 p-3 bg-zinc-800 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-sm text-zinc-300">
                Connected as <span className="font-medium text-zinc-100">{userName}</span>
                {orgName && (
                  <span className="text-zinc-400"> ({orgName})</span>
                )}
              </span>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 text-sm bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleConnect}>
            <div className="mb-4">
              <label className="block text-sm text-zinc-400 mb-1">
                Personal API Key
              </label>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  if (error) clearError();
                }}
                className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                placeholder="lin_api_..."
                autoFocus
              />
              {error && (
                <p className="text-xs text-red-400 mt-1">{error}</p>
              )}
              <p className="text-xs text-zinc-500 mt-2">
                Generate a key at{" "}
                <span className="text-zinc-400">
                  Linear Settings &gt; API &gt; Personal API keys
                </span>
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!keyInput.trim() || loading}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
              >
                {loading ? "Verifying..." : "Connect"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
