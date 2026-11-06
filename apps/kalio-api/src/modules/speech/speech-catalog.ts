const modelBase = 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78';

export const SPEECH_MODEL = 'parakeet-tdt-v3-int8';
export const SPEECH_RUNTIME_VERSION = '1.13.8';
export const SPEECH_MODEL_FILES = [
  { name: 'encoder.int8.onnx', bytes: 652184281, sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247' },
  { name: 'decoder.int8.onnx', bytes: 11845275, sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e' },
  { name: 'joiner.int8.onnx', bytes: 6355277, sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3' },
  { name: 'tokens.txt', bytes: 93939, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d' },
].map((file) => ({ ...file, url: `${modelBase}/${file.name}` }));

// Official npm registry integrity, queried 2026-11-02. Never resolve latest/ranges.
export const SPEECH_RUNTIME_PACKAGES = [
  { name: 'sherpa-onnx-node', bytes: 11954, integrity: 'MsDMBdhLFTZ1GwvcGSSQhnS7g/EA8OMH6IYysCVUOM7j8Icty9KRc0E6YT1A5fWBsZwRfKOeh88QC95aRvS8ag==' },
  { name: 'sherpa-onnx-win-x64', bytes: 8894875, integrity: 'oZF1c9VPOKtMwn83Bboc5XSWL+76BRoyB3eUuVnCknBKxwSULZU2Foia9VHWzU+n4I12rPsP6z6H9Rp1hD9o8g==' },
].map((pkg) => ({ ...pkg, url: `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${SPEECH_RUNTIME_VERSION}.tgz` }));

export interface SpeechAvailability {
  status: 'missing' | 'installing' | 'verifying' | 'ready' | 'error';
  installed: boolean;
  model: typeof SPEECH_MODEL;
  backend: 'sherpa-onnx-cpu';
  downloadedBytes: number;
  totalBytes: number;
  phase: 'runtime' | 'model' | null;
  errorCode: string | null;
  maxDurationSeconds: 60;
}
