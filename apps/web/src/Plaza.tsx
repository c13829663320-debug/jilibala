import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, PenLine, Compass, Flame, Clock, Lock } from "lucide-react";
import { SCENE_META, type ContentSort, type PlazaContent, type SceneId } from "@balabala/shared";
import { ContentCard } from "./ContentCard";
import { ContentDetail } from "./ContentDetail";
import { PublishForm } from "./PublishForm";
import "./plaza.css";

const TABS: Array<{ id: ContentSort; label: string; icon: typeof Compass }> = [
  { id: "recommended", label: "推荐", icon: Compass },
  { id: "hot", label: "热门", icon: Flame },
  { id: "latest", label: "最新", icon: Clock },
];

export function Plaza({ onBack, author }: { onBack: () => void; author?: string }) {
  const [scene, setScene] = useState<SceneId | "all">("all");
  const [sort, setSort] = useState<ContentSort>("recommended");
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [contents, setContents] = useState<PlazaContent[]>([]);
  const [topics, setTopics] = useState<Array<{ topic: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ sort });
      if (scene !== "all") params.set("scene", scene);
      if (activeTopic) params.set("topic", activeTopic);
      const res = await fetch(`/api/contents?${params.toString()}`);
      if (!res.ok) throw new Error("内容加载失败");
      const data = (await res.json()) as { contents?: PlazaContent[] };
      setContents(data.contents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "内容加载失败");
    } finally {
      setLoading(false);
    }
  }, [sort, scene, activeTopic]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/topics")
      .then((res) => res.json())
      .then((data: { topics?: Array<{ topic: string; count: number }> }) => setTopics(data.topics ?? []))
      .catch(() => undefined);
  }, []);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const chooseScene = (id: SceneId | "all", locked?: boolean) => {
    if (locked) {
      flash("该场景即将开放，敬请期待");
      return;
    }
    setScene(id);
  };

  const heading = scene === "all" ? "总讨论区" : SCENE_META.find((item) => item.id === scene)?.label ?? "广场";

  return (
    <main className="platform-shell plaza">
      <nav className="platform-topbar">
        <button type="button" className="platform-brand" onClick={onBack}>
          <ArrowLeft size={15} /> <b>BalaBala</b>
        </button>
        <div className="platform-nav">
          <button type="button" className="is-active">广场</button>
        </div>
        <button type="button" className="archive-primary-button" onClick={() => setShowPublish(true)}>
          <PenLine size={14} /> 发布
        </button>
      </nav>

      <div className="plaza-body">
        <aside className="plaza-sidebar">
          <span className="plaza-sidebar__label">频道</span>
          <button type="button" className={scene === "all" ? "is-active" : ""} onClick={() => chooseScene("all")}>
            <span className="plaza-sidebar__emoji">🗨️</span> 总讨论区
          </button>
          {SCENE_META.map((item) => (
            <button type="button" key={item.id} className={scene === item.id ? "is-active" : ""}
              onClick={() => chooseScene(item.id, item.locked)}>
              <span className="plaza-sidebar__emoji">{item.emoji}</span> {item.label}
              {item.locked && <Lock size={12} className="plaza-sidebar__lock" />}
            </button>
          ))}
        </aside>

        <section className="plaza-content">
          <header className="plaza-content__head">
            <h1>{heading}{activeTopic ? ` · #${activeTopic}` : ""}</h1>
            <div className="plaza-tabs">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button type="button" key={tab.id} className={sort === tab.id ? "is-active" : ""} onClick={() => setSort(tab.id)}>
                    <Icon size={14} /> {tab.label}
                  </button>
                );
              })}
            </div>
          </header>

          {topics.length > 0 && (
            <div className="plaza-topics">
              <span className="plaza-topics__label">热度</span>
              {topics.slice(0, 8).map((item) => (
                <button type="button" key={item.topic} className={activeTopic === item.topic ? "is-active" : ""}
                  onClick={() => setActiveTopic(activeTopic === item.topic ? null : item.topic)}>
                  🔥 {item.topic}
                </button>
              ))}
            </div>
          )}

          <div className="plaza-grid">
            {loading ? (
              <p className="plaza-status">正在加载内容…</p>
            ) : error ? (
              <p className="plaza-status">{error}</p>
            ) : contents.length === 0 ? (
              <div className="plaza-status plaza-empty">
                <p>这里还没有内容</p>
                <button type="button" className="archive-primary-button" onClick={() => setShowPublish(true)}>
                  <PenLine size={14} /> 发布第一个观点
                </button>
              </div>
            ) : (
              contents.map((content) => <ContentCard key={content.id} content={content} onOpen={setSelectedId} />)
            )}
          </div>
        </section>
      </div>

      <footer className="platform-footer">
        <span>广场内容由用户发布，AI 生成内容仅供娱乐</span>
        <span>{contents.length} 条内容</span>
      </footer>

      {selectedId && (
        <ContentDetail id={selectedId} author={author} onBack={() => setSelectedId(null)} onChanged={() => void load()} />
      )}
      {showPublish && (
        <PublishForm author={author} onBack={() => setShowPublish(false)}
          onPublished={(content) => {
            setShowPublish(false);
            setScene(content.type === "closed_court" ? "court" : "all");
            setActiveTopic(null);
            void load();
            setSelectedId(content.id);
          }} />
      )}
      {notice && <div className="plaza-toast">{notice}</div>}
    </main>
  );
}
