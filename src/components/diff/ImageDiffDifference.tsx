import { useRef, useEffect, useCallback, useState } from "react";

interface ImageDiffDifferenceProps {
  oldSrc: string;
  newSrc: string;
}

export function ImageDiffDifference({ oldSrc, newSrc }: ImageDiffDifferenceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const computeDiff = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const oldImg = new Image();
    const newImg = new Image();
    let loadCount = 0;

    const onBothLoaded = () => {
      loadCount++;
      if (loadCount < 2) return;

      const width = Math.max(oldImg.naturalWidth, newImg.naturalWidth);
      const height = Math.max(oldImg.naturalHeight, newImg.naturalHeight);

      setDimensions({ width: Math.min(width, 800), height: Math.min(height, 500) });

      canvas.width = width;
      canvas.height = height;

      // Draw old image to offscreen canvas
      const offOld = new OffscreenCanvas(width, height);
      const ctxOld = offOld.getContext("2d")!;
      ctxOld.drawImage(oldImg, 0, 0);
      const oldData = ctxOld.getImageData(0, 0, width, height);

      // Draw new image to offscreen canvas
      const offNew = new OffscreenCanvas(width, height);
      const ctxNew = offNew.getContext("2d")!;
      ctxNew.drawImage(newImg, 0, 0);
      const newData = ctxNew.getImageData(0, 0, width, height);

      // Compute pixel difference
      const ctx = canvas.getContext("2d")!;
      const result = ctx.createImageData(width, height);
      const rd = result.data;
      const od = oldData.data;
      const nd = newData.data;

      for (let i = 0; i < rd.length; i += 4) {
        rd[i] = Math.abs(od[i] - nd[i]);
        rd[i + 1] = Math.abs(od[i + 1] - nd[i + 1]);
        rd[i + 2] = Math.abs(od[i + 2] - nd[i + 2]);
        rd[i + 3] = 255;
      }

      ctx.putImageData(result, 0, 0);
    };

    oldImg.onload = onBothLoaded;
    newImg.onload = onBothLoaded;
    oldImg.src = oldSrc;
    newImg.src = newSrc;
  }, [oldSrc, newSrc]);

  useEffect(() => {
    computeDiff();
  }, [computeDiff]);

  return (
    <div className="flex justify-center">
      <div
        className="rounded-md overflow-hidden bg-black"
        style={{
          width: dimensions.width > 0 ? dimensions.width : "100%",
          height: dimensions.height > 0 ? dimensions.height : 400,
        }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain"
        />
      </div>
    </div>
  );
}
