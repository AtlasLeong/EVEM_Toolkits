import { useState } from "react";
import { getMine } from "../services/apiStarsea";
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
function Mine() {
  const [page, setPage] = useState(1),
    posts = useLoad(() => getMine(page), [page]);
  usePageClamp(posts, page, setPage);
  return (
    <section className="starsea-page">
      <StarseaHeader
        title="我的发布"
        subtitle="保存草稿、查看审核进度与维护已发布版本"
      />
      <ErrorNotice error={posts.error} retry={posts.reload} />
      {posts.loading ? (
        <Loading />
      ) : posts.data?.results.length ? (
        <div className="ss-feed">
          {posts.data.results.map((entry) => (
            <PostCard key={entry.id} entry={entry} privateView />
          ))}
        </div>
      ) : (
        !posts.error && (
          <div className="ss-empty">你还没有发布见闻，从一份草稿开始吧。</div>
        )
      )}
      <Pagination
        page={page}
        count={posts.data?.count || 0}
        onChange={setPage}
      />
    </section>
  );
}
export default function StarseaMine() {
  return (
    <AccountBoundary required>
      <Mine />
    </AccountBoundary>
  );
}
