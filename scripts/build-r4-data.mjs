// R4-10 一次性数据生成器：
//   1) apps/api/data/character-voice-map.json   —— 100 名人音色/语速/音调映射
//   2) apps/api/data/character-greetings.json   —— 100 名人专属开场白
//   3) apps/api/data/offline-brains/<id>.json    —— 为缺失名人补全离线脑（10 条 QA）
//   4) apps/api/data/offline-brains/index.json   —— 知识库索引
//
// 运行：node scripts/build-r4-data.mjs
// 设计原则：facts/quotes 全部来自公开历史常识；persona/era 直接从 celebrities.ts
// 复用，避免与共享人设漂移。

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const celebSrc = readFileSync(resolve(root, "packages/shared/src/celebrities.ts"), "utf8");

// —— 从 celebrities.ts 粗解析出 id → { name, era, field, persona, greeting, voice } ——
function parseCelebs(src) {
  const blocks = src.split(/\n  \{\n/).slice(1);
  const out = {};
  for (const b of blocks) {
    const id = (b.match(/id:\s*"([^"]+)"/) || [])[1];
    if (!id) continue;
    const grab = (k) => (b.match(new RegExp(`${k}:\\s*"([^"]*)"`)) || [])[1] ?? "";
    out[id] = {
      id,
      name: grab("name"),
      era: grab("era"),
      field: grab("field"),
      persona: grab("persona"),
      greeting: grab("greeting"),
      voice: grab("voice"),
    };
  }
  return out;
}
const celebs = parseCelebs(celebSrc);
const allIds = Object.keys(celebs);

// ===== 1. 音色分类：从已有 StepFun voice 反推气质类别（保持与原分配一致）=====
const VOICE_TO_CATEGORY = {
  shenchennanyin: "deep_male",
  cixingnansheng: "deep_male",
  ruyananshi: "old_male",
  wenrougongzi: "old_male",
  wenrounansheng: "old_male",
  yuanqinansheng: "young_male",
  zhengpaiqingnian: "young_male",
  qingniandaxuesheng: "young_male",
  boyinnansheng: "young_male",
  zhixingjiejie: "bright_female",
  wenrounvsheng: "old_female",
  tianmeinvsheng: "young_female",
  jingdiannvsheng: "neutral",
};
const CATEGORY_SPEED_PITCH = {
  deep_male: { speed: 0.95, pitch: 0.95 },
  old_male: { speed: 0.9, pitch: 1.0 },
  young_male: { speed: 1.05, pitch: 1.0 },
  bright_female: { speed: 1.0, pitch: 1.05 },
  old_female: { speed: 0.9, pitch: 1.0 },
  young_female: { speed: 1.05, pitch: 1.1 },
  neutral: { speed: 1.0, pitch: 1.0 },
};

const voiceMap = {};
for (const id of allIds) {
  const c = celebs[id];
  const category = VOICE_TO_CATEGORY[c.voice] ?? "neutral";
  const sp = CATEGORY_SPEED_PITCH[category];
  voiceMap[id] = { voice: c.voice, category, speed: sp.speed, pitch: sp.pitch };
}
writeFileSync(
  resolve(root, "apps/api/data/character-voice-map.json"),
  JSON.stringify(voiceMap, null, 2) + "\n",
);
console.log(`written character-voice-map.json (${allIds.length} entries)`);

// ===== 2. 开场白：复用 celebrities.greeting；外国名人追加原文名句 =====
const FOREIGN_QUOTES = {
  "albert-einstein": "Imagination is more important than knowledge.",
  "marie-curie": "Nothing in life is to be feared; it is only to be understood.",
  shakespeare: "To be, or not to be, that is the question.",
  socrates: "The unexamined life is not worth living.",
  plato: "Wise men speak because they have something to say; Fools because they have to say something.",
  aristotle: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
  nietzsche: "That which does not kill us makes us stronger.",
  "leonardo": "Simplicity is the ultimate sophistication.",
  "van-gogh": "I dream my painting, and then I paint my dream.",
  "nikola-tesla": "The present is theirs; the future, for which I really worked, is mine.",
  "isaac-newton": "If I have seen further, it is by standing on the shoulders of giants.",
  "charles-darwin": "It is not the strongest that survives, but the most adaptable.",
  "abraham-lincoln": "Whatever you are, be a good one.",
  "winston-churchill": "We shall fight on the beaches. I have nothing to offer but blood, toil, tears and sweat.",
  "napoleon": "Impossible is a word to be found only in the dictionary of fools.",
  "julius-caesar": "The die is cast.",
  "sigmund-freud": "Being entirely honest with oneself is a good exercise.",
  "immanuel-kant": "Starry heavens above and the moral law within.",
  "karl-marx": "The philosophers have only interpreted the world; the point is to change it.",
  dante: "Lasciate ogni speranza, voi ch'entrate.",
};

const greetings = {};
for (const id of allIds) {
  const g = celebs[id].greeting;
  const lines = [g];
  if (FOREIGN_QUOTES[id]) lines.push(FOREIGN_QUOTES[id]);
  greetings[id] = { lines, enabled: true };
}
writeFileSync(
  resolve(root, "apps/api/data/character-greetings.json"),
  JSON.stringify(greetings, null, 2) + "\n",
);
console.log(`written character-greetings.json (${allIds.length} entries)`);

// ===== 3. 离线脑：为缺失名人补全 =====
// 仅内嵌 facts（生平/成就/趣闻）与 quotes（名言）；persona/era 从 celebrities.ts 复用。
// 10 条 QA 由 facts/quotes 模板化生成，答案内容均为该人物真实事实，可用于离线兜底。
const SEEDS = {
  "archimedes": {
    facts: ["古希腊叙拉古数学家、力学家", "发现杠杆原理与浮力定律（阿基米德原理）", "传说洗澡时悟出浮力，裸奔喊尤里卡", "造出螺旋提水器与守城器械", "罗马士兵破城时仍在沙地上画几何图，被杀"],
    quotes: ["给我一个支点，我就能撬动地球。", "尤里卡！（Eureka，我发现了）"],
  },
  "copernicus": {
    facts: ["波兰天文学家，日心说提出者", "《天体运行论》推翻地心说", "近代天文学革命的开端", "临终前才同意出版著作，怕教会迫害", "以数学计算证明地球绕太阳转"],
    quotes: ["在真理面前，一个人的权威不足以审判全宇宙。"],
  },
  "euclid": {
    facts: ["古希腊数学家，被称为几何之父", "著《几何原本》，建立公理化演绎体系", "两千多年里是西方数学教科书", "对托勒密王说：几何学无王者之路", "提出五大公设，欧氏几何基础"],
    quotes: ["几何学无王者之路。"],
  },
  "galileo": {
    facts: ["意大利物理学家、天文学家，近代科学之父", "改进望远镜观测木星卫星与月球环形山", "支持日心说，被宗教裁判所审判软禁", "传说在比萨斜塔做自由落体实验", "晚年失明仍坚持力学研究"],
    quotes: ["可是，它（地球）仍然在动。", "大自然这部书是用数学语言写成的。"],
  },
  "charles-darwin": {
    facts: ["英国生物学家，进化论奠基人", "乘小猎犬号环球考察五年", "1859 出版《物种起源》", "提出自然选择学说", "人类由古猿演化而来的观点震动世界"],
    quotes: ["能生存下来的不是最强的，而是最能适应变化的。"],
  },
  "qian-xuesen": {
    facts: ["中国航天之父、火箭专家", "麻省理工/加州理工教授，冯·卡门弟子", "历经五年外交斗争才从美国回国", "主持中国导弹、航天事业奠基", "两弹一星功勋奖章获得者"],
    quotes: ["外国人能搞的，难道中国人不能搞？"],
  },
  "deng-jiaxian": {
    facts: ["中国核物理理论奠基人，两弹元勋", "留学美国普渡，获博士即回国", "隐姓埋名二十八年在戈壁搞原子弹氢弹", "1964 原子弹、1967 氢弹先后爆炸成功", "因核辐射受伤害，1986 病逝"],
    quotes: ["我不能走。"],
  },
  "yuan-longping": {
    facts: ["杂交水稻之父", "培育出高产杂交水稻，养活数亿人", "毕生在田间地头做实验", "共和国勋章获得者", "梦想禾下乘凉、水稻覆盖全球"],
    quotes: ["我有两个梦：一个是禾下乘凉梦，一个是杂交水稻覆盖全球梦。"],
  },
  "alexander-bell": {
    facts: ["苏格兰裔美国发明家", "1876 发明电话并获专利", "受聋人母亲影响研究声学", "创立贝尔电话公司", "晚年还研究航空与金属探测"],
    quotes: ["当一扇门关上时，另一扇会打开；但我们常常留恋那扇关上的门。"],
  },
  "thomas-edison": {
    facts: ["美国发明大王，拥有一千多项专利", "发明实用白炽灯、留声机、活动电影摄影机", "建立世界第一个工业研究实验室", "失败千次后找到竹丝灯丝", "名言：天才是百分之一灵感加百分之九十九汗水"],
    quotes: ["天才是百分之一的灵感，加上百分之九十九的汗水。"],
  },
  "wright-brothers": {
    facts: ["美国莱特兄弟，飞机发明者", "原是自行车修理工", "1903 年 12 月 17 日首次动力载人飞行", "飞行仅 12 秒 36 米，却改变世界", "自研风洞研究翼型"],
    quotes: ["飞行是人类最崇高的职业之一。"],
  },
  "adam-smith": {
    facts: ["英国古典经济学之父", "1776 出版《国富论》", "提出看不见的手与分工理论", "主张自由市场、反对重商主义", "现代经济学奠基之作"],
    quotes: ["我们的晚餐并非来自屠夫的仁慈，而是出于他们对自身利益的打算。"],
  },
  "henry-ford": {
    facts: ["美国汽车大王，福特汽车创始人", "发明流水线生产方式", "让 T 型车走进寻常百姓家", "把日工资提至 5 美元，工人买得起自己造的车", "彻底改变现代工业与城市面貌"],
    quotes: ["如果我当初问顾客想要什么，他们会说：一匹更快的马。"],
  },
  "john-maynard-keynes": {
    facts: ["英国宏观经济学之父", "1936 出版《就业、利息和货币通论》", "主张政府干预应对经济危机", "凯恩斯主义影响二战后各国政策", "布雷顿森林体系的设计师之一"],
    quotes: ["长期来看，我们都死了。"],
  },
  "zhang-jian": {
    facts: ["清末状元，实业救国代表", "弃官从商，创办大生纱厂", "在南通办学校、博物馆、养老院", "中国早期民族工商业先驱", "一人之力兴起一座南通城"],
    quotes: ["天之生人也，与草木无异。若遗留一二有用事业，与草木同生，即不与草木同腐。"],
  },
  "bai-juyi": {
    facts: ["唐代大诗人，字乐天，号香山居士", "主张文章合为时而著，歌诗合为事而作", "《长恨歌》《琵琶行》传世", "写诗先读给老妇人听，懂了才定稿", "为官关心民间疾苦"],
    quotes: ["同是天涯沦落人，相逢何必曾相识。", "在天愿作比翼鸟，在地愿为连理枝。"],
  },
  "du-fu": {
    facts: ["唐代诗圣，字子美", "亲历安史之乱，诗多反映民生", "三吏三别、《春望》《茅屋为秋风所破歌》", "诗作被称为诗史", "一生颠沛，晚年漂泊湘江"],
    quotes: ["国破山河在，城春草木深。", "安得广厦千万间，大庇天下寒士俱欢颜。"],
  },
  "dante": {
    facts: ["意大利诗人，文艺复兴先驱", "《神曲》分地狱、炼狱、天堂三部", "被佛罗伦萨流放，客死拉文纳", "用意大利方言写作，奠定意大利语", "马克思称他为中世纪最后一位诗人"],
    quotes: ["走自己的路，让别人说去吧。"],
  },
  "guan-hanqing": {
    facts: ["元代杂剧奠基人", "《窦娥冤》《救风尘》传世", "自称是蒸不烂煮不熟的铜豌豆", "长期混迹瓦舍勾栏，了解底层", "元曲四大家之首"],
    quotes: ["我是个蒸不烂、煮不熟、捶不匾、炒不爆、响珰珰一粒铜豌豆。"],
  },
  "hu-shi": {
    facts: ["近现代学者、新文化运动领袖", "提倡白话文与文学改良刍议", "曾任北大校长、驻美大使", "实验主义信徒，多研究问题少谈主义", "《尝试集》是第一部白话新诗集"],
    quotes: ["大胆地假设，小心地求证。", "做学问要在不疑处有疑，待人要在有疑处不疑。"],
  },
  "li-qingzhao": {
    facts: ["宋代婉约派女词人，号易安居士", "前期词作清丽，南渡后凄苦", "《声声慢》《一剪梅》传世", "精通金石学，与夫赵明诚著《金石录》", "千古第一才女"],
    quotes: ["寻寻觅觅，冷冷清清，凄凄惨惨戚戚。", "生当作人杰，死亦为鬼雄。"],
  },
  "liu-zongyuan": {
    facts: ["唐代文学家，唐宋八大家之一", "参与永贞革新失败，贬永州、柳州", "永州八记写山水游记典范", "《捕蛇者说》反映苛政", "与韩愈并称韩柳，倡导古文运动"],
    quotes: ["潭中鱼可百许头，皆若空游无所依。"],
  },
  "marco-polo": {
    facts: ["威尼斯旅行家", "元朝时来华，仕宦十七年", "口述《马可·波罗行纪》", "描述东方的黄金与繁华，刺激欧洲大航海", "有人怀疑他是否真到过中国"],
    quotes: ["朕尚未写下我所见的一半。"],
  },
  "qu-yuan": {
    facts: ["战国楚国诗人，楚辞创立者", "主张联齐抗秦，被谗放逐", "代表作《离骚》《九歌》", "五月初五投汨罗江，端午节由来", "中国浪漫主义文学源头"],
    quotes: ["路漫漫其修远兮，吾将上下而求索。", "长太息以掩涕兮，哀民生之多艰。"],
  },
  "si-maqian": {
    facts: ["西汉史学家，太史令", "因李陵之祸受宫刑，忍辱著书", "《史记》是中国第一部纪传体通史", "五十二万字，记载三千年", "被鲁迅誉为史家之绝唱，无韵之离骚"],
    quotes: ["人固有一死，或重于泰山，或轻于鸿毛。"],
  },
  "tao-yuanming": {
    facts: ["东晋诗人，号五柳先生", "不为五斗米折腰，辞官归隐", "《桃花源记》《归去来兮辞》", "田园诗派开创者", "采菊东篱下，悠然见南山"],
    quotes: ["采菊东篱下，悠然见南山。", "不为五斗米折腰。"],
  },
  "wang-bo": {
    facts: ["初唐四杰之首", "少年才俊，六岁能文", "《滕王阁序》千古名篇", "落霞与孤鹜齐飞，秋水共长天一色", "渡海探父，溺水惊悸而死，年仅二十六"],
    quotes: ["落霞与孤鹜齐飞，秋水共长天一色。", "老当益壮，宁移白首之心；穷且益坚，不坠青云之志。"],
  },
  "xin-qiji": {
    facts: ["南宋词人，字幼安，号稼轩", "二十一岁率五十骑闯五万人营擒叛徒", "力主抗金，却被弹劾闲居二十年", "词风豪放，与苏轼并称苏辛", "《破阵子》《永遇乐》传世"],
    quotes: ["众里寻他千百度，蓦然回首，那人却在，灯火阑珊处。", "了却君王天下事，赢得生前身后名。"],
  },
  "yan-fu": {
    facts: ["清末启蒙思想家、翻译家", "留学英国海军", "译《天演论》，物竞天择适者生存震动国人", "提出信、达、雅翻译标准", "北洋水师学堂总办"],
    quotes: ["物竞天择，适者生存。"],
  },
  "liang-qichao": {
    facts: ["近代启蒙思想家、学者", "戊戌变法领袖之一，流亡日本", "《新民说》影响一代青年", "学术著作宏富，涵盖历史、政治、佛学", "儿子梁思成是著名建筑学家"],
    quotes: ["少年智则国智，少年强则国强。"],
  },
  "donatello": {
    facts: ["意大利文艺复兴早期雕塑家", "代表作《大卫》青铜像", "开创写实主义雕塑", "影响米开朗基罗", "多纳泰罗是透视法在雕塑中的先驱"],
    quotes: ["雕塑是让石头呼吸的艺术。"],
  },
  "michelangelo": {
    facts: ["文艺复兴三杰之一", "雕塑《大卫》、天顶画《创世纪》", "晚年主持圣彼得大教堂", "认为自己首先是雕塑家", "壁画《最后的审判》"],
    quotes: ["我在大理石中看见天使，于是我不停地雕刻，直至让他自由。"],
  },
  "raphael": {
    facts: ["文艺复兴三杰之一", "代表作《西斯廷圣母》《雅典学院》", "风格优雅和谐，短命而成就惊人", "年仅三十七岁去世", "影响后世古典主义两百年"],
    quotes: ["为了创造美丽，需要不断地学习。"],
  },
  "wang-xizhi": {
    facts: ["东晋书法家，书圣", "《兰亭集序》天下第一行书", "行书飘逸遒美", "爱鹅，为道士写经换鹅", "儿子王献之亦是书法大家"],
    quotes: ["群贤毕至，少长咸集。"],
  },
  "aristotle": {
    facts: ["古希腊哲学家，柏拉图弟子", "亚历山大大帝的老师", "逻辑学、物理学、伦理学、政治学百科全书式学者", "名言：人是天生的政治动物", "吕克昂学园逍遥派"],
    quotes: ["优秀不是一种行为，而是一种习惯。"],
  },
  "han-feizi": {
    facts: ["战国法家思想集大成者", "韩国公子，口吃而善著书", "《韩非子》主张法、术、势结合", "思想被秦始皇激赏", "同学李斯嫉妒，将其害死于秦"],
    quotes: ["千里之堤，溃于蚁穴。"],
  },
  "hegel": {
    facts: ["德国古典哲学集大成者", "辩证法正、反、合", "《精神现象学》《逻辑学》", "认为凡是现实的都是合理的", "影响马克思与存在主义"],
    quotes: ["凡是合乎理性的东西都是现实的；凡是现实的东西都是合乎理性的。"],
  },
  "immanuel-kant": {
    facts: ["德国哲学家，古典哲学奠基者", "终身未离哥尼斯堡，生活极规律", "《纯粹理性批判》", "头上的星空与心中的道德律", "发动哲学哥白尼式革命"],
    quotes: ["有两样东西愈想愈敬畏：头顶的星空和心中的道德律。"],
  },
  "karl-marx": {
    facts: ["德国哲学家、经济学家，科学社会主义创始人", "《共产党宣言》《资本论》", "在英国图书馆写作数十年", "提出剩余价值与阶级斗争学说", "影响二十世纪世界历史进程"],
    quotes: ["哲学家们只是解释世界，问题在于改变世界。", "无产者在这个革命中失去的只是锁链。"],
  },
  "machiavelli": {
    facts: ["意大利政治思想家", "《君主论》", "主张政治与道德分离", "被视为政治学现实主义鼻祖", "马基雅维利主义成为权术代名词"],
    quotes: ["被人畏惧比被人爱更安全。"],
  },
  "mo-zi": {
    facts: ["墨家学派创始人", "主张兼爱、非攻、尚贤、节用", "弟子组成有纪律的墨者团体", "在先秦与儒家并称显学", "精通几何学与守城器械"],
    quotes: ["兼相爱，交相利。"],
  },
  "plato": {
    facts: ["古希腊哲学家，苏格拉底弟子", "创办雅典学园", "《理想国》", "提出理念论", "亚里士多德的老师"],
    quotes: ["智者说话，是因为他们有话要说；愚者说话，是因为他们不得不说。"],
  },
  "sigmund-freud": {
    facts: ["奥地利精神病学家，精神分析创始人", "提出潜意识、本我自我超我", "《梦的解析》", "泛性论引发巨大争议", "深刻影响现代心理学与文学"],
    quotes: ["未被表达的情绪永远不会消失。它们只是被活埋了，有朝一日会以更丑恶的方式涌现。"],
  },
  "wang-yangming": {
    facts: ["明代思想家，心学集大成者", "龙场悟道，提出知行合一", "心即理、致良知", "文人却能带兵平叛", "立德立功立言三不朽"],
    quotes: ["你未看此花时，此花与汝心同归于寂。", "知是行之始，行是知之成。"],
  },
  "zhuang-zi": {
    facts: ["战国道家代表，与老子并称老庄", "梦蝶、濠梁之辩、庖丁解牛", "《庄子》散文汪洋恣肆", "拒绝楚王相位，愿做曳尾于涂的龟", "主张齐物、逍遥"],
    quotes: ["北冥有鱼，其名为鲲。", "子非鱼，安知鱼之乐？"],
  },
  "zhu-xi": {
    facts: ["南宋理学集大成者", "世称朱子", "编《四书章句集注》", "理学成为后七百年科举官学", "主张存天理，灭人欲"],
    quotes: ["问渠那得清如许，为有源头活水来。"],
  },
  "abraham-lincoln": {
    facts: ["美国第16任总统", "出身肯塔基贫苦家庭，自学成才", "领导北方赢得南北战争", "颁布《解放黑人奴隶宣言》", "战后遇刺身亡", "葛底斯堡演说民有民治民享"],
    quotes: ["对任何人不怀恶意，对一切人宽大仁爱。"],
  },
  "alexander-great": {
    facts: ["马其顿国王，征服者", "二十岁继位，十年征服从希腊到印度", "亚里士多德的学生", "建立横跨欧亚非大帝国", "三十三岁病逝巴比伦", "传播希腊文化"],
    quotes: ["把希望留给自己，它将带给你无穷的财富。"],
  },
  "cai-yuanpei": {
    facts: ["近代教育家，北京大学校长", "主张思想自由，兼容并包", "五四时期北大灵魂人物", "曾两度留学德国", "中国近代教育制度奠基人"],
    quotes: ["囊括大典，网罗众家；思想自由，兼容并包。"],
  },
  "cao-cao": {
    facts: ["东汉末政治家、军事家、诗人", "挟天子以令诸侯，统一北方", "官渡之战以少胜多", "建安文学开创者", "生前未称帝，子曹丕建魏追尊魏武帝"],
    quotes: ["对酒当歌，人生几何。", "宁教我负天下人，休教天下人负我。"],
  },
  "charlemagne": {
    facts: ["法兰克国王，查理曼帝国皇帝", "公元800年加冕为罗马人的皇帝", "几乎统一西欧", "被称为欧洲之父", "推动加洛林文艺复兴"],
    quotes: ["会读书写字，是件值得自豪的事。"],
  },
  "chen-duxiu": {
    facts: ["新文化运动旗手，中国共产党创始人之一", "创办《新青年》", "北京大学文科学长", "五四运动精神领袖", "晚年思想回归民主主义"],
    quotes: ["德先生和赛先生（民主与科学）。"],
  },
  "franklin-roosevelt": {
    facts: ["美国第32任总统，唯一连任四届", "轮椅上的总统，患小儿麻痹", "推行新政应对大萧条", "领导美国参加二战", "炉边谈话安抚国民"],
    quotes: ["我们唯一需要恐惧的，就是恐惧本身。"],
  },
  "genghis-khan": {
    facts: ["蒙古帝国创立者，铁木真", "统一蒙古各部", "征服欧亚大陆广阔疆土", "建立横跨欧亚的大帝国", "颁布《大札撒》法典"],
    quotes: ["不要因路远而踌躇，只要走，就必到达。"],
  },
  "george-washington": {
    facts: ["美国国父，第一任总统", "领导独立战争击败英国", "主动放弃军权，拒绝称王", "连任两届后退休，确立任期传统", "托 迪塞拉弗农山庄"],
    quotes: ["政府不是理性，也不是雄辩，它是力量。"],
  },
  "guan-yu": {
    facts: ["三国蜀汉名将，字云长", "温酒斩华雄、千里走单骑、水淹七军", "后败走麦城被杀", "被后世尊为武圣、关公", "忠义化身，与孔子一文一武"],
    quotes: ["玉可碎而不可改其白，竹可焚而不可毁其节。"],
  },
  "han-wudi": {
    facts: ["西汉第七位皇帝刘彻", "罢黜百家，独尊儒术", "派卫青霍去病北击匈奴", "派张骞出使西域", "开拓疆域，汉武盛世"],
    quotes: ["寇可往，我亦可往。"],
  },
  "joan-of-arc": {
    facts: ["法国民族英雄，圣女贞德", "十六岁声称聆听到神谕", "率军解奥尔良之围", "被英军俘获，火刑处死，年仅十九", "五百年后被封圣"],
    quotes: ["要勇敢，上帝会帮助我们。"],
  },
  "julius-caesar": {
    facts: ["罗马独裁官，军事家、政治家", "高卢战记、跨过卢比孔河", "前三头同盟", "遇刺于元老院， March 15", "凯撒大帝之名成为帝王称号", "莎士比亚: Et tu, Brute?"],
    quotes: ["我来，我见，我征服。"],
  },
  "kangxi": {
    facts: ["清朝第四位皇帝，名玄烨", "八岁登基，在位六十一年", "擒鳌拜、平三藩、收台湾、征噶尔丹", "开创康乾盛世", "中国历史上在位最久的皇帝"],
    quotes: ["天下未有过不去之事，忍耐一时，便觉无事。"],
  },
  "kang-youwei": {
    facts: ["清末维新派领袖", "公车上书，戊戌变法", "主编《万国公报》", "变法失败后流亡海外十六年", "后期主张保皇立宪"],
    quotes:["变法之本，在育人才；人才之兴，在开学校。"],
  },
  "li-dazhao": {
    facts: ["中国共产党主要创始人之一", "北大图书馆主任", "最早系统传播马克思主义", "《我的马克思主义观》", "1927 被张作霖绞杀"],
    quotes: ["试看将来的环球，必是赤旗的世界。"],
  },
  "li-hongzhang": {
    facts: ["晚清重臣，洋务派代表", "组建淮军，镇压太平天国", "创办江南制造局、轮船招商局", "代表清廷签订一系列不平等条约", "自嘲为修补破屋的裱糊匠"],
    quotes: ["我办了一辈子的事，练兵也，海军也，都是纸糊的老虎。"],
  },
  "liu-bang": {
    facts: ["汉高祖，汉朝开国皇帝", "泗水亭长出身", "楚汉争霸击败项羽", "约法三章，善用人才", "白马之盟：非刘氏而王，天下共击之"],
    quotes: ["夫运筹帷幄之中，决胜千里之外，吾不如子房。"],
  },
  "napoleon": {
    facts: ["法国皇帝，军事天才", "颁布《拿破仑法典》", "奥斯特里茨战役封神", "远征俄国失败，流放大西洋圣赫勒拿", "滑铁卢一战落幕"],
    quotes: ["不想当将军的士兵不是好士兵。"],
  },
  "qianlong": {
    facts: ["清朝第四位皇帝爱新觉罗·弘历", "在位六十年，实际掌权六十三年", "十全武功", "编《四库全书》", "多次下江南，晚年吏治渐坏"],
    quotes: ["十全武功纪，一世盛世心。"],
  },
  "qin-shihuang": {
    facts: ["中国第一个皇帝，嬴政", "灭六国统一天下", "书同文、车同轨、统一度量衡", "修长城、建驰道", "焚书坑儒，功过争议两千年"],
    quotes: ["朕为始皇帝，后世以计数，二世三世至于万世。"],
  },
  "song-zu": {
    facts: ["宋太祖赵匡胤", "陈桥兵变，黄袍加身", "杯酒释兵权", "结束五代十国乱局", "重文抑武，奠定两宋三百年"],
    quotes: ["卧榻之侧，岂容他人鼾睡。"],
  },
  "sun-zhongshan": {
    facts: ["中国近代民主革命先行者", "领导辛亥革命推翻帝制", "建立中华民国，就任临时大总统", "三民主义：民族民权民生", "天下为公，革命尚未成功"],
    quotes: ["革命尚未成功，同志仍须努力。", "天下为公。"],
  },
  "tang-taizong": {
    facts: ["唐太宗李世民", "玄武门之变后登基", "贞观之治，路不拾遗夜不闭户", "兼听则明，从谏如流，重用魏征", "被尊为天可汗"],
    quotes: ["以铜为镜，可以正衣冠；以史为镜，可以知兴替。"],
  },
  "wang-zhaojun": {
    facts: ["西汉宫女王嫱", "主动请缨远嫁匈奴和亲", "巩固汉匈和平数十年", "名列中国古代四大美女", "昭君出塞成为民族友好象征"],
    quotes: ["千载琵琶作胡语，分明怨恨曲中论。"],
  },
  "winston-churchill": {
    facts: ["英国二战首相", "战时领英国抗击纳粹", "诺贝尔文学奖得主", "著名演说家", "铁幕演说开启冷战叙事"],
    quotes: ["我能奉献给你的，只有热血、辛劳、眼泪和汗水。"],
  },
  "wu-zetian": {
    facts: ["中国历史上唯一正统女皇帝", "从才人到皇后再到皇帝", "改国号为周", "重用寒门，开创殿试武举", "死后立无字碑，功过留后人评说"],
    quotes: ["文武之道，一张一弛。"],
  },
  "xiang-yu": {
    facts: ["西楚霸王", "破釜沉舟，巨鹿之战灭秦主力", "鸿门宴放走刘邦", "四面楚歌，垓下被围", "乌江自刎，不肯过江东"],
    quotes: ["力拔山兮气盖世，时不利兮骓不逝。"],
  },
  "yue-fei": {
    facts: ["南宋抗金名将，字鹏举", "率岳家军，冻死不拆屋饿死不掳掠", "郾城大捷，直指黄龙", "被秦桧以莫须有毒死风波亭", "《满江红》千古传诵"],
    quotes: ["莫等闲，白了少年头，空悲切。", "靖康耻，犹未雪；臣子恨，何时灭。"],
  },
  "zeng-guofan": {
    facts: ["晚清中兴名臣", "书生练湘军平定太平天国", "倡办洋务", "家书传后世", "以结硬寨打呆仗闻名"],
    quotes: ["天下之至拙，能胜天下之至巧。"],
  },
  "zhang-zhidong": {
    facts: ["晚清洋务派殿军", "办汉阳铁厂、湖北织布局", "创办自强学堂（武大前身）", "中学为体西学为用", "晚清四大名臣之一"],
    quotes: ["中学为体，西学为用。"],
  },
  "zheng-chenggong": {
    facts: ["明末清初民族英雄", "父郑芝龙降清，他坚拒", "收复台湾，驱逐荷兰东印度公司", "被赐国姓朱，人称国姓爷", "英年早逝，后代治理台湾"],
    quotes: ["台湾者，中国之土地也，久为贵国所踞。"],
  },
  "zhu-yuanzhang": {
    facts: ["明太祖，明朝开国皇帝", "出身赤贫，放牛、做过和尚乞丐", "参加红巾军，驱逐蒙元", "定都南京，年号洪武", "严惩贪吏，与民休息"],
    quotes: ["百姓足，君孰与不足；百姓不足，君孰与足。"],
  },
  "zuo-zongtang": {
    facts: ["晚清中兴名臣", "举人出身却担大任", "办福州船政局", "抬棺西征收复新疆", "保住占中国六分之一的国土"],
    quotes: ["重新疆者，所以保蒙古；保蒙古者，所以卫京师。"],
  },
};

// —— 生成离线脑 ——
const brainsDir = resolve(root, "apps/api/data/offline-brains");
const existing = new Set(readdirSync(brainsDir).filter((f) => f.endsWith(".json") && f !== "index.json"));
let created = 0;
const index = {};

function buildQa(c, seed) {
  const facts = seed.facts;
  const quotes = seed.quotes;
  const p = c.persona.replace(/你是/g, "我是").slice(0, 80);
  return [
    { q: "介绍一下你自己", a: `${p}。${facts[0]}。` },
    { q: "你有什么成就", a: `主要成就：${facts.slice(0, 3).join("；")}。` },
    { q: "你最有名的一句话", a: `${quotes[0] ?? ""}。${quotes[1] ? quotes[1] + "。" : ""}` },
    { q: "你是哪个时代哪国人", a: `我生活在${c.era}。${facts[0]}。` },
    { q: "你最重要的作品", a: `${facts[1] ?? facts[0]}。${facts[2] ?? ""}` },
    { q: "你觉得做事最关键的是什么", a: `${facts[3] ?? facts[0]}。${quotes[0] ?? ""}` },
    { q: "别人怎么评价你", a: `${facts[2]}。${facts[3] ?? ""}` },
    { q: "聊聊你的故事", a: `${facts[3]}。${facts[4] ?? facts[2]}` },
    { q: "对年轻人有什么忠告", a: `${quotes[0] ?? facts[1]}。愿你以此自勉。` },
    { q: "你和谁是同一时代的人", a: `我与${c.era}前后的人物同时代。${facts[0]}。` },
  ];
}

for (const [id, seed] of Object.entries(SEEDS)) {
  const c = celebs[id];
  if (!c) { console.warn("skip unknown celeb:", id); continue; }
  if (existing.has(`${id}.json`)) continue; // 不覆盖已有 20 个手写脑
  const brain = {
    id,
    name: c.name,
    persona: c.persona.slice(0, 120),
    keyFacts: seed.facts,
    quotes: seed.quotes,
    qa: buildQa(c, seed),
  };
  writeFileSync(resolve(brainsDir, `${id}.json`), JSON.stringify(brain, null, 2) + "\n");
  index[id] = { file: `${id}.json`, entries: brain.qa.length, facts: seed.facts.length };
  created++;
}

// —— 合并 index.json：把已有 20 个手写脑也收录 ——
for (const f of existing) {
  const id = f.replace(/\.json$/, "");
  if (index[id]) continue;
  try {
    const b = JSON.parse(readFileSync(resolve(brainsDir, f), "utf8"));
    index[id] = { file: f, entries: Array.isArray(b.qa) ? b.qa.length : 0, facts: Array.isArray(b.keyFacts) ? b.keyFacts.length : 0 };
  } catch {}
}
writeFileSync(resolve(brainsDir, "index.json"), JSON.stringify({ characters: index }, null, 2) + "\n");
console.log(`created ${created} new offline brains; index covers ${Object.keys(index).length} total.`);
