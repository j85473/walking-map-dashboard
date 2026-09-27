import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Walk, ColorOpacities } from "@/lib/walkTypes";
import type { StreetHeatmap, StreetHeatSegment } from "@/lib/streetHeatmap";

const colors = [
  [77, 159, 255],  // blue
  [105, 217, 255], // cyan
  [245, 166, 35],  // amber
  [240, 91, 91],   // red
  [190, 133, 255], // purple
] as const;
const colorKeys = ["blue", "cyan", "amber", "red", "purple"] as const;

function colorBand(visits: number) {
  if (visits <= 2) return 0;
  if (visits <= 4) return 1;
  if (visits <= 7) return 2;
  if (visits <= 11) return 3;
  return 4;
}

function opacity(intensity: number, density = 0) {
  return Math.min(1, 0.2 + 0.075 * intensity + 0.18 * density);
}

export default function LineHeatmapLayer({ walks, heatmap, opacities }: {
  walks: Walk[];
  heatmap: StreetHeatmap | null;
  opacities: ColorOpacities;
}) {
  const map = useMap();

  useEffect(() => {
    const canvas = L.DomUtil.create("canvas", "leaflet-zoom-hide") as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    map.getPanes().overlayPane.appendChild(canvas);

    let timeoutId: ReturnType<typeof setTimeout>;
    let frameId = 0;
    const fallbackRoutes = heatmap?.unmatchedRoutes ?? walks.map(walk => walk.points);
    const streetSegments = heatmap?.segments ?? [];

    const drawStreetSegments = (segments: StreetHeatSegment[], lineWidth: number) => {
      if (!segments.length) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (const segment of segments) {
        const start = map.latLngToContainerPoint(segment.start);
        const end = map.latLngToContainerPoint(segment.end);
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }
      ctx.globalAlpha = 0.76;
      ctx.lineWidth = lineWidth + 2.4;
      ctx.strokeStyle = "#040b1d";
      ctx.stroke();

      for (let band = 0; band < colors.length; band++) {
        ctx.beginPath();
        for (const segment of segments) {
          if (colorBand(segment.visits) !== band) continue;
          const start = map.latLngToContainerPoint(segment.start);
          const end = map.latLngToContainerPoint(segment.end);
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
        }
        const [red, green, blue] = colors[band];
        ctx.globalAlpha = opacity(opacities[colorKeys[band]]);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = `rgb(${red}, ${green}, ${blue})`;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const redraw = () => {
      const size = map.getSize();
      if (!size.x || !size.y) {
        timeoutId = setTimeout(redraw, 50);
        return;
      }
      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const lineWidth = Math.min(7, Math.max(4.2, 4.2 + (map.getZoom() - 14) * 0.55));
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.11)";

      for (const points of fallbackRoutes) {
        if (points.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const pixel = map.latLngToContainerPoint(points[i]);
          if (i === 0) ctx.moveTo(pixel.x, pixel.y);
          else ctx.lineTo(pixel.x, pixel.y);
        }
        ctx.stroke();
      }

      if (fallbackRoutes.length) {
        const image = ctx.getImageData(0, 0, size.x, size.y);
        const data = image.data;
        for (let i = 3; i < data.length; i += 4) {
          const alpha = data[i];
          if (!alpha) continue;
          const band = alpha < 55 ? 0 : alpha < 103 ? 1 : alpha < 151 ? 2 : alpha < 204 ? 3 : 4;
          const [red, green, blue] = colors[band];
          data[i - 3] = red;
          data[i - 2] = green;
          data[i - 1] = blue;
          data[i] = Math.round(255 * opacity(opacities[colorKeys[band]], alpha / 255));
        }
        ctx.putImageData(image, 0, 0);
      }
      drawStreetSegments(streetSegments, lineWidth);
    };

    const scheduleRedraw = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(redraw);
    };
    map.on("moveend", scheduleRedraw);
    map.on("resize", scheduleRedraw);
    map.on("zoomend", scheduleRedraw);
    scheduleRedraw();
    return () => {
      clearTimeout(timeoutId);
      cancelAnimationFrame(frameId);
      map.off("moveend", scheduleRedraw);
      map.off("resize", scheduleRedraw);
      map.off("zoomend", scheduleRedraw);
      canvas.remove();
    };
  }, [map, walks, heatmap, opacities]);

  return null;
}
