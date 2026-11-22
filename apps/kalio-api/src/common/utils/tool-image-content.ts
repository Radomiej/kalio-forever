const MAX_DATA_URL_LENGTH = 7 * 1024 * 1024;

export function readImageDataUrl(url: string): { mimeType: string; data: string } | undefined {
  if (url.length > MAX_DATA_URL_LENGTH) return;
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (match) return { mimeType: match[1]!, data: match[2]! };
}

export function readToolImage(toolName: string, value: unknown) {
  if (!['image_view', 'image_generate', 'image_edit'].includes(toolName)) return;
  if (!value || typeof value !== 'object' || !('output_type' in value) || value.output_type !== 'image') return;
  const { image_url: imageUrl, ...metadata } = value as Record<string, unknown>;
  if (typeof imageUrl !== 'string') return;
  const image = readImageDataUrl(imageUrl);
  return { image, imageUrl, text: JSON.stringify({ ...metadata, ...(!image && {
    image_status: 'Image bytes are unavailable to the model. Use the saved file reference.',
  }) }) };
}
