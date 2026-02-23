import { useEffect } from "react";

interface KeyboardShortcutHandlers {
  onCommit?: () => void;
  onPush?: () => void;
  onSwitchToChanges?: () => void;
  onSwitchToHistory?: () => void;
  onCommandPalette?: () => void;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey;

      if (meta && e.key === "Enter") {
        e.preventDefault();
        handlers.onCommit?.();
        return;
      }

      if (meta && e.shiftKey && e.key === "P") {
        e.preventDefault();
        handlers.onPush?.();
        return;
      }

      if (meta && e.key === "1") {
        e.preventDefault();
        handlers.onSwitchToChanges?.();
        return;
      }

      if (meta && e.key === "2") {
        e.preventDefault();
        handlers.onSwitchToHistory?.();
        return;
      }

      if (meta && e.key === "k") {
        e.preventDefault();
        handlers.onCommandPalette?.();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
