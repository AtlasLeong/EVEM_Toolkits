import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPost } from "../services/apiStarsea";
import {
  AccountBoundary,
  StarseaHeader,
  ErrorNotice,
  Loading,
  useLoad,
  useAlive,
} from "../components/starsea/StarseaUI";
import PostContent from "../components/starsea/PostContent";
function Detail() {
  const { id } = useParams(),
    post = useLoad(() => getPost(id), [id]),
    [share, setShare] = useState(""),
    [message, setMessage] = useState(""),
    alive = useAlive();
  async function onShare() {
    const url = `${window.location.origin}/starsea/${id}`;
    setShare(url);
    try {
      await navigator.clipboard.writeText(url);
      if (alive.current) setMessage("链接已复制");
    } catch {
      if (alive.current) setMessage("自动复制未成功，请选择下方链接复制。");
    }
  }
  return (
    <section className="starsea-page">
      <StarseaHeader title="见闻详情" subtitle="记录新伊甸的每一次相遇">
        <Link to="/starsea">返回见闻</Link>
        {post.data && <button onClick={onShare}>分享见闻</button>}
      </StarseaHeader>
      {share && (
        <div className="ss-share">
          <p role="status">{message}</p>
          <input
            readOnly
            aria-label="见闻分享链接"
            value={share}
            onFocus={(event) => event.target.select()}
          />
        </div>
      )}
      <ErrorNotice error={post.error} retry={post.reload} />
      {post.loading ? (
        <Loading />
      ) : (
        post.data && <PostContent entry={post.data} />
      )}
    </section>
  );
}
export default function StarseaDetail() {
  return (
    <AccountBoundary>
      <Detail />
    </AccountBoundary>
  );
}
