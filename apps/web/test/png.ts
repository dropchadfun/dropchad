/**
 * A small PNG reader for tests: 8 bit RGB or RGBA, not interlaced, which is what Chrome and Pillow
 * write here. Node has no canvas, so the og image and the logo are read this way.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export function readPng(file: string) {
  const buf = readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${file}: not 8 bit, or interlaced`);
      channels = data[9] === 6 ? 4 : 3;
    }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] ?? 0;
      const a = x >= channels ? (out[y * stride + x - channels] ?? 0) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] ?? 0) : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter ?? 0] ?? 0;
      out[y * stride + x] = (v + add) & 0xff;
    }
  }
  const hex = (x: number, y: number) =>
    "#" +
    [0, 1, 2]
      .map((i) => (out[y * stride + x * channels + i] ?? 0).toString(16).padStart(2, "0"))
      .join("");
  /** 255 on an RGB file. */
  const alpha = (x: number, y: number) =>
    channels === 4 ? (out[y * stride + x * channels + 3] ?? 0) : 255;
  return { width, height, hex, alpha };
}
