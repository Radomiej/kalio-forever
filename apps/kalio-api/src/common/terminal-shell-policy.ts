/** Only Windows batch files and legacy bare package shims need an outer shell. */
export function terminalUsesShell(command: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  if (/\.(cmd|bat)$/i.test(command)) return true;
  // TODO: legacy fallback — preserve bare package-manager shim compatibility without filesystem lookup.
  return /^(npm|pnpm|yarn|npx|corepack)$/i.test(command);
}
