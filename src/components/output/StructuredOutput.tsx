import { useState } from "react";
import { MarkdownTextarea } from "../ui/MarkdownTextarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { StageTemplate, GateRule } from "../../lib/types";

interface StructuredOutputProps {
  output: string;
  stage: StageTemplate;
  onSubmit: (fields: Record<string, string>) => void;
  isApproved: boolean;
}

export function StructuredOutput({
  output,
  stage,
  onSubmit,
  isApproved,
}: StructuredOutputProps) {
  let initialFields: Record<string, string> = {};
  try {
    const parsed = JSON.parse(output);
    initialFields = parsed.fields ?? parsed;
  } catch {
    return (
      <div className="text-sm text-muted-foreground">
        <p className="text-amber-600 mb-2">
          Could not parse structured output.
        </p>
        <pre className="bg-zinc-50 border border-border p-3 rounded text-xs whitespace-pre-wrap">
          {output}
        </pre>
      </div>
    );
  }

  const [fields, setFields] = useState<Record<string, string>>(initialFields);

  let requiredFields: string[] = [];
  try {
    const gate: GateRule = JSON.parse(stage.gate_rules);
    if (gate.type === "require_fields") {
      requiredFields = gate.fields;
    }
  } catch {
    // ignore
  }

  const allFieldsFilled = requiredFields.every(
    (f) => fields[f] && fields[f].trim().length > 0,
  );

  const updateField = (key: string, value: string) => {
    if (isApproved) return;
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <div className="space-y-4">
        {Object.entries(fields).map(([key, value]) => {
          const isRequired = requiredFields.includes(key);
          const isLong = value.length > 100;
          const label = key
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

          return (
            <div key={key}>
              <Label>
                {label}
                {isRequired && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </Label>
              {isLong ? (
                <MarkdownTextarea
                  value={value}
                  onChange={(v) => updateField(key, v)}
                  readOnly={isApproved}
                  rows={6}
                  className="mt-2"
                />
              ) : (
                <Input
                  type="text"
                  value={value}
                  onChange={(e) => updateField(key, e.target.value)}
                  readOnly={isApproved}
                  className="mt-2"
                />
              )}
            </div>
          );
        })}
      </div>

      {!isApproved && (
        <Button
          variant="success"
          onClick={() => onSubmit(fields)}
          disabled={!allFieldsFilled}
          className="mt-4"
        >
          Approve & Continue
        </Button>
      )}
    </div>
  );
}
