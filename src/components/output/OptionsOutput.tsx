import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { OptionItem } from "../../lib/types";

interface OptionsOutputProps {
  output: string;
  onSelect: (selected: OptionItem[]) => void;
  isApproved: boolean;
}

export function OptionsOutput({
  output,
  onSelect,
  isApproved,
}: OptionsOutputProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  let options: OptionItem[] = [];
  try {
    const parsed = JSON.parse(output);
    options = parsed.options ?? [];
  } catch {
    return (
      <div className="text-sm text-muted-foreground">
        <p className="text-amber-600 mb-2">
          Could not parse options output. Raw output:
        </p>
        <pre className="bg-zinc-50 border border-border p-3 rounded text-xs whitespace-pre-wrap">
          {output}
        </pre>
      </div>
    );
  }

  const handleSelect = () => {
    const selected = options.find((o) => o.id === selectedId);
    if (selected) {
      onSelect([selected]);
    }
  };

  return (
    <div>
      <div className="grid gap-4">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => !isApproved && setSelectedId(option.id)}
            disabled={isApproved}
            className={`text-left p-5 rounded-lg border transition-all ${
              selectedId === option.id
                ? "border-blue-500 bg-blue-50"
                : isApproved
                  ? "border-border bg-zinc-50"
                  : "border-border bg-white hover:border-zinc-400"
            }`}
          >
            <h4 className="text-base font-medium text-foreground mb-2">
              {option.title}
            </h4>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{option.description}</p>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-emerald-600 font-medium mb-2">
                  Pros
                </p>
                <ul className="text-sm text-muted-foreground space-y-1.5">
                  {option.pros.map((pro, i) => (
                    <li key={i}>+ {pro}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm text-red-600 font-medium mb-2">Cons</p>
                <ul className="text-sm text-muted-foreground space-y-1.5">
                  {option.cons.map((con, i) => (
                    <li key={i}>- {con}</li>
                  ))}
                </ul>
              </div>
            </div>
          </button>
        ))}
      </div>

      {!isApproved && (
        <Button
          variant="success"
          onClick={handleSelect}
          disabled={!selectedId}
          className="mt-4"
        >
          Select Approach
        </Button>
      )}
    </div>
  );
}
