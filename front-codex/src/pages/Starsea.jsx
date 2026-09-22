import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listPosts, getLocations } from "../services/apiStarsea";
import { KINDS } from "../utils/starsea";
import {
  AccountBoundary,
  StarseaHeader,
  ErrorNotice,
  Loading,
  Pagination,
  PostCard,
  useLoad,
  usePageClamp,
} from "../components/starsea/StarseaUI";

function Feed() {
  const [params, setParams] = useSearchParams(),
    [q, setQ] = useState(params.get("q") || "");
  const kind = params.get("kind") || "",
    region = params.get("region_id") || "",
    corporationId = params.get("corporation_id") || "",
    page = Math.max(1, Number(params.get("page")) || 1);
  const posts = useLoad(
    () =>
      listPosts({ kind, q: params.get("q") || "", region_id: region, corporation_id: corporationId, page }),
    [kind, params.get("q"), region, corporationId, page],
  );
  const regions = useLoad(() => getLocations("regions"), []);
  const change = (key, value) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };
  usePageClamp(posts, page, (value) => change("page", String(value)));
  return (
    <section className="starsea-page">
      <StarseaHeader />
      <div className="ss-filter-bar">
        <div className="ss-tabs" aria-label="内容分类">
          {Object.entries({ "": "全部", ...KINDS }).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => change("kind", value)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="ss-search"
          onSubmit={(event) => {
            event.preventDefault();
            change("q", q);
          }}
        >
          <input
            aria-label="搜索见闻"
            placeholder="搜索标题与正文"
            value={q}
            maxLength={120}
            onChange={(event) => setQ(event.target.value)}
          />
          <button type="submit">搜索</button>
        </form>
        <select
          aria-label="筛选星域"
          value={region}
          onChange={(event) => change("region_id", event.target.value)}
        >
          <option value="">所有星域</option>
          {regions.data?.results.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {corporationId && (
        <div className="ss-filter-context" role="status">
          <span>正在查看关联军团的见闻</span>
          <button type="button" onClick={() => change("corporation_id", "")}>清除军团筛选</button>
        </div>
      )}
      <ErrorNotice error={regions.error} retry={regions.reload} />
      <ErrorNotice error={posts.error} retry={posts.reload} />
      {posts.loading ? (
        <Loading />
      ) : posts.data?.results.length ? (
        <div className="ss-feed">
          {posts.data.results.map((entry) => (
            <PostCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        !posts.error && (
          <div className="ss-empty">
            <h2>还没有匹配的见闻</h2>
            <p>换个筛选，或记录属于你的新伊甸故事。</p>
          </div>
        )
      )}
      <Pagination
        page={page}
        count={posts.data?.count || 0}
        onChange={(value) => change("page", String(value))}
      />
    </section>
  );
}
export default function Starsea() {
  return (
    <AccountBoundary>
      <Feed />
    </AccountBoundary>
  );
}
