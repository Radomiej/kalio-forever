import type { ReactNode } from 'react';
import type { GraphCamera } from './useGraphInteraction';

export function GraphWorldLayer({
  camera,
  children,
  className = '',
  minHeight,
  minWidth,
  scaleMode = 'combined',
  scaledHeight,
  scaledWidth,
  testId,
  worldHeight,
  worldTestId,
  worldWidth,
}: {
  camera: GraphCamera;
  children: ReactNode;
  className?: string;
  minHeight?: number;
  minWidth?: number;
  scaleMode?: 'combined' | 'nested';
  scaledHeight?: number;
  scaledWidth?: number;
  testId: string;
  worldHeight?: number;
  worldTestId?: string;
  worldWidth?: number;
}) {
  const worldStyle = scaleMode === 'nested'
    ? {
      height: worldHeight,
      minHeight,
      minWidth,
      transform: `scale(${camera.zoom})`,
      transformOrigin: '0 0',
      width: worldWidth,
    }
    : {
      height: worldHeight,
      minHeight,
      minWidth,
      transform: `translate(${camera.pan.x}px, ${camera.pan.y}px) scale(${camera.zoom})`,
      transformOrigin: '0 0',
      width: worldWidth,
    };

  const world = (
    <div
      className={`relative origin-top-left ${className}`}
      data-testid={testId}
      style={worldStyle}
    >
      {children}
    </div>
  );

  if (scaledHeight === undefined && scaledWidth === undefined) {
    return world;
  }

  return (
    <div
      className="relative min-h-full min-w-full origin-top-left will-change-transform"
      data-testid={worldTestId}
      style={{
        height: scaledHeight,
        transform: scaleMode === 'nested' ? `translate(${camera.pan.x}px, ${camera.pan.y}px)` : undefined,
        width: scaledWidth,
      }}
    >
      {world}
    </div>
  );
}
