import { useEffect, useState } from "react";
import { ArrowLeft, Eye, Heart, MessageCircle, Send, ThumbsDown, Users } from "lucide-react";
import { SCENE_META, type PlazaContent } from "@balabala/shared";
import { timeAgo } from "./ContentCard";

const TYPE_LABEL: Record<PlazaContent["type"], string> = {
  text: "📝 文字观点",
  closed_court: "⚖️ 已结案法庭",
  talkshow_clip: "🎤 脱口秀片段",
  bar_quote: "🍺 酒吧金句",
  library_note: "📚 读书笔记",
  werewolf_report: "🐺 狼人杀战报",
  gym_checkin: "🏋️ 健身打卡",
  custom_character: "🧑 自定义人物",
};

export function ContentDetail({ id, author, onBack, onChanged }: {
  id: string;
  author?: string;
  onBack: () => void;
  onChanged?: () => void;
}) {
  const [content, setContent] = useState<PlazaContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reacted, setReacted] = useState<"like" | "dislike" | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/contents/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("内容不存在或已被删除");
        const data = (await res.json()) as { content: PlazaContent };
        setContent(data.content);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const react = async (reaction: "like" | "dislike") => {
    if (!content || reacted) return;
    setReacted(reaction);
    const field = reaction === "like" ? "likes" : "dislikes";
    setContent({ ...content, [field]: content[field] + 1 });
    try {
      const res = await fetch(`/api/contents/${id}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction }),
      });
      const data = (await res.json()) as { likes?: number; dislikes?: number };
      setContent((current) => (current ? { ...current, likes: data.likes ?? current.likes, dislikes: data.dislikes ?? current.dislikes } : current));
      onChanged?.();
    } catch {
      setReacted(null);
    }
  };

  const submitComment = async () => {
    const text = commentText.trim();
    if (!text || submitting || !content) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/contents/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, author: author || "我" }),
      });
      const data = (await res.json()) as { comment: PlazaContent["comments"][number] };
      setContent({ ...content, comments: [...content.comments, data.comment] });
      setCommentText("");
      onChanged?.();
    } finally {
      setSubmitting(false);
    }
  };

  const sceneLabel = SCENE_META.find((item) => item.id === content?.scene)?.label ?? "";

  return (
    <div className="plaza-overlay" role="dialog" aria-modal="true">
      <div className="plaza-detail">
        <button type="button" className="plaza-detail__back" onClick={onBack}>
          <ArrowLeft size={15} /> 返回广场
        </button>

        {loading ? (
          <p className="plaza-status">正在加载…</p>
        ) : error ? (
          <p className="plaza-status">{error}</p>
        ) : content ? (
          <>
            <header className="plaza-detail__head">
              <span className="plaza-card__type">{TYPE_LABEL[content.type]}</span>
              <h1>{content.title}</h1>
              <p className="plaza-detail__meta">
                {content.author} · {timeAgo(content.createdAt)} · {sceneLabel}
              </p>
              {content.topics.length > 0 && (
                <div className="plaza-card__topics">{content.topics.map((topic) => <i key={topic}>#{topic}</i>)}</div>
              )}
            </header>

            {content.type === "text" ? (
              <p className="plaza-detail__body">{content.body}</p>
            ) : content.type === "closed_court" && content.court ? (
              <section className="plaza-court">
                <div className="plaza-court__row"><span>案号</span><p>{content.court.caseNo}</p></div>
                <div className="plaza-court__row"><span>正方观点</span><p>{content.court.plaintiffClaim}</p></div>
                <div className="plaza-court__row"><span>反方观点</span><p>{content.court.defendantClaim}</p></div>
                <div className="plaza-court__row"><span>主要证据</span><p>{content.court.evidence}</p></div>
                <div className="plaza-court__row is-verdict"><span>最终判决</span><p>{content.court.verdict}</p></div>
                <div className="plaza-court__row"><span>法官寄语</span><p>{content.court.judgeNote}</p></div>
                <p className="plaza-court__stats">
                  <Users size={14} /> {content.court.participants} 人参与 · 结案于 {timeAgo(content.court.closedAt)}
                </p>
              </section>
            ) : content.type === "talkshow_clip" && content.talkshow ? (
              <section className="plaza-court">
                <div className="plaza-court__row"><span>表演者</span><p>{content.talkshow.performer}</p></div>
                <div className="plaza-court__row"><span>观众评分</span><p>{content.talkshow.audienceScore} / 100</p></div>
                <div className="plaza-court__row"><span>观众反应</span><p>{content.talkshow.reactions.join(" · ")}</p></div>
                {content.talkshow.celebrityGuest && <div className="plaza-court__row"><span>客串名人</span><p>{content.talkshow.celebrityGuest}</p></div>}
                <div className="plaza-court__row is-verdict"><span>表演内容</span><p>{content.talkshow.text}</p></div>
              </section>
            ) : content.type === "bar_quote" && content.bar ? (
              <section className="plaza-court">
                <div className="plaza-court__row"><span>辩题</span><p>{content.bar.topic}</p></div>
                <div className="plaza-court__row"><span>发言者</span><p>{content.bar.speaker}（{content.bar.side === "pro" ? "正方" : content.bar.side === "con" ? "反方" : "酒保"}）</p></div>
                {content.bar.consensus && <div className="plaza-court__row"><span>双方共识</span><p>{content.bar.consensus}</p></div>}
                <div className="plaza-court__row is-verdict"><span>金句</span><p>"{content.bar.quote}"</p></div>
              </section>
            ) : content.type === "library_note" && content.library ? (
              <section className="plaza-court">
                {content.library.celebrityName && <div className="plaza-court__row"><span>名人</span><p>{content.library.celebrityName}</p></div>}
                {content.library.book && <div className="plaza-court__row"><span>著作</span><p>{content.library.book}</p></div>}
                {content.library.question && <div className="plaza-court__row"><span>问题</span><p>{content.library.question}</p></div>}
                <div className="plaza-court__row is-verdict"><span>笔记/回答</span><p>{content.library.answer}</p></div>
              </section>
            ) : null}

            <div className="plaza-detail__actions">
              <button type="button" className={reacted === "like" ? "is-active" : ""} onClick={() => react("like")}>
                <Heart size={15} /> 赞同 {content.likes}
              </button>
              <button type="button" className={reacted === "dislike" ? "is-active" : ""} onClick={() => react("dislike")}>
                <ThumbsDown size={15} /> 反对 {content.dislikes}
              </button>
              <span className="plaza-detail__views"><Eye size={14} /> {content.views} 浏览</span>
            </div>

            <section className="plaza-comments">
              <h2><MessageCircle size={15} /> 评论 · {content.comments.length}</h2>
              {content.comments.length === 0 && <p className="plaza-comments__empty">还没有评论，来说说你的看法。</p>}
              {content.comments.map((item) => (
                <div className="plaza-comment" key={item.id}>
                  <span className="plaza-comment__author">{item.author}</span>
                  <p>{item.text}</p>
                  <small>{timeAgo(item.createdAt)}</small>
                </div>
              ))}
              <div className="plaza-comments__composer">
                <input value={commentText} onChange={(event) => setCommentText(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") void submitComment(); }}
                  placeholder="写下你的评论…" aria-label="评论内容" />
                <button type="button" onClick={() => void submitComment()} disabled={submitting || !commentText.trim()}>
                  <Send size={14} />
                </button>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
