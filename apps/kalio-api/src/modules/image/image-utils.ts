/**
 * Image utility helpers — buffer / base64 / data-URL conversions.
 * Ported from ra-kingdom-stack imageUtils.ts.
 */

export interface FetchedImage {
  buffer: Buffer;
  mimeType: string;
  dataUrl: string;
}

export async function fetchAndConvertImage(
  imageUrl: string,
  headers?: Record<string, string>,
): Promise<FetchedImage> {
  if (imageUrl.startsWith('data:')) {
    const commaIdx = imageUrl.indexOf(',');
    if (commaIdx === -1) throw new Error('Malformed data URL: missing comma separator');
    const header = imageUrl.slice(5, commaIdx);
    const mimeType = header.split(';')[0] ?? 'image/png';
    const buffer = Buffer.from(imageUrl.slice(commaIdx + 1), 'base64');
    return { buffer, mimeType, dataUrl: imageUrl };
  }

  let response = await fetch(imageUrl, headers ? { headers } : undefined);
  const bearerToken =
    headers?.['Authorization']?.startsWith('Bearer ')
      ? headers['Authorization'].slice('Bearer '.length)
      : undefined;

  if (!response.ok && bearerToken) {
    response = await fetch(imageUrl, { headers: { 'x-api-key': bearerToken } });
  }

  if (!response.ok && headers) {
    response = await fetch(imageUrl);
  }

  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get('content-type') ?? 'image/png';
  return {
    buffer,
    mimeType,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
  };
}
