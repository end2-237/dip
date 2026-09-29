// Minimal glTF 2.0 binary (.glb) writer for one captured geometry (positions, normals, uvs, indices + a PBR material).
// Enough for three.js GLTFLoader, Blender and gltf-transform.

function b64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const pad4 = (n) => (n + 3) & ~3;

function hexToLinear(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return [0.8, 0.8, 0.8];
  return [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

export function geometryToGlb(g) {
  const parts = [];
  const bufferViews = [];
  const accessors = [];
  let offset = 0;
  const push = (bytes, target) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    parts.push({ bytes, offset });
    offset = pad4(offset + bytes.length);
    return bufferViews.length - 1;
  };
  const attributes = {};
  const pos = b64ToBytes(g.position);
  accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 12, type: 'VEC3', min: g.min, max: g.max });
  attributes.POSITION = 0;
  if (g.normal) {
    const b = b64ToBytes(g.normal);
    accessors.push({ bufferView: push(b, 34962), componentType: 5126, count: b.length / 12, type: 'VEC3' });
    attributes.NORMAL = accessors.length - 1;
  }
  if (g.uv) {
    const b = b64ToBytes(g.uv);
    accessors.push({ bufferView: push(b, 34962), componentType: 5126, count: b.length / 8, type: 'VEC2' });
    attributes.TEXCOORD_0 = accessors.length - 1;
  }
  const prim = { attributes, mode: g.mode == null ? 4 : g.mode, material: 0 };
  if (g.index) {
    const b = b64ToBytes(g.index);
    accessors.push({ bufferView: push(b, 34963), componentType: 5125, count: b.length / 4, type: 'SCALAR' });
    prim.indices = accessors.length - 1;
  }
  const m = g.material || {};
  const color = hexToLinear(m.color);
  const material = {
    name: m.type || 'material',
    pbrMetallicRoughness: { baseColorFactor: [...color, m.transparent && m.opacity != null ? m.opacity : 1], metallicFactor: m.metalness != null ? m.metalness : 0, roughnessFactor: m.roughness != null ? m.roughness : 1 },
    doubleSided: true,
  };
  if (m.emissive && m.emissive !== '#000000') material.emissiveFactor = hexToLinear(m.emissive);
  if (m.transparent) material.alphaMode = 'BLEND';
  const name = g.name || 'mesh';
  const json = {
    asset: { version: '2.0', generator: 'DIP (Design Intelligence Pipeline) — study capture, do not ship' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [prim] }],
    materials: [material],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const bin = new Uint8Array(offset);
  for (const p of parts) bin.set(p.bytes, p.offset);
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLen + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  for (let i = 20 + jsonBytes.length; i < 20 + jsonLen; i++) out[i] = 0x20;
  const bo = 20 + jsonLen;
  dv.setUint32(bo, bin.length, true);
  dv.setUint32(bo + 4, 0x004e4942, true); // 'BIN\0'
  out.set(bin, bo + 8);
  return out;
}
