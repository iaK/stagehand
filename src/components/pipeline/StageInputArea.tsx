import { MarkdownTextarea } from "../ui/MarkdownTextarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface StageInputAreaProps {
  needsUserInput: boolean;
  userInput: string;
  onUserInputChange: (value: string) => void;
  stageError: string | null;
  isRunning: boolean;
  onRun: () => void;
}

export function StageInputArea({
  needsUserInput,
  userInput,
  onUserInputChange,
  stageError,
  isRunning,
  onRun,
}: StageInputAreaProps) {
  return (
    <div className="mb-6">
      {needsUserInput && (
        <div className="mb-4">
          <Label>Describe what you need</Label>
          <MarkdownTextarea
            value={userInput}
            onChange={onUserInputChange}
            rows={4}
            placeholder="Enter additional context..."
            className="mt-2"
          />
        </div>
      )}
      {stageError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{stageError}</AlertDescription>
        </Alert>
      )}
      <Button onClick={onRun} disabled={isRunning}>
        Run Stage
      </Button>
    </div>
  );
}
