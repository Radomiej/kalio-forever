import type { ArchitectNode } from './architect.types';

export const NODE_WIDTH = 176;
export const PIN_HITBOX_BASE = 56;
export const PIN_HITBOX_MIN = 48;
export const PIN_OUTWARD_CENTER_RATIO = 0.2;
export const PIN_ANCHOR_DEFAULT_ZOOM = 0.82;

const NODE_HEADER_HEIGHT = 56;
const NODE_BEHAVIOR_BADGE_HEIGHT = 18;
const NODE_ROLE_ROW_HEIGHT = 14;
const NODE_SLOT_ROW_HEIGHT = 42;
const NODE_SLOT_COLUMNS = 2;
const NODE_VERTICAL_PADDING = 18;
const NODE_MIN_HEIGHT = 104;

export interface NodeDimensions {
  width: number;
  height: number;
  pinY: number;
}

function hasBehaviorBadge(node: ArchitectNode): boolean {
  return Boolean(node.behavior && (node.kind === 'parallel' || node.kind === 'router'));
}

export function pinHitboxSize(zoom: number): number {
  return Math.max(PIN_HITBOX_MIN, Math.round(PIN_HITBOX_BASE / Math.max(zoom, 0.2)));
}

export function pinOutwardOffset(hitboxSize: number): number {
  return hitboxSize * PIN_OUTWARD_CENTER_RATIO;
}

export function getNodeDimensions(node: ArchitectNode): NodeDimensions {
  const slotRows = Math.ceil(node.slots.length / NODE_SLOT_COLUMNS);
  const behaviorHeight = hasBehaviorBadge(node) ? NODE_BEHAVIOR_BADGE_HEIGHT : 0;
  const roleHeight = node.role ? NODE_ROLE_ROW_HEIGHT : 0;
  const coreHeight = Math.max(
    NODE_MIN_HEIGHT,
    NODE_HEADER_HEIGHT + slotRows * NODE_SLOT_ROW_HEIGHT + NODE_VERTICAL_PADDING,
  );
  const height = coreHeight + behaviorHeight + roleHeight;
  return {
    width: NODE_WIDTH,
    height,
    pinY: height / 2,
  };
}

export function outputPin(node: ArchitectNode, zoom = PIN_ANCHOR_DEFAULT_ZOOM): { x: number; y: number } {
  const dimensions = getNodeDimensions(node);
  const outward = pinOutwardOffset(pinHitboxSize(zoom));
  return { x: node.x + dimensions.width + outward, y: node.y + dimensions.pinY };
}

export function inputPin(node: ArchitectNode, zoom = PIN_ANCHOR_DEFAULT_ZOOM): { x: number; y: number } {
  const dimensions = getNodeDimensions(node);
  const outward = pinOutwardOffset(pinHitboxSize(zoom));
  return { x: node.x - outward, y: node.y + dimensions.pinY };
}
