import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { Walk, ColorOpacities } from '../page';

type LineHeatmapLayerProps = {
  walks: Walk[];
  opacities: ColorOpacities;
};

export default function LineHeatmapLayer({ walks, opacities }: LineHeatmapLayerProps) {
  const map = useMap();

  useEffect(() => {
    const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated') as HTMLCanvasElement;
    canvas.style.pointerEvents = 'none';
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    
    map.getPanes().overlayPane.appendChild(canvas);

    const gradientCanvas = document.createElement('canvas');
    gradientCanvas.width = 1;
    gradientCanvas.height = 256;
    const gCtx = gradientCanvas.getContext('2d')!;
    const gradient = gCtx.createLinearGradient(0, 0, 0, 256);
    
    gradient.addColorStop(0.0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.2, '#10b981'); // Emerald Green
    gradient.addColorStop(0.4, '#eab308'); // Yellow
    gradient.addColorStop(0.6, '#f97316'); // Orange
    gradient.addColorStop(0.8, '#ef4444'); // Red
    gradient.addColorStop(1.0, '#a855f7'); // Purple
    
    gCtx.fillStyle = gradient;
    gCtx.fillRect(0, 0, 1, 256);
    const palette = gCtx.getImageData(0, 0, 1, 256).data;

    // Precompute the multiplier map for fast opacity interpolation
    const multiplierMap = new Float32Array(256);
    for (let a = 0; a < 256; a++) {
      const ratio = a / 255;
      if (ratio <= 0.2) {
        multiplierMap[a] = opacities.green;
      } else if (ratio <= 0.4) {
        const t = (ratio - 0.2) / 0.2;
        multiplierMap[a] = opacities.green + t * (opacities.yellow - opacities.green);
      } else if (ratio <= 0.6) {
        const t = (ratio - 0.4) / 0.2;
        multiplierMap[a] = opacities.yellow + t * (opacities.orange - opacities.yellow);
      } else if (ratio <= 0.8) {
        const t = (ratio - 0.6) / 0.2;
        multiplierMap[a] = opacities.orange + t * (opacities.red - opacities.orange);
      } else {
        const t = (ratio - 0.8) / 0.2;
        multiplierMap[a] = opacities.red + t * (opacities.purple - opacities.red);
      }
    }

    let timeoutId: NodeJS.Timeout;
    let animFrameId: number;

    const redraw = () => {
      const size = map.getSize();
      if (size.x === 0 || size.y === 0) {
        timeoutId = setTimeout(redraw, 50);
        return;
      }

      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;

      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);

      ctx.clearRect(0, 0, size.x, size.y);

      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';

      for (const walk of walks) {
        if (!walk.points || walk.points.length === 0) continue;
        
        ctx.beginPath();
        const pts = walk.points;
        for (let i = 0; i < pts.length; i++) {
          const p = map.latLngToContainerPoint([pts[i][0], pts[i][1]]);
          if (i === 0) {
            ctx.moveTo(p.x, p.y);
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.stroke();
      }

      const imgData = ctx.getImageData(0, 0, size.x, size.y);
      const data = imgData.data;
      
      for (let i = 3, len = data.length; i < len; i += 4) {
        const alpha = data[i];
        if (alpha > 0) {
          const offset = alpha * 4;
          data[i - 3] = palette[offset];     // R
          data[i - 2] = palette[offset + 1]; // G
          data[i - 1] = palette[offset + 2]; // B
          data[i] = Math.min(255, alpha * multiplierMap[alpha]); 
        }
      }
      
      ctx.putImageData(imgData, 0, 0);
    };

    const scheduleRedraw = () => {
      cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(redraw);
    };

    map.on('moveend', scheduleRedraw);
    map.on('resize', scheduleRedraw);
    map.on('zoomend', scheduleRedraw);
    
    scheduleRedraw();

    return () => {
      clearTimeout(timeoutId);
      cancelAnimationFrame(animFrameId);
      map.off('moveend', scheduleRedraw);
      map.off('resize', scheduleRedraw);
      map.off('zoomend', scheduleRedraw);
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };
  }, [map, walks, opacities]);

  return null;
}
