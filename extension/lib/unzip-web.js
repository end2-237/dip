// Zip reader for the browser (stored + deflate entries) — imports DIP pack .zip files into the library.
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

export async function unzipBytes(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.split('/').some((s) => s === '..')) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + csize);
    if (method !== 0 && method !== 8) continue;
    files.push({ path: name, data: method === 8 ? await inflateRaw(raw) : raw.slice() });
  }
  return files;
}

// DIP pack zip → { name, files } with paths relative to the pack root
export async function readPackZip(file) {
  const files = await unzipBytes(await file.arrayBuffer());
  const manifest = files.find((f) => /(^|\/)manifest\.json$/.test(f.path) && f.path.split('/').length <= 2);
  if (!manifest) throw new Error(file.name + ' : pas un pack DIP (manifest.json absent)');
  const prefix = manifest.path.slice(0, -'manifest.json'.length);
  const name = (prefix ? prefix.replace(/\/$/, '') : file.name.replace(/\.zip$/i, '')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return { name, files: files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ path: f.path.slice(prefix.length), data: f.data })) };
}
