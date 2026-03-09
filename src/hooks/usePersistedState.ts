import { useState, useCallback, useEffect, useRef } from "react";

const PREFIX = "stagehand_draft:";

/**
 * Like useState, but persists the value to localStorage on every change.
 * Restores the saved value on mount; falls back to `initialValue`.
 *
 * @param key   A unique key (will be prefixed automatically).
 * @param initialValue  Default when nothing is stored.
 * @returns [value, setValue, clearValue]
 */
export function usePersistedState(
  key: string,
  initialValue: string = "",
): [string, (v: string) => void, () => void] {
  const storageKey = PREFIX + key;
  const prevKeyRef = useRef(storageKey);

  const [value, setValueRaw] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored : initialValue;
    } catch {
      return initialValue;
    }
  });

  // If the key changes (e.g. user switches task), re-read from storage
  useEffect(() => {
    if (prevKeyRef.current !== storageKey) {
      prevKeyRef.current = storageKey;
      try {
        const stored = localStorage.getItem(storageKey);
        setValueRaw(stored !== null ? stored : initialValue);
      } catch {
        setValueRaw(initialValue);
      }
    }
  }, [storageKey, initialValue]);

  const setValue = useCallback(
    (v: string) => {
      setValueRaw(v);
      try {
        if (v === "" || v === initialValue) {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, v);
        }
      } catch {
        // storage full or unavailable – silent
      }
    },
    [storageKey, initialValue],
  );

  const clearValue = useCallback(() => {
    setValueRaw(initialValue);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // silent
    }
  }, [storageKey, initialValue]);

  return [value, setValue, clearValue];
}
