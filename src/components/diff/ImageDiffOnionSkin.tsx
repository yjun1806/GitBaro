import { useState, useCallback } from "react";

interface ImageDiffOnionSkinProps {
  oldSrc: string;
  newSrc: string;
}

export function ImageDiffOnionSkin({ oldSrc, newSrc }: ImageDiffOnionSkinProps) {
  const [opacity, setOpacity] = useState(50);
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

  const containerStyle = {
    width: dimensions.width > 0 ? Math.min(dimensions.width, 800) : "100%",
    height: dimensions.height > 0 ? Math.min(dimensions.height, 500) : 400,
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative checkerboard-bg rounded-md overflow-hidden"
        style={containerStyle as React.CSSProperties}
      >
        {/* Old image (base layer) */}
        <img
          src={oldSrc}
          alt="old"
          className="absolute inset-0 w-full h-full object-contain"
          onLoad={handleImageLoad}
        />

        {/* New image (overlay with variable opacity) */}
        <img
          src={newSrc}
          alt="new"
          className="absolute inset-0 w-full h-full object-contain"
          style={{ opacity: opacity / 100 }}
          onLoad={handleImageLoad}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="image-meta-label">0%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="onion-skin-slider"
        />
        <span className="image-meta-label">100%</span>
        <span className="image-meta-label ml-2">{opacity}%</span>
      </div>
    </div>
  );
}
