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
};

export function ContentCard({ content, onOpen }: { content: PlazaContent; onOpen: (id: string) => void }) {
  const summary = content.type === "closed_court" && content.court
    ? `最终判决：${content.court.verdict}`
    : content.body ?? "";
  return (
    <article className="plaza-card" onClick={() => onOpen(content.id)} role="button" tabIndex={0}
      onKeyDown={(event) => { if (event.key === "Enter") onOpen(content.id); }}>
      <header className="plaza-card__head">
        <span className="plaza-card__type">{TYPE_LABEL[content.type]}</span>
        <span className="plaza-card__author">{content.author}</span>
      </header>
      <h3 className="plaza-card__title">{content.title}</h3>
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
