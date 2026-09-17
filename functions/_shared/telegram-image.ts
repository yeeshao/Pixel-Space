export interface ImageInfo {
  mime: string;
  extension: string;
  width: number;
  height: number;
}

const u16 = (v: DataView, o: number, le = false) => v.getUint16(o, le);
const u32 = (v: DataView, o: number, le = false) => v.getUint32(o, le);

const detectMime = (b: Uint8Array): { mime: string; extension: string } | null => {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: 'image/png', extension: 'png' };
  if (b.length >= 6 && ((b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && b[4] === 0x37 && b[5] === 0x61) || (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && b[4] === 0x39 && b[5] === 0x61))) return { mime: 'image/gif', extension: 'gif' };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', extension: 'webp' };
  return null;
};

const jpegDimensions = (b: Uint8Array): [number, number] | null => {
  if (b.length < 4) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p += 1; continue; }
    const marker = b[p + 1];
    p += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (p + 2 > b.length) break;
    const len = u16(view, p);
    if (len < 2 || p + len > b.length) break;
    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (sof && len >= 7) return [u16(view, p + 3), u16(view, p + 5)];
    p += len;
  }
  return null;
};

const pngDimensions = (b: Uint8Array): [number, number] | null => {
  if (b.length < 24) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return [u32(view, 16), u32(view, 20)];
};

const gifDimensions = (b: Uint8Array): [number, number] | null => {
  if (b.length < 10) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return [u16(view, 6, true), u16(view, 8, true)];
};

const webpDimensions = (b: Uint8Array): [number, number] | null => {
  if (b.length < 30) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === 'VP8X') return [1 + b[24] + (b[25] << 8) + (b[26] << 16), 1 + b[27] + (b[28] << 8) + (b[29] << 16)];
  if (chunk === 'VP8 ' && b.length >= 30) {
    const start = 26;
    if (b[start] === 0x9d && b[start + 1] === 0x01 && b[start + 2] === 0x2a) return [u16(view, start + 3, true) & 0x3fff, u16(view, start + 5, true) & 0x3fff];
  }
  if (chunk === 'VP8L' && b.length >= 26 && b[21] === 0x2f) {
    const w = 1 + b[22] + ((b[23] & 0x3f) << 8);
    const h = 1 + ((b[23] >> 6) | (b[24] << 2) | ((b[25] & 0x03) << 10));
    return [w, h];
  }
  return null;
};

export const inspectImage = (bytes: ArrayBuffer): ImageInfo => {
  const b = new Uint8Array(bytes);
  const detected = detectMime(b);
  if (!detected) throw new Error('telegram_unsupported_image');
  const dimensions = detected.mime === 'image/jpeg'
    ? jpegDimensions(b)
    : detected.mime === 'image/png'
      ? pngDimensions(b)
      : detected.mime === 'image/gif'
        ? gifDimensions(b)
        : webpDimensions(b);
  if (!dimensions || dimensions[0] <= 0 || dimensions[1] <= 0) throw new Error('telegram_invalid_image_dimensions');
  return { ...detected, width: dimensions[0], height: dimensions[1] };
};

export const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
};

export const filenameForTelegram = (name: string | undefined, key: string, extension: string): string => {
  const cleaned = (name ?? '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180);
  return cleaned || `${key.replace(/^images\//, '')}.${extension}`;
};
