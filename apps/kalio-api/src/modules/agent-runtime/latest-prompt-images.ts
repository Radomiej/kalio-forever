import type { LLMImagePart, LLMMessage } from '@kalio/types';
import { readImageDataUrl } from '../../common/utils/tool-image-content';

export function latestPromptImages(messages: readonly LLMMessage[]): LLMImagePart[] {
  const content = [...messages].reverse().find((message) => message.role === 'user')?.content;
  return Array.isArray(content) ? content.filter((part) => part.type === 'image_url') : [];
}

export function toAcpPromptImages(images: LLMImagePart[]) {
  return images.map(({ image_url: { url } }) => {
    const image = readImageDataUrl(url);
    if (!image) throw new Error('Attach a supported image file before sending it to Devin.');
    return { type: 'image' as const, ...image };
  });
}
