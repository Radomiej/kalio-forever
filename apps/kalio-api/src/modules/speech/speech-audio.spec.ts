import { describe, expect, it } from 'vitest';
import { parseSpeechAudio, SPEECH_MAX_BYTES } from './speech-audio';

export function speechWav(samples = 16000): Buffer {
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

describe('speech PCM WAV boundary (synthetic fixtures, no speech recognition)', () => {
  it('accepts mono PCM16 at 16kHz and the exact 60-second limit', () => {
    expect(parseSpeechAudio(speechWav()).durationMs).toBe(1000);
    expect(parseSpeechAudio(speechWav(960000)).durationMs).toBe(60000);
  });
  it.each([0, 20, 22, 24, 28, 32, 34, 36, 40])('rejects malformed field at %i', (offset) => {
    const wav = speechWav(); wav[offset] ^= 0xff;
    expect(() => parseSpeechAudio(wav)).toThrow();
  });
  it('rejects empty, oversized, odd, truncated and renamed WebM input', () => {
    for (const wav of [speechWav(0), Buffer.alloc(SPEECH_MAX_BYTES + 2), speechWav().subarray(0, 100), Buffer.from('webm')]) {
      expect(() => parseSpeechAudio(wav)).toThrow();
    }
  });
});
