import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  decideReview,
  getCapabilities,
  getManagement,
  getReview,
  listReviews,
  setVisibility,
} from "../services/apiStarsea";
import {
  AccountBoundary,
  ErrorNotice,
  Loading,
  Pagination,
  StarseaHeader,
  useAlive,
  useLoad,
  usePageClamp,
} from "../components/starsea/StarseaUI";
import PostContent from "../components/starsea/PostContent";

function ReviewSnapshot({ id, onDone }) {
  const entry = useLoad(() => getReview(id), [id]),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    alive = useAlive();
  async function decide(decision) {
    if (busy) return;
    if (decision === "reject" && !reason.trim()) {
      setError("请填写退回原因。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await decideReview(entry.data, decision, reason.trim());
      if (alive.current)
        onDone(
          decision === "approve" ? "审核通过，内容已公开" : "内容已退回作者",
        );
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="ss-review-snapshot">
      <ErrorNotice error={entry.error} retry={entry.reload} />
      {entry.loading ? (
        <Loading />
      ) : (
        entry.data && (
          <>
            <PostContent entry={entry.data} isPrivate />
            <div className="ss-review-actions">
              <label>
                审核说明
                <textarea
                  maxLength={1000}
                  rows="3"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="退回时必填，请说明需修改的内容"
                />
              </label>
              <ErrorNotice error={error} />
              <div>
                <button disabled={busy} onClick={() => decide("reject")}>
                  退回修改
                </button>
                <button
                  className="ss-primary"
                  disabled={busy}
                  onClick={() => decide("approve")}
                >
                  审核通过
                </button>
              </div>
            </div>
          </>
        )
      )}
    </section>
  );
}
function VisibilityTool() {
  const [id, setId] = useState(""),
    [entry, setEntry] = useState(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    alive = useAlive();
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="ss-visibility">
      <summary>已发布内容的显示管理</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            const value = await getManagement(id);
            if (alive.current) {
              setEntry(value);
              setMessage("");
            }
          });
        }}
      >
        <label>
          见闻 ID
          <input
            type="number"
            min="1"
            required
            disabled={busy}
            value={id}
            onChange={(event) => {
              setId(event.target.value);
              setEntry(null);
            }}
          />
        </label>
        <button disabled={busy}>查询内容</button>
      </form>
      <ErrorNotice error={error} />
      {message && <p role="status">{message}</p>}
      {entry && (
        <div>
          <p>
            {entry.revision.content.title || "未命名见闻"} ·{" "}
            {entry.is_listed ? "当前可见" : "当前隐藏"}
          </p>
          <label>
            管理原因
            <textarea
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="说明隐藏或恢复展示的原因"
            />
          </label>
          <button
            disabled={busy || !entry.published_revision_id || !reason.trim()}
            onClick={() =>
              run(async () => {
                const value = await setVisibility(
                  entry.id,
                  !entry.is_listed,
                  reason.trim(),
                );
                if (alive.current) {
                  setEntry(value);
                  setMessage("展示状态已更新");
                  setReason("");
                }
              })
            }
          >
            {entry.is_listed ? "隐藏公开内容" : "恢复公开内容"}
          </button>
          {!entry.published_revision_id && <p>此内容尚未发布。</p>}
        </div>
      )}
    </details>
  );
}
function Reviews() {
  const { revisionId } = useParams(),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(revisionId || ""),
    [message, setMessage] = useState(""),
    capabilities = useLoad(getCapabilities, []),
    reviews = useLoad(
      () =>
        capabilities.data?.can_review
          ? listReviews(page)
          : Promise.resolve({ count: 0, results: [] }),
      [page, capabilities.data?.can_review],
    );
  usePageClamp(reviews, page, setPage);
  return (
    <section className="starsea-page">
      <StarseaHeader
        title="内容审核"
        subtitle="审核不可变的送审快照；公开内容只来自通过的版本"
      />
      <ErrorNotice error={capabilities.error} retry={capabilities.reload} />
      {capabilities.loading ? (
        <Loading />
      ) : !capabilities.data?.can_review ? (
        <p className="ss-empty">当前账号没有内容审核权限。</p>
      ) : (
        <>
          {message && (
            <p className="ss-success" role="status">
              {message}
            </p>
          )}
          <ErrorNotice error={reviews.error} retry={reviews.reload} />
          {selected ? (
            <>
              <button className="ss-back" onClick={() => setSelected("")}>
                ← 返回审核列表
              </button>
              <ReviewSnapshot
                key={selected}
                id={selected}
                onDone={(notice) => {
                  setMessage(notice);
                  setSelected("");
                  reviews.reload();
                }}
              />
            </>
          ) : reviews.loading ? (
            <Loading />
          ) : reviews.data?.results.length ? (
            <div className="ss-review-list">
              {reviews.data.results.map((entry) => (
                <article key={entry.revision.id}>
                  <div>
                    <h2>{entry.revision.content.title || "未命名见闻"}</h2>
                    <p>
                      {entry.author_name} · 版本 {entry.revision.version}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelected(entry.revision.id);
                      setMessage("");
                    }}
                  >
                    查看审核快照
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="ss-empty">目前没有待审核内容。</p>
          )}
          {!selected && (
            <Pagination
              page={page}
              count={reviews.data?.count || 0}
              onChange={setPage}
            />
          )}
          <VisibilityTool />
        </>
      )}
    </section>
  );
}
export default function StarseaReview() {
  return (
    <AccountBoundary required>
      <Reviews />
    </AccountBoundary>
  );
}
