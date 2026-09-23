// ===== M7: content-storage.ts 改为 SQLite DAO 委托层，保持原有导出签名不变 =====
import path from "node:path";
import type { PlazaContent } from "@balabala/shared";
import * as db from "./db.js";
import type { StoredContent } from "./db.js";

export function getContentsFile(): string {
  return process.env.BALABALA_CONTENTS_FILE ?? path.join(process.cwd(), ".data", "contents.json");
}

/** 从 SQLite 读取全部内容。 */
export async function loadContents(): Promise<StoredContent[]> {
  db.initDb();
  return db.getAllContents();
}

/**
 * 全量覆盖：清空 contents/comments/reactions 表后批量插入。
 * 保持与原 JSON 文件 saveContents 相同的语义。
 */
export function saveContents(contents: StoredContent[]): Promise<void> {
  return Promise.resolve().then(() => {
    db.initDb();
    db.clearContents();
    for (const c of contents) {
      db.upsertContent(c);
      for (const cm of c.comments ?? []) {
        db.addComment(c.id, cm);
      }
    }
  });
}

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3600 * 1000).toISOString();
let commentSeq = 0;
const comment = (author: string, text: string, hours: number) => ({
  id: `seed-comment-${++commentSeq}`,
  author,
  text,
  createdAt: hoursAgo(hours),
});

/** 首次启动（内容表为空）时填充的演示内容。 */
export function makeSeedContents(): PlazaContent[] {
  return [
    {
      id: "seed-text-1",
      type: "text",
      scene: "court",
      author: "小明",
      createdAt: hoursAgo(26),
      topics: ["AI", "设计", "职场"],
      title: "AI 最终会取代设计师吗？",
      body: "我认为 AI 不会完全取代设计师，但会淘汰大量只负责执行的人。真正的审美、对人的理解，以及跨领域的创意，仍然是设计师的核心价值。未来的设计师更像导演，AI 是一个随叫随到的执行团队。",
      likes: 48,
      dislikes: 7,
      views: 612,
      comments: [
        comment("阿茶", "同意，工具越强，会提问、会判断的人越值钱。", 24),
        comment("DesignDog", "但初级设计师真的没机会练手了，这才是问题。", 20),
      ],
    },
    {
      id: "seed-text-2",
      type: "text",
      scene: "all",
      author: "小满",
      createdAt: hoursAgo(5),
      topics: ["恋爱", "信任"],
      title: "恋爱里该不该看对方手机？",
      body: "不是不能看，而是要不要用“看”来换取安全感。真正的信任是对方愿意给你看，而你选择不看。一旦开始偷偷查，关系里的裂痕其实已经出现了。",
      likes: 31,
      dislikes: 12,
      views: 286,
      comments: [
        comment("路人甲", "说得好，安全感是自己给的，不是查出来的。", 3),
        comment("Lemon", "话虽如此，真被背叛过一次就很难这么坦然了。", 2),
      ],
    },
    {
      id: "seed-text-3",
      type: "text",
      scene: "all",
      author: "校园观察员",
      createdAt: hoursAgo(50),
      topics: ["大学生", "恋爱"],
      title: "大学生一定要谈恋爱吗？",
      body: "大学最珍贵的是试错的自由，但恋爱从来不是必修课。为了谈恋爱而谈恋爱，往往既消耗自己也耽误别人。先把自己活明白，遇到对的人是锦上添花，遇不到也不亏。",
      likes: 22,
      dislikes: 4,
      views: 198,
      comments: [comment("毕业三年的人", "毕业回看，绩点和实习比恋爱保值多了。", 40)],
    },
    {
      id: "seed-text-4",
      type: "text",
      scene: "all",
      author: "打工人阿强",
      createdAt: hoursAgo(2),
      topics: ["职场"],
      title: "职场上被甩锅，要不要当场怼回去？",
      body: "当场发飙大概率被当成情绪化，默默吞下又会有下一次。我的做法是：不在情绪上对抗，但在事实和记录上寸步不让，把责任边界用邮件和群消息留痕，让锅落不到自己头上。",
      likes: 15,
      dislikes: 1,
      views: 96,
      comments: [],
    },
    {
      id: "seed-court-1",
      type: "closed_court",
      scene: "court",
      author: "小明",
      createdAt: hoursAgo(30),
      topics: ["AI", "艺术"],
      title: "AI 生成的艺术算艺术吗？",
      caseId: "seed-case-1",
      likes: 63,
      dislikes: 18,
      views: 845,
      court: {
        caseNo: "（2026）叽初字第 0007 号",
        title: "AI 生成的艺术算艺术吗？",
        plaintiffClaim: "AI 艺术属于艺术。工具的进化不改变创作的本质，人通过 AI 表达审美与观念，作品同样能打动人、引发思考。",
        defendantClaim: "AI 只是工具，不属于真正的创作。真正的艺术源于人的生命体验与技艺磨练，AI 生成的只是对既有作品的概率拼接。",
        evidence: "双方分别提交了 AI 生成作品获奖案例、创作者工作流记录，以及 AI 训练数据来源说明。",
        verdict: "AI 辅助完成的作品可以成为艺术，但创作主体始终是人；应当标注 AI 的参与程度，并尊重训练数据的来源。",
        judgeNote: "技术改变的是表达的媒介，而不是表达的渴望。",
        participants: 36,
        closedAt: hoursAgo(30),
      },
      comments: [
        comment("阿茶", "判决很中肯，关键还是人在表达。", 29),
        comment("Leo", "训练数据的版权问题其实还没完全解决吧。", 28),
        comment("小满", "我用 AI 画过，没有想法它什么都不是。", 26),
        comment("路人甲", "36 人同庭，也太热闹了。", 25),
      ],
    },
    {
      id: "seed-court-2",
      type: "closed_court",
      scene: "court",
      author: "热心市民",
      createdAt: hoursAgo(72),
      topics: ["职场", "生活"],
      title: "外卖迟到该不该给差评？",
      caseId: "seed-case-2",
      likes: 27,
      dislikes: 9,
      views: 354,
      court: {
        caseNo: "（2026）叽初字第 0005 号",
        title: "外卖迟到该不该给差评？",
        plaintiffClaim: "迟到影响了用餐体验，如实评价是消费者的权利，也能督促平台改进时效。",
        defendantClaim: "骑手风里来雨里去，迟到常因天气和堵车，一个差评可能扣掉半天收入，应多些体谅。",
        evidence: "订单轨迹显示迟到 22 分钟，当时为暴雨天气；平台差评扣款规则一并在庭上展示。",
        verdict: "非骑手主观原因导致的轻微迟到，不建议直接差评；可先沟通，平台也应为恶劣天气预留弹性。",
        judgeNote: "规则之上，还有人与人之间的温度。",
        participants: 18,
        closedAt: hoursAgo(72),
      },
      comments: [comment("Lemon", "暴雨天真的不容易，互相理解吧。", 60)],
    },
  ];
}

// 注册种子数据回调，db.ts 首次初始化时自动写入空表
db.registerSeedContents(makeSeedContents);
