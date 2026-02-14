import { useState } from "react";
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
      <div className="text-sm text-zinc-400">
        <p className="text-amber-400 mb-2">
          Could not parse options output. Raw output:
        </p>
        <pre className="bg-zinc-900 p-3 rounded text-xs whitespace-pre-wrap">
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
      <div className="grid gap-3">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => !isApproved && setSelectedId(option.id)}
            disabled={isApproved}
            className={`text-left p-4 rounded-lg border transition-all ${
              selectedId === option.id
                ? "border-blue-500 bg-blue-950/30"
                : isApproved
                  ? "border-zinc-800 bg-zinc-900/50"
                  : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
            }`}
          >
            <h4 className="text-sm font-medium text-zinc-200 mb-1">
              {option.title}
            </h4>
            <p className="text-xs text-zinc-400 mb-3">{option.description}</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-emerald-500 font-medium mb-1">
                  Pros
                </p>
                <ul className="text-xs text-zinc-400 space-y-0.5">
                  {option.pros.map((pro, i) => (
                    <li key={i}>+ {pro}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs text-red-400 font-medium mb-1">Cons</p>
                <ul className="text-xs text-zinc-400 space-y-0.5">
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
        <button
          onClick={handleSelect}
          disabled={!selectedId}
          className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Select Approach
        </button>
      )}
    </div>
  );
}
