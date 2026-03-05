import { useRef, useCallback, useEffect } from "react";
import { useProcessStore } from "../../stores/processStore";
import { writeToPty, resizePty } from "../../lib/agent";
import { registerPtyWriter, unregisterPtyWriter } from "../../lib/ptyRouter";
import { XTerminal, type XTerminalHandle } from "./XTerminal";

interface Props {
  tabId: string;
  isVisible: boolean;
}

export function TerminalTabPanel({ tabId, isVisible }: Props) {
  const xtermRef = useRef<XTerminalHandle | null>(null);
  const tab = useProcessStore((s) => s.terminalTabs[tabId]);

  // Register pty writer keyed by tabId
  useEffect(() => {
    registerPtyWriter(tabId, (data) => xtermRef.current?.write(data));
    return () => { unregisterPtyWriter(tabId); };
  }, [tabId]);

  // Focus when becoming visible
  useEffect(() => {
    if (isVisible) {
      xtermRef.current?.focus();
    }
  }, [isVisible]);

  const handleData = useCallback((data: string) => {
    const ptyId = useProcessStore.getState().terminalTabs[tabId]?.ptyId;
    if (ptyId) {
      writeToPty(ptyId, data).catch(() => {});
    }
  }, [tabId]);

  const handleResize = useCallback((cols: number, rows: number) => {
    const ptyId = useProcessStore.getState().terminalTabs[tabId]?.ptyId;
    if (ptyId) {
      resizePty(ptyId, cols, rows).catch(() => {});
    }
  }, [tabId]);

  if (!tab) return null;

  return (
    <div className="absolute inset-0 p-2" style={{ display: "flex", flexDirection: "column" }}>
      <XTerminal
        ref={xtermRef}
        onData={handleData}
        onResize={handleResize}
        isVisible={isVisible}
      />
    </div>
  );
}
