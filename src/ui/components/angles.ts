// CSS rotation (degrees) for the small `↓` arrow that visualises a
// slot's angle in the custom-wave grid. ANGLE_TABLE tilts are radians;
// CSS rotate is clockwise, so for `↓` (head pointing down) a positive
// rotation pushes the head left. Right-motion (positive tilt) needs a
// negative CSS rotation; left-motion needs positive. Negate to map.

export function angleToCssRotation(angleIdx: number): number {
  const tilts = [0, -0.15, 0.15, -0.35, 0.35, -0.6, 0.6, -0.4, 0.4, 0];
  const tilt = tilts[Math.max(0, Math.min(9, angleIdx))] ?? 0;
  return -tilt * (180 / Math.PI);
}
