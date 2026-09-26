// ===== M12: 统一角色解析器 =====
// 同步函数：以 custom- 开头的 id 查自定义人物表，其余走预置名人库。
// db 是 node:sqlite 同步 DAO，因此本模块保持同步。
import { basename } from "node:path";
import { getCelebrity } from "@balabala/shared";
import { getCustomCharacter } from "./db.js";

/** 解析后的统一角色视图：预置名人与自定义人物同构，供各场景编排器使用。 */
export interface ResolvedCharacter {
  id: string;
  name: string;
  title: string;
  intro: string;
  tags: string[];
  persona: string;
  greeting: string;
  /** 可直接用于前端 <img src> 的 URL。 */
  portrait: string;
  /** 可直接用于前端 GLTFLoader 的 URL。 */
  model?: string;
  /** 预置名人有，自定义可为空。 */
  field?: string;
  /** 预置名人有，自定义可为空。 */
  era?: string;
  isCustom: boolean;
  /** StepFun 官方预置音色（M13 第五轮），空串/缺省表示用默认音色。 */
  voice?: string;
}

/** 默认头像（自定义人物未上传头像时回退）。 */
const FALLBACK_PORTRAIT = "/portraits/celebrities/_default.jpg";

/** 把自定义人物存储的相对路径转换为可直接访问的静态资源 URL。 */
function toAssetUrl(id: string, stored: string): string | undefined {
  if (!stored) return undefined;
  const file = basename(stored);
  if (!file || file === ".." || file === ".") return undefined;
  return `/api/custom-characters/assets/${id}/${file}`;
}

/**
 * 解析单个角色引用。同步函数。
 * 以 custom- 开头：查 custom_characters 表；否则查预置名人。
 * 不做可见性过滤（场景内部使用时已由用户选择）；公开列表 API 自行过滤。
 */
export function resolveCharacter(ref: string): ResolvedCharacter | undefined {
  if (!ref) return undefined;
  if (ref.startsWith("custom-")) {
    const rec = getCustomCharacter(ref);
    if (!rec) return undefined;
    return {
      id: rec.id,
      name: rec.name,
      title: rec.title,
      intro: rec.intro,
      tags: rec.tags,
      persona: rec.persona,
      greeting: rec.greeting,
      portrait: toAssetUrl(rec.id, rec.portraitPath) ?? FALLBACK_PORTRAIT,
      model: toAssetUrl(rec.id, rec.modelPath),
      isCustom: true,
      voice: rec.voice || undefined,
    };
  }
  const celeb = getCelebrity(ref);
  if (!celeb) return undefined;
  return {
    id: celeb.id,
    name: celeb.name,
    title: celeb.title,
    intro: celeb.intro,
    tags: celeb.tags,
    persona: celeb.persona,
    greeting: celeb.greeting,
    portrait: celeb.portrait,
    model: celeb.model,
    field: celeb.field,
    era: celeb.era,
    isCustom: false,
    voice: celeb.voice,
  };
}

/** 批量解析，过滤掉无法解析的引用。 */
export function resolveCharacters(refs: string[]): ResolvedCharacter[] {
  return refs
    .map((ref) => resolveCharacter(ref))
    .filter((c): c is ResolvedCharacter => Boolean(c));
}
