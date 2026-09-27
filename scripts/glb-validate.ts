// ===== R4-10: GLB 导入校验（纯 Node 二进制解析，零三方依赖）=====
// 不引入 three.js / gltf-pipeline，只用 Buffer 解析 GLB 容器头 + JSON chunk。
// 用途：Tripo 批量产出的 .glb 在放进 apps/web/public/models/characters/ 之前，
// 由 CI / 本地脚本统一校验格式、必备节点、骨骼、材质、面数与纹理引用。

export type IssueSeverity = "error" | "warning";

export interface GlbIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
}

export interface GlbStats {
  /** glTF version（GLB header.version，合法为 2）。 */
  version: number;
  /** header 声明的总字节数。 */
  totalLength: number;
  /** 实际 buffer 字节数。 */
  bufferLength: number;
  nodeCount: number;
  meshCount: number;
  materialCount: number;
  /** 是否存在名为 Armature 的骨骼根节点。 */
  armatureFound: boolean;
  /** 骨骼数量（skin.joints 长度之和）。 */
  boneCount: number;
  /** 估算三角形面数（所有 mesh.primitives 的 indices accessor 推断）。 */
  triangleCount: number;
  textureCount: number;
  /** 动画片段名（animations[].name 或 channel 目标）。 */
  animationNames: string[];
}

export interface GlbValidationReport {
  /** 是否通过（无 error）。warnings 不影响通过。 */
  valid: boolean;
  errors: GlbIssue[];
  warnings: GlbIssue[];
  stats: GlbStats;
}

// GLB 常量
const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const HEADER_LEN = 12;
const CHUNK_HEADER_LEN = 8;

/** 面数告警阈值：超过则给 warning（不是 error）。半身像建议 ≤ 3 万三角面。 */
export const FACE_WARN_THRESHOLD = 50_000;

interface ParsedGlb {
  version: number;
  totalLength: number;
  json: Record<string, any>;
  binByteLength: number;
}

/** 解析 GLB 容器；格式非法时抛出带 code 的 Error。 */
export function parseGlb(buffer: Buffer | Uint8Array): ParsedGlb {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  if (buf.length < HEADER_LEN) {
    throw new GlbParseError(
      "GLB_TOO_SMALL",
      `文件过小（${buf.length} 字节），不足 12 字节头。`,
    );
  }

  const magic = buf.readUInt32LE(0);
  if (magic !== GLB_MAGIC) {
    throw new GlbParseError(
      "GLB_BAD_MAGIC",
      `magic number 非法：期望 0x46546C67（glTF），实际 0x${magic.toString(16)}。`,
    );
  }

  const version = buf.readUInt32LE(4);
  if (version !== GLB_VERSION) {
    throw new GlbParseError(
      "GLB_BAD_VERSION",
      `仅支持 glTF 2.0，实际 version=${version}。`,
    );
  }

  const totalLength = buf.readUInt32LE(8);
  if (totalLength !== buf.length) {
    throw new GlbParseError(
      "GLB_LENGTH_MISMATCH",
      `header.length=${totalLength} 与实际文件长度 ${buf.length} 不一致。`,
    );
  }

  // 第一个 chunk 必须是 JSON
  let offset = HEADER_LEN;
  if (offset + CHUNK_HEADER_LEN > buf.length) {
    throw new GlbParseError("GLB_TRUNCATED", "缺少 JSON chunk 头。");
  }
  const jsonChunkLen = buf.readUInt32LE(offset);
  const jsonChunkType = buf.readUInt32LE(offset + 4);
  offset += CHUNK_HEADER_LEN;
  if (jsonChunkType !== CHUNK_JSON) {
    throw new GlbParseError(
      "GLB_BAD_JSON_CHUNK",
      `第一个 chunk 不是 JSON（type=0x${jsonChunkType.toString(16)}）。`,
    );
  }
  if (offset + jsonChunkLen > buf.length) {
    throw new GlbParseError("GLB_TRUNCATED", "JSON chunk 超出文件末尾。");
  }
  const jsonBytes = buf.subarray(offset, offset + jsonChunkLen);
  offset += jsonChunkLen;

  let json: Record<string, any>;
  try {
    const text = jsonBytes.toString("utf8").replace(/\s+$/g, "");
    json = JSON.parse(text);
  } catch (err) {
    throw new GlbParseError(
      "GLB_BAD_JSON",
      `JSON chunk 不是合法 JSON：${err instanceof Error ? err.message : String(err)}。`,
    );
  }

  // 第二个 chunk（可选）BIN
  let binByteLength = 0;
  if (offset + CHUNK_HEADER_LEN <= buf.length) {
    const binChunkLen = buf.readUInt32LE(offset);
    const binChunkType = buf.readUInt32LE(offset + 4);
    if (binChunkType === CHUNK_BIN) {
      binByteLength = binChunkLen;
      offset += CHUNK_HEADER_LEN + binChunkLen;
    }
  }

  return { version, totalLength, json, binByteLength };
}

export class GlbParseError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "GlbParseError";
  }
}

/** 估算三角面数：有 indices 用 accessor.count/3，无 indices 用 position.count/3。 */
function estimateTriangles(json: Record<string, any>): number {
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  let tris = 0;
  for (const mesh of meshes) {
    const prims = Array.isArray(mesh?.primitives) ? mesh.primitives : [];
    for (const prim of prims) {
      const idx = prim?.indices;
      if (typeof idx === "number" && accessors[idx]) {
        const count = accessors[idx].count;
        if (typeof count === "number") tris += count / 3;
      } else if (prim?.attributes && typeof prim.attributes.POSITION === "number" && accessors[prim.attributes.POSITION]) {
        const count = accessors[prim.attributes.POSITION].count;
        if (typeof count === "number") tris += count / 3;
      }
    }
  }
  return Math.round(tris);
}

/** 主入口：校验一段 GLB 二进制，返回结构化报告（不抛异常）。 */
export function validateGlb(buffer: Buffer | Uint8Array): GlbValidationReport {
  const errors: GlbIssue[] = [];
  const warnings: GlbIssue[] = [];
  const stats: GlbStats = {
    version: 0,
    totalLength: 0,
    bufferLength: buffer.length,
    nodeCount: 0,
    meshCount: 0,
    materialCount: 0,
    armatureFound: false,
    boneCount: 0,
    triangleCount: 0,
    textureCount: 0,
    animationNames: [],
  };

  let parsed: ParsedGlb;
  try {
    parsed = parseGlb(buffer);
  } catch (err) {
    const code = err instanceof GlbParseError ? err.code : "GLB_UNKNOWN";
    errors.push({
      severity: "error",
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    return { valid: false, errors, warnings, stats };
  }

  stats.version = parsed.version;
  stats.totalLength = parsed.totalLength;
  const json = parsed.json;

  const nodes: any[] = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes: any[] = Array.isArray(json.meshes) ? json.meshes : [];
  const materials: any[] = Array.isArray(json.materials) ? json.materials : [];
  const skins: any[] = Array.isArray(json.skins) ? json.skins : [];
  const textures: any[] = Array.isArray(json.textures) ? json.textures : [];
  const images: any[] = Array.isArray(json.images) ? json.images : [];
  const animations: any[] = Array.isArray(json.animations) ? json.animations : [];

  stats.nodeCount = nodes.length;
  stats.meshCount = meshes.length;
  stats.materialCount = materials.length;
  stats.textureCount = textures.length;
  stats.animationNames = animations
    .map((a, i) => (typeof a?.name === "string" && a.name ? a.name : `animation_${i}`))
    .filter(Boolean);

  // —— 必备节点：至少一个 Mesh ——
  if (meshes.length === 0) {
    errors.push({
      severity: "error",
      code: "MESH_MISSING",
      message: "GLB 中没有任何 mesh（需要至少一个可渲染网格）。",
    });
  }

  // —— 必备节点：Armature 骨骼根 ——
  stats.armatureFound = nodes.some((n) => n?.name === "Armature");
  if (!stats.armatureFound) {
    // 退一步：有 skin 也算带骨骼
    if (skins.length === 0) {
      errors.push({
        severity: "error",
        code: "ARMATURE_MISSING",
        message: '未找到名为 "Armature" 的节点，且没有 skin（骨骼绑定）。',
      });
    } else {
      warnings.push({
        severity: "warning",
        code: "ARMATURE_NAMING",
        message: '存在 skin 但根节点未命名为 "Armature"，导入后动画可能找不到骨骼根。',
      });
    }
  }

  // —— 骨骼数量 > 0 ——
  stats.boneCount = skins.reduce((sum, s) => sum + (Array.isArray(s?.joints) ? s.joints.length : 0), 0);
  if (skins.length > 0 && stats.boneCount === 0) {
    errors.push({
      severity: "error",
      code: "BONES_EMPTY",
      message: "存在 skin 但 joints 为空（骨骼数量为 0）。",
    });
  }

  // —— 面数（仅告警）——
  stats.triangleCount = estimateTriangles(json);
  if (stats.triangleCount > FACE_WARN_THRESHOLD) {
    warnings.push({
      severity: "warning",
      code: "FACE_COUNT_HIGH",
      message: `三角面数约 ${stats.triangleCount.toLocaleString()}，超过建议值 ${FACE_WARN_THRESHOLD.toLocaleString()}，移动端可能卡顿。`,
    });
  }

  // —— 材质 ——
  if (materials.length === 0) {
    warnings.push({
      severity: "warning",
      code: "MATERIAL_MISSING",
      message: "没有显式材质，Three.js 会回退默认材质（建议 PBR 材质）。",
    });
  }

  // —— 纹理引用：image 必须可解析（embedded bufferView 或合法 http URI）——
  const bufferViews: any[] = Array.isArray(json.bufferViews) ? json.bufferViews : [];
  images.forEach((img, i) => {
    if (!img) return;
    if (typeof img.uri === "string" && img.uri) {
      if (!/^data:|^https?:\/\//i.test(img.uri)) {
        warnings.push({
          severity: "warning",
          code: "TEXTURE_EXTERNAL_URI",
          message: `images[${i}].uri 引用外部资源 "${img.uri}"，打包时需一并拷贝。`,
        });
      }
    } else if (typeof img.bufferView === "number") {
      if (!bufferViews[img.bufferView]) {
        errors.push({
          severity: "error",
          code: "TEXTURE_BAD_BUFFERVIEW",
          message: `images[${i}] 引用了不存在的 bufferView #${img.bufferView}。`,
        });
      }
    }
  });

  // —— BIN chunk 与 buffers[0].byteLength 一致性 ——
  const buffers: any[] = Array.isArray(json.buffers) ? json.buffers : [];
  if (buffers[0] && typeof buffers[0].byteLength === "number") {
    if (parsed.binByteLength !== buffers[0].byteLength) {
      warnings.push({
        severity: "warning",
        code: "BIN_LENGTH_MISMATCH",
        message: `BIN chunk ${parsed.binByteLength} 字节与 buffers[0].byteLength=${buffers[0].byteLength} 不一致。`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings, stats };
}

/** 命令行入口：node --experimental-strip-types glb-validate.ts <file.glb> 输出 JSON 报告。 */
export async function main(argv: string[]): Promise<number> {
  const file = argv[2];
  if (!file) {
    console.error("用法: tsx glb-validate.ts <file.glb>");
    return 2;
  }
  const { readFileSync } = await import("node:fs");
  const buf = readFileSync(file);
  const report = validateGlb(buf);
  console.log(JSON.stringify(report, null, 2));
  return report.valid ? 0 : 1;
}

// 直接被运行时执行时（不是被 import 测试）才跑 CLI。
if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
