import { useContext, useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  useLocation,
  UNSAFE_NavigationContext,
} from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";
import { fetchImage, getCapabilities } from "../../services/apiStarsea";
import { KINDS, STATES } from "../../utils/starsea";
import { registerCorporationPopGuard } from "../../utils/corporationNavigationGuard";
import "../../styles/starsea.css";

export function useIdentity() {
  const { isAuthenticated, userInfo } = useContext(AuthContext);
  return `${isAuthenticated}:${userInfo?.userId || ""}:${userInfo?.userName || ""}`;
}
export function AccountBoundary({ children, required = false }) {
  const { isAuthenticated } = useContext(AuthContext),
    identity = useIdentity(),
    location = useLocation();
  if (required && !isAuthenticated)
    return (
      <section className="starsea-page">
        <Link to="/starsea">返回见闻</Link>
        <h1>登录后发布你的见闻</h1>
        <p>浏览无需登录；草稿只对你和审核员可见。</p>
        <Link
          className="ss-button ss-primary"
          to={`/login?next=${encodeURIComponent(location.pathname)}`}
        >
          登录后继续
        </Link>
      </section>
    );
  return <div key={identity}>{children}</div>;
}
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, error: "", loading: true }),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setState({ data: null, error: "", loading: true });
    Promise.resolve()
      .then(loader)
      .then((data) => {
        if (current) setState({ data, error: "", loading: false });
      })
      .catch((error) => {
        if (current)
          setState({ data: null, error: error.message, loading: false });
      });
    return () => {
      current = false;
    };
  }, [...deps, retry]);
  return { ...state, reload: () => setRetry((value) => value + 1) };
}
export function usePageClamp(result, page, onChange) {
  useEffect(() => {
    if (!result.loading && result.data && !result.error) {
      const lastPage = Math.max(1, Math.ceil(result.data.count / 20));
      if (page > lastPage) onChange(lastPage);
    }
  }, [result.loading, result.data, result.error, page, onChange]);
}
export function StarseaHeader({
  title = "星海见闻",
  subtitle = "战场记录 · 航行趣闻 · 军团声音",
  editor = false,
  children,
}) {
  const { isAuthenticated } = useContext(AuthContext),
    identity = useIdentity();
  const capability = useLoad(
    () =>
      isAuthenticated
        ? getCapabilities()
        : Promise.resolve({ can_review: false }),
    [identity],
  );
  return (
    <>
      <header className="ss-page-head">
        <div>
          {editor && (
            <Link className="ss-back" aria-label="返回见闻" to="/starsea">
              ← 返回见闻
            </Link>
          )}
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="ss-actions">{children}</div>
      </header>
      {!editor && (
        <nav className="ss-nav" aria-label="星海导航">
          <NavLink end to="/starsea">
            所有见闻
          </NavLink>
          <NavLink to="/starsea/mine">我的发布</NavLink>
          {capability.data?.can_review && (
            <NavLink to="/starsea/review">内容审核</NavLink>
          )}
          <Link className="ss-new" to="/starsea/new">
            ＋ 发布见闻
          </Link>
        </nav>
      )}
    </>
  );
}
export function ErrorNotice({ error, retry }) {
  return error ? (
    <div className="ss-error" role="alert">
      {error}
      {retry && (
        <button type="button" onClick={retry}>
          重试
        </button>
      )}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <p className="ss-muted" role="status">
      正在加载…
    </p>
  );
}
export function Pagination({ page, count, onChange }) {
  return count > 20 || page > 1 ? (
    <nav className="ss-pagination" aria-label="见闻分页">
      <button disabled={page === 1} onClick={() => onChange(page - 1)}>
        上一页
      </button>
      <span>
        第 {page} / {Math.ceil(count / 20)} 页
      </span>
      <button disabled={page * 20 >= count} onClick={() => onChange(page + 1)}>
        下一页
      </button>
    </nav>
  ) : null;
}
export function Status({ value }) {
  return (
    <span className={`ss-status ss-status-${value}`}>
      {STATES[value] || value}
    </span>
  );
}
export function SafeImage({ id, caption = "", isPrivate = false }) {
  const identity = useIdentity(),
    [state, setState] = useState({ url: "", error: "" }),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true,
      objectUrl;
    setState({ url: "", error: "" });
    fetchImage(id, isPrivate, controller.signal)
      .then((url) => {
        if (!current) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setState({ url, error: "" });
      })
      .catch((error) => {
        if (current && error.name !== "AbortError")
          setState({ url: "", error: error.message });
      });
    return () => {
      current = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, isPrivate, identity, retry]);
  return (
    <figure className="ss-image">
      {state.url ? (
        <img src={state.url} alt={caption || "见闻配图"} loading="lazy" />
      ) : state.error ? (
        <div className="ss-image-empty">
          <span>图片加载失败</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            重试图片
          </button>
        </div>
      ) : (
        <div className="ss-image-empty">加载图片…</div>
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
export function PostCard({ entry, privateView = false }) {
  const content = entry.revision.content,
    location = content.location;
  return (
    <article className="ss-post-card">
      <div className="ss-card-content">
        <div className="ss-meta">
          <span>{KINDS[content.kind]}</span>
          {privateView && <Status value={entry.revision.status} />}
          <span>
            {location?.solarsystem_name || location?.region_name || "新伊甸"}
          </span>
        </div>
        <h2>
          <Link
            to={
              privateView ? `/starsea/${entry.id}/edit` : `/starsea/${entry.id}`
            }
          >
            {content.title || "未命名草稿"}
          </Link>
        </h2>
        {content.body && (
          <p className="ss-excerpt">
            {content.body.replace(/\s+/g, " ").trim()}
          </p>
        )}
        {entry.summary?.sides && (
          <div className="ss-card-losses">
            {entry.summary.sides.map((side, index) => (
              <span key={index}>
                {side.name} <strong>{side.total_ships}</strong> 艘
              </span>
            ))}
          </div>
        )}
        <div className="ss-meta">
          <span>{entry.author_name || "飞行员"}</span>
          <time>
            {formatDate(
              entry.published_at ||
                entry.revision.updated_at ||
                entry.created_at,
            )}
          </time>
          {entry.corporation && <span>{entry.corporation.name}</span>}
        </div>
        {privateView && entry.revision.review_reason && (
          <p className="ss-review-reason">
            退回原因：{entry.revision.review_reason}
          </p>
        )}
        {privateView && entry.published_revision_id && (
          <p className="ss-muted">已有公开版本，草稿修改不会覆盖它。</p>
        )}
      </div>
      {content.images?.[0] && (
        <div className="ss-card-thumbnail">
          <SafeImage
            id={content.images[0].id}
            caption=""
            isPrivate={privateView}
          />
        </div>
      )}
    </article>
  );
}
export function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}
export function useUnsavedStarsea(dirty, busy = false) {
  const { navigator } = useContext(UNSAFE_NavigationContext),
    dirtyRef = useRef(dirty),
    busyRef = useRef(busy);
  dirtyRef.current = dirty;
  busyRef.current = busy;
  useEffect(() => {
    const shouldLeave = () =>
      (!dirtyRef.current && !busyRef.current) ||
      window.confirm(
        busyRef.current
          ? "操作仍在进行，确定离开吗？"
          : "有未保存的见闻修改，离开将丢失这些内容。确定离开吗？",
      );
    let index = window.history.state?.idx,
      restoring = false;
    const originals = { push: navigator.push, replace: navigator.replace },
      wrappers = {};
    for (const method of Object.keys(originals)) {
      wrappers[method] = (...args) => {
        if (shouldLeave()) {
          const result = originals[method].apply(navigator, args);
          index = window.history.state?.idx;
          return result;
        }
      };
      navigator[method] = wrappers[method];
    }
    const beforeUnload = (event) => {
      if (dirtyRef.current || busyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const unregister = registerCorporationPopGuard((event) => {
      const next = event.state?.idx;
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      if (
        !shouldLeave() &&
        Number.isInteger(index) &&
        Number.isInteger(next) &&
        index !== next
      ) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(index - next);
        return;
      }
      index = next;
    });
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      for (const method of Object.keys(originals))
        if (navigator[method] === wrappers[method])
          navigator[method] = originals[method];
      unregister();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [navigator]);
}
