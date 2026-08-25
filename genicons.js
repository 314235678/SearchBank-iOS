// 生成 AppIcon 全套 PNG（纯色品牌蓝 #2563eb），写入 Assets.xcassets/AppIcon.appiconset。
// 仅用于让 Xcode 工程可正常构建/归档；正式发布前请替换为设计稿。
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DIR = path.join(__dirname, "SearchBank", "Assets.xcassets", "AppIcon.appiconset");
fs.mkdirSync(DIR, { recursive: true });

const COLOR = [0x25, 0x63, 0xeb]; // #2563eb

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePNG(size) {
  const w = size, h = size;
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // raw image: each row filter byte 0 + w*3 bytes
  const row = w * 3;
  const raw = Buffer.alloc((row + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (row + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (row + 1) + 1 + x * 3;
      raw[o] = COLOR[0];
      raw[o + 1] = COLOR[1];
      raw[o + 2] = COLOR[2];
    }
  }
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// [filename, pixelSize, idiom, scale, pointSize]
const ICONS = [
  ["icon-20@2x.png", 40, "iphone", "2x", "20x20"],
  ["icon-20@3x.png", 60, "iphone", "3x", "20x20"],
  ["icon-29@2x.png", 58, "iphone", "2x", "29x29"],
  ["icon-29@3x.png", 87, "iphone", "3x", "29x29"],
  ["icon-40@2x.png", 80, "iphone", "2x", "40x40"],
  ["icon-40@3x.png", 120, "iphone", "3x", "40x40"],
  ["icon-60@2x.png", 120, "iphone", "2x", "60x60"],
  ["icon-60@3x.png", 180, "iphone", "3x", "60x60"],
  ["icon-76.png", 76, "ipad", "1x", "76x76"],
  ["icon-76@2x.png", 152, "ipad", "2x", "76x76"],
  ["icon-83.5@2x.png", 167, "ipad", "2x", "83.5x83.5"],
  ["icon-1024.png", 1024, "ios-marketing", "1x", "1024x1024"]
];

const images = [];
for (const [name, size, idiom, scale, pointSize] of ICONS) {
  fs.writeFileSync(path.join(DIR, name), makePNG(size));
  images.push({ idiom, scale, size: pointSize, filename: name });
}

const contents = {
  images,
  info: { version: 1, author: "xcode" }
};
fs.writeFileSync(
  path.join(DIR, "Contents.json"),
  JSON.stringify(contents, null, 2),
  "utf8"
);
console.log("generated", ICONS.length, "icons + Contents.json");
