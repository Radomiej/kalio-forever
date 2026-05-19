// eslint-disable-next-line no-control-regex
const OSC_PATTERN = new RegExp('\\u001B\\][^\\u0007]*(?:\\u0007|\\u001B\\\\)', 'g');
// eslint-disable-next-line no-control-regex
const DCS_PATTERN = new RegExp('\\u001B[PX^_][\\s\\S]*?\\u001B\\\\', 'g');
// eslint-disable-next-line no-control-regex
const CSI_PATTERN = new RegExp('\\u001B\\[[0-?]*[ -/]*[@-~]', 'g');
// eslint-disable-next-line no-control-regex
const ESC_PATTERN = new RegExp('\\u001B[@-Z\\\\-_]', 'g');

export function stripTerminalControlCodes(input: string): string {
  return input
    .replace(OSC_PATTERN, '')
    .replace(DCS_PATTERN, '')
    .replace(CSI_PATTERN, '')
    .replace(ESC_PATTERN, '')
    .replace(/\r/g, '');
}
