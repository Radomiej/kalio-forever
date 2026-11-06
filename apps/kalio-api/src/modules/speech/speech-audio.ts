import { BadRequestException } from '@nestjs/common';

export const SPEECH_MAX_SECONDS = 60;
export const SPEECH_MAX_BYTES = 44 + SPEECH_MAX_SECONDS * 16000 * 2;

/** Deliberately accepts the composer's canonical PCM WAV, not arbitrary codecs. */
export function parseSpeechAudio(wav: Buffer): { pcm: Buffer; durationMs: number } {
  const invalid = () => new BadRequestException({ code: 'SPEECH_AUDIO_INVALID' });
  if (wav.length < 46 || wav.length > SPEECH_MAX_BYTES) throw invalid();
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE'
    || wav.readUInt32LE(4) !== wav.length - 8
    || wav.toString('ascii', 12, 16) !== 'fmt ' || wav.readUInt32LE(16) !== 16
    || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1
    || wav.readUInt32LE(24) !== 16000 || wav.readUInt32LE(28) !== 32000
    || wav.readUInt16LE(32) !== 2 || wav.readUInt16LE(34) !== 16
    || wav.toString('ascii', 36, 40) !== 'data'
    || wav.readUInt32LE(40) !== wav.length - 44 || (wav.length - 44) % 2) throw invalid();
  return { pcm: wav.subarray(44), durationMs: (wav.length - 44) / 32 };
}
