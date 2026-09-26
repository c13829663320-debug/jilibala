import { Eye, Heart, MessageCircle, ThumbsDown } from "lucide-react";
import type { PlazaContent } from "@balabala/shared";

export const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
};

const TYPE_LABEL: Record<PlazaContent["type"], string> = {
  text: "📝 文字观点",
  closed_court: "⚖️ 已结案法庭",
  talkshow_clip: "🎤 脱口秀片段",
  bar_quote: "🍺 酒吧金句",
  library_note: "📚 读书笔记",
  werewolf_report: "🐺 狼人杀战报",
  gym_checkin: "🏋️ 健身打卡",
  custom_character: "🎭 自定义人物",
  court_verdict: "⚖️ 法庭判决",
};

export function ContentCard({ content, onOpen }: { content: PlazaContent; onOpen: (id: string) => void }) {
  const summary = (() => {
    if (content.type === "closed_court" && content.court) return `最终判决：${content.court.verdict}`;
    if (content.type === "talkshow_clip" && content.talkshow) return `${content.talkshow.performer} · 观众评分 ${content.talkshow.audienceScore}：${content.talkshow.text}`;
    if (content.type === "bar_quote" && content.bar) return `${content.bar.speaker}："${content.bar.quote}"`;
    if (content.type === "library_note" && content.library) return content.library.answer;
    if (content.type === "werewolf_report" && content.werewolf) return `${content.werewolf.winner === 'wolf' ? '🐺狼人胜利' : '☀️好人胜利'} · ${content.werewolf.totalDays}天 · ${content.werewolf.summary}`;
    if (content.type === "gym_checkin" && content.gym) {
      const g = content.gym;
      const parts = [
        g.exerciseName ? `完成「${g.exerciseName}」` : '完成训练',
        g.setsCompleted > 0 ? `${g.setsCompleted} 组` : '',
        g.repsCompleted > 0 ? `${g.repsCompleted} 次` : '',
        g.durationSeconds > 0 ? `${Math.round(g.durationSeconds / 60 * 10) / 10} 分钟` : '',
        g.streakDays > 0 ? `🔥 连续 ${g.streakDays} 天` : '',
      ].filter(Boolean);
      const quote = g.quote ? ` 金句："${g.quote}"` : '';
      return parts.join(' · ') + quote;
    }
    if (content.type === "custom_character" && content.customCharacter) {
      const cc = content.customCharacter;
      return `${cc.title || '自定义人物'}：${cc.intro}`;
    }
    return content.body ?? "";
  })();
  return (
    <article className="plaza-card" onClick={() => onOpen(content.id)} role="button" tabIndex={0}
      onKeyDown={(event) => { if (event.key === "Enter") onOpen(content.id); }}>
      <header className="plaza-card__head">
        <span className="plaza-card__type">{TYPE_LABEL[content.type]}</span>
        <span className="plaza-card__author">{content.author}</span>
      </header>
      <h3 className="plaza-card__title">{content.title}</h3>
      {content.type === "custom_character" && content.customCharacter && (
        <div className="plaza-card__character">
          {content.customCharacter.portrait ? (
            <img
              src={content.customCharacter.portrait}
              alt={content.customCharacter.name}
              loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <span className="plaza-card__character-fallback">{content.customCharacter.name[0]}</span>
          )}
          <div>
            <b>{content.customCharacter.name}</b>
            <small>{content.customCharacter.title}</small>
          </div>
        </div>
      )}
      <p className="plaza-card__summary">{summary}</p>
      {content.topics.length > 0 && (
        <div className="plaza-card__topics">{content.topics.map((topic) => <i key={topic}>#{topic}</i>)}</div>
      )}
      <footer className="plaza-card__foot">
        <span><Eye size={13} /> {content.views}</span>
        <span className="is-like"><Heart size={13} /> {content.likes}</span>
        <span className="is-dislike"><ThumbsDown size={13} /> {content.dislikes}</span>
        <span><MessageCircle size={13} /> {content.comments.length}</span>
        {content.type === "closed_court" && content.court && (
          <span className="plaza-card__participants">👥 {content.court.participants} 人参与</span>
        )}
        <small className="plaza-card__time">{timeAgo(content.createdAt)}</small>
      </footer>
    </article>
  );
}
