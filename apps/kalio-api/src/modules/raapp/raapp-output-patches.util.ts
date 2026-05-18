export interface RaAppOutputPatch {
  outputPath: string;
  value: unknown;
}

export function applyRaAppOutputPatches(
  output: Record<string, unknown>,
  patches: RaAppOutputPatch[] | undefined,
): void {
  if (!patches || patches.length === 0) {
    return;
  }

  for (const patch of patches) {
    const normalizedPath = patch.outputPath.replace(/^output\./, '').trim();
    if (normalizedPath.length === 0) {
      continue;
    }

    const segments = normalizedPath.split('.');
    let current: Record<string, unknown> = output;

    for (const segment of segments.slice(0, -1)) {
      const next = current[segment];
      if (typeof next !== 'object' || next === null || Array.isArray(next)) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }

    current[segments.at(-1)!] = patch.value;
  }
}