import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useSettingsStore } from "@/stores/settingsStore";

const DARK_THEME: ITheme = {
  background: "#09090b",
  foreground: "#fafafa",
  cursor: "#fafafa",
  selectionBackground: "#3f3f46",
};

const LIGHT_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#09090b",
  cursor: "#09090b",
  selectionBackground: "#d4d4d8",
};

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function getTheme(): ITheme {
  return isDarkMode() ? DARK_THEME : LIGHT_THEME;
}

export interface XTerminalHandle {
  write: (data: string) => void;
  clear: () => void;
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
    const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);

    const syncTheme = useCallback(() => {
      if (termRef.current) {
        const theme = getTheme();
        termRef.current.options.theme = theme;
        if (containerRef.current) {
          containerRef.current.style.backgroundColor = theme.background!;
        }
      }
    }, []);

    useImperativeHandle(ref, () => ({
      write(data: string) {
        termRef.current?.write(data);
      },
      clear() {
        termRef.current?.clear();
      },
      focus() {
        termRef.current?.focus();
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const theme = getTheme();

      const term = new Terminal({
        cursorBlink: true,
        fontSize: useSettingsStore.getState().terminalFontSize,
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
        theme,
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

      // Watch for dark/light class changes on <html>
      const classObserver = new MutationObserver(() => syncTheme());
      classObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

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
        classObserver.disconnect();
        document.removeEventListener("visibilitychange", onVisibilityChange);
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
    }, []);

    // Update font size when setting changes
    useEffect(() => {
      if (termRef.current) {
        termRef.current.options.fontSize = terminalFontSize;
        try {
          fitRef.current?.fit();
        } catch {
          // ignore if disposed
        }
      }
    }, [terminalFontSize]);

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
        className="w-full h-full min-h-[300px] overflow-hidden px-3 py-2"
        style={{ backgroundColor: getTheme().background }}
      />
    );
  },
);
