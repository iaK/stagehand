import { useState } from "react";
import { useLinearStore } from "../../stores/linearStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
  const { apiKey, userName, orgName, loading, error, saveApiKey, disconnect, clearError } =
    useLinearStore();
  const [keyInput, setKeyInput] = useState("");

  const connected = !!apiKey && !!userName;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    const ok = await saveApiKey(projectId, keyInput.trim());
    if (ok) {
      setKeyInput("");
      sendNotification("Linear connected", `Signed in successfully`, { projectId });
    }
  };

  const handleDisconnect = async () => {
    await disconnect(projectId);
    sendNotification("Linear disconnected", undefined, { projectId });
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
