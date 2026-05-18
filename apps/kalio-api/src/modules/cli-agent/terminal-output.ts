export function stripTerminalControlCodes(input: string): string {
  return input
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[PX^_][\s\S]*?\x1B\\/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[@-Z\\-_]/g, '')
    .replace(/\r/g, '');
}
