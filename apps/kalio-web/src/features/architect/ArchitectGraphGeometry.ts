import type { ArchitectNode } from './architect.types';

export const NODE_WIDTH = 176;
const NODE_HEADER_HEIGHT = 56;
const NODE_SLOT_ROW_HEIGHT = 42;
const NODE_SLOT_COLUMNS = 2;
const NODE_VERTICAL_PADDING = 18;
const NODE_MIN_HEIGHT = 104;

export interface NodeDimensions {
  width: number;
  height: number;
  pinY: number;
}

export function getNodeDimensions(node: ArchitectNode): NodeDimensions {
  const slotRows = Math.ceil(node.slots.length / NODE_SLOT_COLUMNS);
  const height = Math.max(NODE_MIN_HEIGHT, NODE_HEADER_HEIGHT + slotRows * NODE_SLOT_ROW_HEIGHT + NODE_VERTICAL_PADDING);
  return {
    width: NODE_WIDTH,
    height,
    pinY: height / 2,
  };
}

export function outputPin(node: ArchitectNode): { x: number; y: number } {
  const dimensions = getNodeDimensions(node);
  return { x: node.x + dimensions.width, y: node.y + dimensions.pinY };
}

export function inputPin(node: ArchitectNode): { x: number; y: number } {
  const dimensions = getNodeDimensions(node);
  return { x: node.x, y: node.y + dimensions.pinY };
}
