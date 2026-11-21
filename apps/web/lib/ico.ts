// An .ico file that holds one PNG picture (browsers and crawlers have read that form since Windows Vista): a 6-byte header,
// one 16-byte entry saying where the picture is, then the PNG bytes as they are. Pure, so the favicon route and its test share it.
export function pngToIco(png: Uint8Array, size: number): Uint8Array {
  if (size < 1 || size > 255) throw new RangeError("an .ico entry is 1 to 255 pixels square here");
  const out = new Uint8Array(22 + png.length);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true); // type 1: icon
  view.setUint16(4, 1, true); // one picture
  out[6] = size; // width
  out[7] = size; // height
  view.setUint16(10, 1, true); // colour planes
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, png.length, true); // size of the picture
  view.setUint32(18, 22, true); // where it starts
  out.set(png, 22);
  return out;
}
