import { useEffect, useState } from "react";
import { useUIStore } from "@/stores/ui";
import { clampSidebarWidth } from "@/lib/sidebar-width";

/**
 * The sidebar width as drawn: the stored width fitted to the current window.
 * The stored width may come from a wider screen, so anything positioned next
 * to the sidebar (the layout itself, toolbar drop-down panels) must use this
 * value, not the raw one from the store. The stored value is left alone, so
 * the wider layout comes back when the window grows again.
 */
export function useSidebarWidth(): number {
  const storedSidebarWidth = useUIStore((s) => s.sidebarWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return clampSidebarWidth(storedSidebarWidth, viewportWidth);
}
