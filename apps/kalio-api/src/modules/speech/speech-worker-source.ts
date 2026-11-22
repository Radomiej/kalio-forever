/** Fixed program, never interpolated input. Paths and PCM travel only over IPC. */
export const SPEECH_WORKER_SOURCE = String.raw`
'use strict';
// Disable JavaScript networking before loading the optional local addon.
const deny = () => { throw new Error('SPEECH_OFFLINE_ONLY'); };
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https', 'node:net', 'node:tls', 'node:dgram']) {
  const mod = require(name);
  for (const key of ['request', 'get', 'connect', 'createConnection', 'createSocket']) {
    if (key in mod) mod[key] = deny;
  }
}
process.once('message', (message) => {
  let pcm;
  let samples;
  try {
    const { join } = require('node:path');
    const sherpa = require(join(message.root, 'node_modules', 'sherpa-onnx-node'));
    const model = (name) => join(message.root, 'model', name);
    const recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: model('encoder.int8.onnx'), decoder: model('decoder.int8.onnx'), joiner: model('joiner.int8.onnx') },
        tokens: model('tokens.txt'), numThreads: 4, provider: 'cpu', debug: 0, modelType: 'nemo_transducer',
      },
      decodingMethod: 'greedy_search',
    });
    pcm = message.pcm;
    samples = new Float32Array(pcm.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
    const stream = recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: 16000 });
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);
    if (typeof result.text !== 'string' || Buffer.byteLength(result.text, 'utf8') > 32000) throw new Error('INVALID_RESULT');
    process.send({ text: result.text }, () => process.exit(0));
  } catch {
    process.send({ errorCode: 'SPEECH_INFERENCE_FAILED' }, () => process.exit(1));
  } finally {
    if (pcm) pcm.fill(0);
    if (samples) samples.fill(0);
  }
});
`;
