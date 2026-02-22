import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface XTerminalHandle {
  write: (data: string) => void;
  focus: () => void;
}

interface XTerminalProps {
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  isVisible?: boolean;
}

export const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(
  function XTerminal({ onData, onResize, isVisible }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useImperativeHandle(ref, () => ({
      write(data: string) {
        termRef.current?.write(data);
      },
      focus() {
        termRef.current?.focus();
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
          cursor: "#fafafa",
          selectionBackground: "#3f3f46",
        },
        convertEol: true,
        scrollback: 10000,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      termRef.current = term;
      fitRef.current = fit;

      term.onData(onData);
      term.onResize(({ cols, rows }) => onResize(cols, rows));

      const observer = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          // ignore if disposed
        }
      });
      observer.observe(containerRef.current);

      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          try {
            fit.fit();
            term.scrollToBottom();
          } catch {
            // ignore if disposed
          }
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);

      return () => {
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibilityChange);
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
    }, []);

    // Scroll to bottom when the terminal becomes visible (e.g. task switch)
    useEffect(() => {
      if (isVisible && termRef.current && fitRef.current) {
        try {
          fitRef.current.fit();
          termRef.current.scrollToBottom();
        } catch {
          // ignore if disposed
        }
      }
    }, [isVisible]);

    return (
      <div
        ref={containerRef}
        className="w-full h-full min-h-[300px] rounded-lg overflow-hidden border border-border px-3 py-2"
        style={{ backgroundColor: "#09090b" }}
      />
    );
  },
);
