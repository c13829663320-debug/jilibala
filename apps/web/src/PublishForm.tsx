import { useState } from "react";
import { ArrowLeft, Lock, Send } from "lucide-react";
import { SCENE_META, type PlazaContent, type SceneId } from "@balabala/shared";

const parseTopics = (raw: string): string[] =>
  raw.split(/[#\s,，、]+/).map((item) => item.trim()).filter(Boolean);

export function PublishForm({ author, onBack, onPublished }: {
  author?: string;
  onBack: () => void;
  onPublished: (content: PlazaContent) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [topicsText, setTopicsText] = useState("");
  const [scene, setScene] = useState<SceneId | "all">("all");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState('');

  const topics = parseTopics(topicsText);

  const polishPost = async () => {
    const input = body.trim();
    if (!input || polishing) return;
    setPolishing(true);
    setPolishError('');
    try {
      const res = await fetch('/api/ai/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input, context: 'post' }),
      });
      const data = (await res.json()) as { result?: string; message?: string };
      if (!res.ok || !data.result) throw new Error(data.message ?? '润色失败');
      setBody(data.result);
    } catch (e) {
      setPolishError(e instanceof Error ? e.message : '润色失败');
    } finally {
      setPolishing(false);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError("请填写标题和正文");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/contents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, topics, scene, author: author || "我" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? "发布失败，请稍后再试");
      }
      const data = (await res.json()) as { content: PlazaContent };
      onPublished(data.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发布失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="plaza-overlay" role="dialog" aria-modal="true">
      <form className="plaza-publish" onSubmit={submit}>
        <button type="button" className="plaza-detail__back" onClick={onBack}>
          <ArrowLeft size={15} /> 返回广场
        </button>
        <h1>发布文字观点</h1>
        <p className="plaza-publish__hint">把你的观点分享到广场，看看大家怎么看。</p>

        <label className="plaza-field">
          <span>发布到场景</span>
          <div className="plaza-scene-picker">
            <button type="button" className={scene === "all" ? "is-active" : ""} onClick={() => setScene("all")}>
              🗨️ 总讨论区
            </button>
            {SCENE_META.map((item) => (
              <button type="button" key={item.id}
                className={scene === item.id ? "is-active" : ""}
                disabled={item.locked}
                onClick={() => setScene(item.id)}>
                {item.emoji} {item.label}
                {item.locked && <Lock size={11} />}
              </button>
            ))}
          </div>
        </label>

        <label className="plaza-field">
          <span>标题</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)}
            maxLength={40} placeholder="一句话亮出你的观点" />
        </label>

        <label className="plaza-field">
          <span>正文</span>
          <textarea value={body} onChange={(event) => setBody(event.target.value)}
            rows={6} maxLength={1000} placeholder="说说你的理由…" />
          <div className="plaza-publish__polish"><button type="button" className="plaza-publish__polish-btn" onClick={polishPost} disabled={!body.trim() || polishing}>✨ {polishing ? 'AI 润色中…' : 'AI 帮写'}</button>{polishError && <small className="plaza-publish__polish-error">{polishError}</small>}</div>
        </label>

        <label className="plaza-field">
          <span>话题（可选，用空格或 # 分隔）</span>
          <input value={topicsText} onChange={(event) => setTopicsText(event.target.value)}
            placeholder="例如：AI 设计 职场" />
          {topics.length > 0 && (
            <div className="plaza-card__topics">{topics.map((topic) => <i key={topic}>#{topic}</i>)}</div>
          )}
        </label>

        {error && <p className="plaza-publish__error">{error}</p>}

        <div className="plaza-publish__actions">
          <button type="button" className="archive-ghost-button" onClick={onBack}>取消</button>
          <button type="submit" className="archive-primary-button" disabled={submitting}>
            <Send size={14} /> {submitting ? "发布中…" : "发布到广场"}
          </button>
        </div>
      </form>
    </div>
  );
}
