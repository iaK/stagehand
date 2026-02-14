import { useState } from "react";
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
      <div className="text-sm text-zinc-400">
        <p className="text-amber-400 mb-2">
          Could not parse structured output.
        </p>
        <pre className="bg-zinc-900 p-3 rounded text-xs whitespace-pre-wrap">
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
              <label className="block text-sm text-zinc-400 mb-1">
                {label}
                {isRequired && (
                  <span className="text-red-400 ml-1">*</span>
                )}
              </label>
              {isLong ? (
                <textarea
                  value={value}
                  onChange={(e) => updateField(key, e.target.value)}
                  readOnly={isApproved}
                  rows={6}
                  className="w-full bg-zinc-900 text-zinc-100 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 resize-none"
                />
              ) : (
                <input
                  type="text"
                  value={value}
                  onChange={(e) => updateField(key, e.target.value)}
                  readOnly={isApproved}
                  className="w-full bg-zinc-900 text-zinc-100 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
                />
              )}
            </div>
          );
        })}
      </div>

      {!isApproved && (
        <button
          onClick={() => onSubmit(fields)}
          disabled={!allFieldsFilled}
          className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Approve & Continue
        </button>
      )}
    </div>
  );
}
