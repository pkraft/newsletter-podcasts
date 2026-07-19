import { openSync, readSync, closeSync } from "node:fs";

export interface ImageSize {
  width: number;
  height: number;
  format: "jpeg" | "png";
}

/** Read JPEG/PNG pixel dimensions from file headers — no image library needed. */
export function imageSize(file: string): ImageSize {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(32);
    readSync(fd, head, 0, 32, 0);

    // PNG: 8-byte signature, IHDR width/height at offsets 16/20.
    if (head.readUInt32BE(0) === 0x89504e47) {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), format: "png" };
    }

    // JPEG: walk markers to the first SOF segment.
    if (head.readUInt16BE(0) === 0xffd8) {
      let offset = 2;
      const buf = Buffer.alloc(10);
      for (let i = 0; i < 1000; i++) {
        readSync(fd, buf, 0, 10, offset);
        if (buf[0] !== 0xff) throw new Error(`Corrupt JPEG marker at ${offset} in ${file}`);
        const marker = buf[1] as number;
        // SOF0..SOF15 except DHT(C4)/JPG(C8)/DAC(CC)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(7), height: buf.readUInt16BE(5), format: "jpeg" };
        }
        offset += 2 + buf.readUInt16BE(2);
      }
      throw new Error(`No SOF marker found in ${file}`);
    }

    throw new Error(`Unsupported image format (not JPEG/PNG): ${file}`);
  } finally {
    closeSync(fd);
  }
}

/** Apple Podcasts artwork rules: square, 1400-3000 px, JPEG or PNG. */
export function validateCoverArt(file: string): void {
  const { width, height } = imageSize(file);
  const problems: string[] = [];
  if (width !== height) problems.push(`not square (${width}x${height})`);
  if (width < 1400) problems.push(`too small (${width}px; Apple requires >= 1400)`);
  if (width > 3000) problems.push(`too large (${width}px; Apple allows <= 3000)`);
  if (problems.length > 0) {
    throw new Error(`Cover art ${file} fails Apple Podcasts requirements: ${problems.join(", ")}`);
  }
}
