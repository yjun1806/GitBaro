import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

interface ImageDiffSwipeProps {
  oldSrc: string;
  newSrc: string;
}

export function ImageDiffSwipe({ oldSrc, newSrc }: ImageDiffSwipeProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50); // percentage
  const [dragging, setDragging] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setDimensions((prev) => ({
        width: Math.max(prev.width, img.naturalWidth),
        height: Math.max(prev.height, img.naturalHeight),
      }));
    },
    [],
  );

  const updatePosition = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setPosition(pct);
    },
    [],
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      updatePosition(e.clientX);
    };
    const handleMouseUp = () => setDragging(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, updatePosition]);

  const containerStyle = {
    width: dimensions.width > 0 ? Math.min(dimensions.width, 800) : "100%",
    height: dimensions.height > 0 ? Math.min(dimensions.height, 500) : 400,
  };

  return (
    <div className="flex justify-center">
      <div
        ref={containerRef}
        className="relative checkerboard-bg rounded-md overflow-hidden cursor-ew-resize select-none"
        style={containerStyle as React.CSSProperties}
        onMouseDown={(e) => {
          setDragging(true);
          updatePosition(e.clientX);
        }}
      >
        {/* New image (full) */}
        <img
          src={newSrc}
          alt={t("diff.imageDiff.newImage")}
          className="absolute inset-0 w-full h-full object-contain"
          onLoad={handleImageLoad}
        />

        {/* Old image (clipped from left). clip-path keeps it at the container's full
            size, so it lines up with the new image even after the container resizes. */}
        <img
          src={oldSrc}
          alt={t("diff.imageDiff.oldImage")}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          onLoad={handleImageLoad}
        />

        {/* Drag handle */}
        <div className="swipe-handle" style={{ left: `${position}%` }} />
      </div>
    </div>
  );
}
