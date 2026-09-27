// ============================================================================
// R5 · 名人法庭招牌模式 —— 戏剧化案件库（确定性数据，不调 LLM）
//
// 每个案件是一场「世纪名场面」：两位历史名人对簿公堂，玩家担任一方律师，
// 用出牌 + 结案陈词说服陪审团。案件数据全部手写，保证可复算、可测试。
//
// 名人 id 优先取 CELEBRITIES 中已有条目；个别未收录的（莱布尼茨 / 毕加索 /
// 达利 / 雅典城邦 / 传统礼法）使用稳定的合成 id，关系系统照样落盘。
// ============================================================================

export interface CelebrityCourtCaseParty {
  id: string;
  name: string;
  role: string;
}

export interface SignatureEvidenceItem {
  id: string;
  text: string;
  side: "plaintiff" | "defendant";
  /** 证据份量 1-10，影响出牌命中后的天平摆动（展示用，实际结算走 court-state）。 */
  power: number;
}

export interface CelebrityCourtCase {
  id: string;
  /** 戏剧化标题，如"世纪知识产权之争：牛顿 vs 莱布尼茨"。 */
  title: string;
  /** 名人被告。 */
  celebrityDefendant: CelebrityCourtCaseParty;
  /** 名人原告。 */
  celebrityPlaintiff: CelebrityCourtCaseParty;
  /** 案件主题（一句话）。 */
  theme: string;
  /** 3-5 条戏剧化事实。 */
  facts: string[];
  /** 3 个争议焦点（出牌命中目标）。 */
  disputePoints: string[];
  evidence: SignatureEvidenceItem[];
  /** 3-5 个预设名场面描述（命中关键证据 / 翻盘 / 陪审团倒戈时逐条放送）。 */
  dramaticMoments: string[];
  /** 陪审团初始倾向 -50~50（正=偏原告）。 */
  juryBias: number;
}

// ----------------------------------------------------------------------------
// 案件 1：微积分发明权
// ----------------------------------------------------------------------------
const NEWTON_LEIBNIZ: CelebrityCourtCase = {
  id: "newton-vs-leibniz",
  title: "世纪知识产权之争：牛顿 vs 莱布尼茨",
  celebrityPlaintiff: {
    id: "gottfried-leibniz",
    name: "莱布尼茨",
    role: "原告 · 微积分独立发明人",
  },
  celebrityDefendant: {
    id: "isaac-newton",
    name: "牛顿",
    role: "被告 · 流数术之父",
  },
  theme: "谁才是微积分真正的父亲？一场横跨海峡的发明权世纪诉讼。",
  facts: [
    "1665 年牛顿因瘟疫躲在乡下，独自写下「流数术」手稿，但锁进抽屉二十年未发表。",
    "1675 年莱布尼茨在伦敦出访后独立发明了微分符号 dx/dy，并率先公开发表。",
    "1712 年皇家学会成立调查委员会，而学会会长正是牛顿本人。",
    "后世数学界公认：两人各自独立发明，符号系统主要归功于莱布尼茨。",
  ],
  disputePoints: [
    "微积分发明优先权",
    "微分符号之争",
    "皇家学会调查公正性",
  ],
  evidence: [
    { id: "nl-p1", side: "plaintiff", power: 9, text: "1684 年莱布尼茨率先发表微分符号论文" },
    { id: "nl-p2", side: "plaintiff", power: 7, text: "牛顿手稿迟至 1704 年才公开" },
    { id: "nl-d1", side: "defendant", power: 9, text: "牛顿 1665 年流数术手稿早于莱布尼茨十年" },
    { id: "nl-d2", side: "defendant", power: 6, text: "莱布尼茨曾浏览过牛顿早期数学手稿" },
    { id: "nl-p3", side: "plaintiff", power: 8, text: "皇家学会会长牛顿亲自撰写调查报告" },
  ],
  dramaticMoments: [
    "牛顿猛拍桌子：「站在巨人肩膀上？我就是那个巨人！」",
    "莱布尼茨掏出泛黄手稿，陪审团倒吸一口凉气。",
    "法官宣读：皇家学会调查报告因利益冲突，不予采信——全场哗然。",
  ],
  juryBias: -10,
};

// ----------------------------------------------------------------------------
// 案件 2：产品理念之争
// ----------------------------------------------------------------------------
const MUSK_JOBS: CelebrityCourtCase = {
  id: "musk-vs-jobs",
  title: "产品理念之战：马斯克 vs 乔布斯",
  celebrityPlaintiff: {
    id: "elon-musk",
    name: "马斯克",
    role: "原告 · 第一性原理派",
  },
  celebrityDefendant: {
    id: "steve-jobs",
    name: "乔布斯",
    role: "被告 · 人文极简派",
  },
  theme: "产品到底该回到物理本质，还是听从直觉与人文品味？",
  facts: [
    "马斯克用第一性原理把电池成本拆到原材料级别，造了特斯拉与 SpaceX。",
    "乔布斯坚持「少即是多」，砍掉一切多余接口，连说明书都不屑写。",
    "两人都以现实扭曲力场闻名，都曾被自己创立的公司扫地出门。",
    "一个追问「这在物理上为什么不能」，一个追问「用户真正想要什么」。",
  ],
  disputePoints: [
    "第一性原理是否优于产品直觉",
    "接口极简与功能开放之争",
    "现实扭曲力场是否正当",
  ],
  evidence: [
    { id: "mj-p1", side: "plaintiff", power: 8, text: "电池原材料成本仅占售价一成，第一性原理可证" },
    { id: "mj-p2", side: "plaintiff", power: 6, text: "火箭回收把发射成本砍到十分之一" },
    { id: "mj-d1", side: "defendant", power: 9, text: "砍掉光驱与软盘，mac 反而卖到脱销" },
    { id: "mj-d2", side: "defendant", power: 7, text: "用户不知道自己想要什么，直到你给他们看" },
    { id: "mj-p3", side: "plaintiff", power: 6, text: "现实扭曲力场本质是对他人认知的操控" },
  ],
  dramaticMoments: [
    "马斯克当场掏出一块电池：「告诉我，这玩意儿凭什么卖这么贵？」",
    "乔布斯缓缓放下手机：「过度堆参数，是工程师的懒惰。」",
    "陪审团成员为「到底该不该砍耳机孔」吵成一团。",
  ],
  juryBias: 5,
};

// ----------------------------------------------------------------------------
// 案件 3：思想自由
// ----------------------------------------------------------------------------
const SOCRATES_ATHENS: CelebrityCourtCase = {
  id: "socrates-vs-athens",
  title: "思想自由审判：苏格拉底 vs 雅典城邦",
  celebrityPlaintiff: {
    id: "socrates",
    name: "苏格拉底",
    role: "原告 · 被判处饮鸩的哲人",
  },
  celebrityDefendant: {
    id: "athens-polis",
    name: "雅典城邦",
    role: "被告 · 公诉方与陪审团",
  },
  theme: "一个用追问惹毛全城的人，到底是在腐蚀青年，还是在唤醒他们？",
  facts: [
    "苏格拉底在市集到处追问，让一位位「聪明人」当众露出无知。",
    "城邦指控他不敬神、腐蚀青年，陪审团以微弱多数判处他死刑。",
    "他本可以越狱逃走，却选择服从法律、饮下鸩酒。",
    "他说：未经审视的人生不值得过。",
  ],
  disputePoints: [
    "追问是否构成腐蚀青年",
    "言论自由与城邦信仰之边界",
    "公民是否有权服从不义之法",
  ],
  evidence: [
    { id: "sa-p1", side: "plaintiff", power: 9, text: "苏格拉底从未收钱授课，只追问真相" },
    { id: "sa-p2", side: "plaintiff", power: 8, text: "阿尔西比亚德之乱与苏格拉底并无师生罪责" },
    { id: "sa-d1", side: "defendant", power: 7, text: "他当众质疑城邦诸神，青年纷纷模仿" },
    { id: "sa-d2", side: "defendant", power: 6, text: "三十僭主时期他拒绝配合也未及时发声" },
    { id: "sa-p3", side: "plaintiff", power: 9, text: "他选择饮鸩，恰恰证明他尊重城邦法律" },
  ],
  dramaticMoments: [
    "苏格拉底转身对陪审团说：「现在我们各走各的路——我去死，你们去活。」",
    "一位陪审员当庭落泪，请求重审。",
    "法庭陷入死寂，只听见鸩酒杯轻放桌面的声音。",
  ],
  juryBias: -15,
};

// ----------------------------------------------------------------------------
// 案件 4：电流之战
// ----------------------------------------------------------------------------
const TESLA_EDISON: CelebrityCourtCase = {
  id: "tesla-vs-edison",
  title: "电流之战：特斯拉 vs 爱迪生",
  celebrityPlaintiff: {
    id: "nikola-tesla",
    name: "特斯拉",
    role: "原告 · 交流电捍卫者",
  },
  celebrityDefendant: {
    id: "thomas-edison",
    name: "爱迪生",
    role: "被告 · 直流电流派",
  },
  theme: "为了让人类用上电，两位天才把电流战打成了公开处刑秀。",
  facts: [
    "爱迪生力推直流电，输电距离只能覆盖一英里。",
    "特斯拉发明交流电，可以跨城输电，却被爱迪生拒绝兑现承诺的五万美元。",
    "爱迪生团队公开电死大象，向公众渲染交流电「致命」。",
    "最终交流电赢得了尼加拉瀑布供电权，改写了人类用电史。",
  ],
  disputePoints: [
    "交流电是否比直流电更安全",
    "跨城市输电的可行性",
    "公开电刑宣传是否构成恶意竞争",
  ],
  evidence: [
    { id: "te-p1", side: "plaintiff", power: 9, text: "交流电可升压跨城输电，直流不行" },
    { id: "te-p2", side: "plaintiff", power: 8, text: "沃登克里弗塔与多相感应电机专利" },
    { id: "te-d1", side: "defendant", power: 7, text: "高压交流电曾电死围观路人" },
    { id: "te-d2", side: "defendant", power: 6, text: "直流电配电简单，家用更可靠" },
    { id: "te-p3", side: "plaintiff", power: 9, text: "对手团队公开电死大象宣传致命" },
  ],
  dramaticMoments: [
    "特斯拉单手接通交流电灯泡，灯在他掌心亮起而毫发无伤。",
    "爱迪生证人席上被问到「五万美元承诺」时沉默了十秒。",
    "陪审团得知大象事件后，当庭倒向原告。",
  ],
  juryBias: 10,
};

// ----------------------------------------------------------------------------
// 案件 5：女性权力
// ----------------------------------------------------------------------------
const WU_ZETIAN: CelebrityCourtCase = {
  id: "wu-zetian-vs-rites",
  title: "女性权力之辩：武则天 vs 传统礼法",
  celebrityPlaintiff: {
    id: "wu-zetian",
    name: "武则天",
    role: "原告 · 中国唯一女皇帝",
  },
  celebrityDefendant: {
    id: "neo-confucian",
    name: "传统礼法",
    role: "被告 · 男权卫道者",
  },
  theme: "女子为何不能称帝？一座无字碑，把身后评价留给了历史。",
  facts: [
    "武则天从才人起步，改唐为周，成为中国唯一正统女皇帝。",
    "她大开科举、破格用人，让寒门子弟第一次能与门阀平起平坐。",
    "礼法卫道者痛斥她「牝鸡司晨」，史官笔下多有贬抑。",
    "她死后立无字碑，功过任由后人评说。",
  ],
  disputePoints: [
    "女子称帝是否违背天命礼制",
    "破格用人是否扰乱朝纲",
    "酷吏政治是否为统治必需",
  ],
  evidence: [
    { id: "wz-p1", side: "plaintiff", power: 9, text: "大开科举使寒门人才入仕" },
    { id: "wz-p2", side: "plaintiff", power: 7, text: "上承贞观之治，下启开元盛世" },
    { id: "wz-d1", side: "defendant", power: 8, text: "重用酷吏，大兴告密之风" },
    { id: "wz-d2", side: "defendant", power: 7, text: "改唐为周，移国易祚，违反嫡庶礼制" },
    { id: "wz-p3", side: "plaintiff", power: 8, text: "无字碑即不言之判，功过自见" },
  ],
  dramaticMoments: [
    "武则天摘下帝冕掷于案上：「你们守了千年的礼，可曾让天下多一户吃饱饭？」",
    "一位寒门出身的证人当庭宣读自己因科举入仕的文书。",
    "法官望向那座无字碑，久久不能落槌。",
  ],
  juryBias: -20,
};

// ----------------------------------------------------------------------------
// 案件 6：艺术风格之争
// ----------------------------------------------------------------------------
const PICASSO_DALI: CelebrityCourtCase = {
  id: "picasso-vs-dali",
  title: "艺术风格之争：毕加索 vs 达利",
  celebrityPlaintiff: {
    id: "pablo-picasso",
    name: "毕加索",
    role: "原告 · 立体主义开创者",
  },
  celebrityDefendant: {
    id: "salvador-dali",
    name: "达利",
    role: "被告 · 超现实主义怪杰",
  },
  theme: "把画拆成几何切面，和把熔化的钟表挂上树——谁才配叫现代艺术？",
  facts: [
    "毕加索《亚维农少女》把人体拆解成棱角分明的几何块，震惊画坛。",
    "达利用偏执狂方法画出融化的时钟，自称「超现实主义」。",
    "两人亦师亦友，又一辈子互相调侃。",
    "一个说艺术就是打破传统，一个说艺术就是让人做白日梦。",
  ],
  disputePoints: [
    "立体主义是否还是绘画",
    "超现实梦境能否算艺术",
    "怪诞风格与哗众取宠之界",
  ],
  evidence: [
    { id: "pd-p1", side: "plaintiff", power: 8, text: "亚维农少女开启了现代主义绘画" },
    { id: "pd-p2", side: "plaintiff", power: 6, text: "几何拆解是对体积与空间的重新研究" },
    { id: "pd-d1", side: "defendant", power: 8, text: "记忆的永恒融化时钟直达潜意识" },
    { id: "pd-d2", side: "defendant", power: 6, text: "立体主义把人画成碎玻璃，大众看不懂" },
    { id: "pd-p3", side: "plaintiff", power: 6, text: "达利的小胡子与表演，更像营销而非艺术" },
  ],
  dramaticMoments: [
    "达利捻着小胡子走上证人席：「我不必懂我自己，我只需要画出来。」",
    "毕加索当场几笔速写，把陪审团画成了一堆几何切面，哄堂大笑。",
    "两幅代表作同时挂上法庭投影，陪审团投票一度胶着。",
  ],
  juryBias: 0,
};

export const CELEBRITY_COURT_CASES: CelebrityCourtCase[] = [
  NEWTON_LEIBNIZ,
  MUSK_JOBS,
  SOCRATES_ATHENS,
  TESLA_EDISON,
  WU_ZETIAN,
  PICASSO_DALI,
];

/** 按 id 取案件；找不到回退 null。 */
export function getSignatureCase(caseId: string): CelebrityCourtCase | null {
  return CELEBRITY_COURT_CASES.find((c) => c.id === caseId) ?? null;
}

/** 随机取一个案件（确定性种子可注入，便于测试）。 */
export function randomSignatureCase(rng: () => number = Math.random): CelebrityCourtCase {
  const idx = Math.floor(rng() * CELEBRITY_COURT_CASES.length);
  return CELEBRITY_COURT_CASES[Math.min(idx, CELEBRITY_COURT_CASES.length - 1)];
}
