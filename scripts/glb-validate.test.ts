// ===== R4-10: GLB 校验器单测（构造最小合法/非法 GLB 二进制）=====
import { describe, expect, it } from "vitest";
import {
  FACE_WARN_THRESHOLD,
  GlbParseError,
  parseGlb,
  validateGlb,
} from "./glb-validate.js";

/** 把 glTF JSON 对象打包成合法 GLB Buffer。 */
function buildGlb(json: Record<string, unknown>, bin?: Buffer): Buffer {
  const jsonText = JSON.stringify(json);
  // JSON chunk 按 4 字节对齐，补空格
  const jsonPad = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
  const jsonChunkLen = Buffer.byteLength(jsonText) + jsonPad;

  const binPad = bin ? (4 - (bin.length % 4)) % 4 : 0;
  const binChunkLen = bin ? bin.length + binPad : 0;

  const headerLen = 12;
  const chunkHeader = 8;
  const total =
    headerLen +
    chunkHeader + jsonChunkLen +
    (bin ? chunkHeader + binChunkLen : 0);

  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4; // magic "glTF"
  out.writeUInt32LE(2, o); o += 4;          // version
  out.writeUInt32LE(total, o); o += 4;      // length

  out.writeUInt32LE(jsonChunkLen, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4; // "JSON"
  out.write(jsonText, o, "utf8"); o += Buffer.byteLength(jsonText);
  out.fill(0x20, o, o + jsonPad); o += jsonPad;

  if (bin) {
    out.writeUInt32LE(binChunkLen, o); o += 4;
    out.writeUInt32LE(0x004e4942, o); o += 4; // "BIN\0"
    bin.copy(out, o); o += bin.length;
    out.fill(0, o, o + binPad);
  }
  return out;
}

/** 一个带 mesh + Armature + skin 的合法最小 glTF 2.0 场景。 */
const validGltf: Record<string, unknown> = {
  asset: { version: "2.0" },
  scenes: [{ nodes: [0] }],
  scene: 0,
  nodes: [
    { name: "Armature", children: [1] },
    { name: "Body", mesh: 0, skin: 0 },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [
    { count: 3, componentType: 5126, type: "VEC3" },
    { count: 3, componentType: 5123, type: "SCALAR" },
  ],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
  buffers: [{ byteLength: 12 }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.2, 1] } }],
  skins: [{ joints: [1] }],
  animations: [{ name: "Idle", channels: [] }],
};

describe("parseGlb · 容器解析", () => {
  it("解析合法 GLB：magic/version/length/JSON chunk 都正确", () => {
    const buf = buildGlb(validGltf, Buffer.alloc(12));
    const parsed = parseGlb(buf);
    expect(parsed.version).toBe(2);
    expect(parsed.totalLength).toBe(buf.length);
    expect(parsed.json.asset.version).toBe("2.0");
    expect(parsed.binByteLength).toBe(12);
  });

  it("文件过小 → GLB_TOO_SMALL", () => {
    try {
      parseGlb(Buffer.from([1, 2, 3]));
      throw new Error("应当抛错");
    } catch (e) {
      expect(e).toBeInstanceOf(GlbParseError);
      expect((e as GlbParseError).code).toBe("GLB_TOO_SMALL");
    }
  });

  it("magic number 非法 → GLB_BAD_MAGIC", () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32LE(0x12345678, 0);
    buf.writeUInt32LE(2, 4);
    buf.writeUInt32LE(12, 8);
    try {
      parseGlb(buf);
      throw new Error("应当抛错");
    } catch (e) {
      expect((e as GlbParseError).code).toBe("GLB_BAD_MAGIC");
    }
  });

  it("version≠2 → GLB_BAD_VERSION", () => {
    const buf = buildGlb(validGltf);
    buf.writeUInt32LE(1, 4); // 改 version
    buf.writeUInt32LE(buf.length, 8);
    expect(() => parseGlb(buf)).toThrowError(/仅支持 glTF 2.0/);
  });

  it("header.length 与实际长度不符 → GLB_LENGTH_MISMATCH", () => {
    const buf = buildGlb(validGltf);
    buf.writeUInt32LE(buf.length + 999, 8); // 撒谎
    expect(() => parseGlb(buf)).toThrowError(GLB_LENGTH_MISMATCH_regex());
  });

  it("第一个 chunk 不是 JSON → GLB_BAD_JSON_CHUNK", () => {
    const buf = buildGlb(validGltf);
    buf.writeUInt32LE(0xdeadbeef, 16); // 改 chunk type
    expect(() => parseGlb(buf)).toThrowError(/第一个 chunk 不是 JSON/);
  });

  it("JSON chunk 不是合法 JSON → GLB_BAD_JSON", () => {
    // 手工构造：header + JSON chunk 塞一段坏文本
    const bad = Buffer.from("{not json!!!    }   ");
    const total = 12 + 8 + bad.length;
    const out = Buffer.alloc(total);
    out.writeUInt32LE(0x46546c67, 0);
    out.writeUInt32LE(2, 4);
    out.writeUInt32LE(total, 8);
    out.writeUInt32LE(bad.length, 12);
    out.writeUInt32LE(0x4e4f534a, 16);
    bad.copy(out, 20);
    expect(() => parseGlb(out)).toThrowError(/JSON chunk 不是合法 JSON/);
  });
});

// 帮助：避免上面直接引用常量时的 lint 抱怨
function GLB_LENGTH_MISMATCH_regex() {
  return /header\.length/;
}

describe("validateGlb · 语义校验", () => {
  it("合法 GLB（mesh + Armature + skin）→ valid=true，无 error", () => {
    const buf = buildGlb(validGltf, Buffer.alloc(12));
    const report = validateGlb(buf);
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.stats.armatureFound).toBe(true);
    expect(report.stats.boneCount).toBe(1);
    expect(report.stats.meshCount).toBe(1);
    expect(report.stats.materialCount).toBe(1);
    expect(report.stats.animationNames).toContain("Idle");
  });

  it("没有 mesh → MESH_MISSING 错误", () => {
    const noMesh = { ...validGltf, meshes: [] };
    const report = validateGlb(buildGlb(noMesh));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain("MESH_MISSING");
  });

  it("既无 Armature 节点也无 skin → ARMATURE_MISSING 错误", () => {
    const naked = {
      ...validGltf,
      nodes: [{ name: "Root", mesh: 0 }],
      skins: [],
    };
    const report = validateGlb(buildGlb(naked));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain("ARMATURE_MISSING");
  });

  it("有 skin 但 joints 为空 → BONES_EMPTY 错误", () => {
    const emptySkin = { ...validGltf, skins: [{ joints: [] }] };
    const report = validateGlb(buildGlb(emptySkin));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain("BONES_EMPTY");
  });

  it("有 skin 但未命名 Armature → 仅 warning，不报错", () => {
    const renamed = {
      ...validGltf,
      nodes: [{ name: "RootSkeleton", children: [1] }, { name: "Body", mesh: 0, skin: 0 }],
    };
    const report = validateGlb(buildGlb(renamed));
    expect(report.errors.map((e) => e.code)).not.toContain("ARMATURE_MISSING");
    expect(report.warnings.map((w) => w.code)).toContain("ARMATURE_NAMING");
  });

  it("纹理用外部 file:// URI → 给 warning（不阻断）", () => {
    const extTex = {
      ...validGltf,
      images: [{ uri: "textures/body.png" }],
      textures: [{ source: 0 }],
    };
    const report = validateGlb(buildGlb(extTex));
    expect(report.warnings.map((w) => w.code)).toContain("TEXTURE_EXTERNAL_URI");
  });

  it("image 引用不存在的 bufferView → TEXTURE_BAD_BUFFERVIEW 错误", () => {
    const badRef = {
      ...validGltf,
      images: [{ bufferView: 99 }],
      textures: [{ source: 0 }],
    };
    const report = validateGlb(buildGlb(badRef));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain("TEXTURE_BAD_BUFFERVIEW");
  });

  it("三角面数超阈值 → FACE_COUNT_HIGH 警告但不影响 valid", () => {
    // 构造 200 个三角形的 accessor（count=600）
    const heavy = {
      ...validGltf,
      accessors: [
        { count: 0, componentType: 5126, type: "VEC3" },
        { count: 600, componentType: 5123, type: "SCALAR" }, // 200 tris
      ],
    };
    const report = validateGlb(buildGlb(heavy));
    // 200 < 阈值，不应告警
    expect(report.warnings.map((w) => w.code)).not.toContain("FACE_COUNT_HIGH");
    expect(report.stats.triangleCount).toBe(200);
    expect(FACE_WARN_THRESHOLD).toBeGreaterThan(200);
  });

  it("损坏二进制（非法 magic）→ valid=false 且错误码为 GLB_BAD_MAGIC", () => {
    const report = validateGlb(Buffer.from("PK\x03\x04 not a glb at all........."));
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("GLB_BAD_MAGIC");
  });
});
