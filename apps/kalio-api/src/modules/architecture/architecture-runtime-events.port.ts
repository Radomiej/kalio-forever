import type { SocketEvents } from '@kalio/types';

export const ARCHITECTURE_RUNTIME_EVENTS = Symbol('ARCHITECTURE_RUNTIME_EVENTS');
export type ArchitectureRuntimeEmit = <K extends keyof SocketEvents>(event: K, data: SocketEvents[K]) => void;
