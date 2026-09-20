import { useContext, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Users } from "lucide-react";
import { AuthContext } from "../../context/AuthContext";
import { Panel } from "../ui/Primitives";
import {
  REVISION_STATES,
  fetchCommunityImage,
  getCommunityCapabilities,
} from "../../services/apiCommunity";
import { activityLabels } from "../../utils/corporationActivity.js";

export function CommunityError({ error, retry }) {
  if (!error) return null;
  return (
    <div className="corp-error" role="alert">
      <span>{error.message || String(error)}</span>
      {retry && (
        <button type="button" className="ghost-btn" onClick={retry}>
          重新加载
        </button>
      )}
    </div>
  );
}
export function CommunityNav() {
  const { isAuthenticated, userInfo } = useContext(AuthContext);
  const key = userInfo?.userId || userInfo?.userName || "session";
  const capability = useQuery({
    queryKey: ["community", key, "capabilities"],
    queryFn: getCommunityCapabilities,
    enabled: isAuthenticated,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  return (
    <nav className="corp-nav" aria-label="军团导航">
      <NavLink to="/corporations" end>
        发现军团
      </NavLink>
      <NavLink to="/corporations/manage">我的军团</NavLink>
      {isAuthenticated && capability.data?.can_review && (
        <NavLink to="/corporations/review">审核管理</NavLink>
      )}
    </nav>
  );
}
export function CommunityGuest() {
  return (
    <Panel className="corp-guest">
      <Users size={36} aria-hidden="true" />
      <h2>让你的军团被更多人看见</h2>
      <p>申请管理军团，完善主页，用同一份资料制作宣传海报。</p>
      <Link className="primary-btn" to="/login">
        登录后管理军团
        <ArrowUpRight size={16} />
      </Link>
    </Panel>
  );
}
export function BackToCorporations() {
  return (
    <Link className="corp-back" to="/corporations">
      <ArrowLeft size={16} />
      返回军团大厅
    </Link>
  );
}
export function RevisionStatus({ value }) {
  return (
    <span className={`corp-status is-${value}`}>
      {REVISION_STATES[value] || value}
    </span>
  );
}
export function ActivityTags({ values = [], custom = [], limit = Infinity }) {
  const labels = activityLabels(values, custom);
  const visible = labels.slice(0, limit);
  if (!labels.length) return null;
  return (
    <div className="corp-tags" aria-label="活动方向标签">
      {visible.map((value) => (
        <span key={value}>{value}</span>
      ))}
      {labels.length > visible.length && (
        <span aria-label={`另有 ${labels.length - visible.length} 个活动标签`}>
          +{labels.length - visible.length}
        </span>
      )}
    </div>
  );
}
export function Pagination({ page, count, change }) {
  if (!(count > 20)) return null;
  return (
    <div className="corp-pagination">
      <button
        type="button"
        className="ghost-btn"
        disabled={page <= 1}
        onClick={() => change(page - 1)}
      >
        上一页
      </button>
      <span>
        第 {page} / {Math.ceil(count / 20)} 页
      </span>
      <button
        type="button"
        className="ghost-btn"
        disabled={page * 20 >= count}
        onClick={() => change(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}
export function usePrivateCommunity() {
  const { userInfo } = useContext(AuthContext);
  const client = useQueryClient();
  const key = userInfo?.userId || userInfo?.userName || "session";
  useEffect(
    () => () => client.removeQueries({ queryKey: ["community", key] }),
    [client, key],
  );
  return {
    prefix: ["community", key],
    refresh: () => client.invalidateQueries({ queryKey: ["community", key] }),
  };
}
export function useCommunityAction() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  return {
    busy,
    error,
    message,
    setError,
    async run(fn, success = "") {
      if (lock.current) return null;
      lock.current = true;
      setBusy(true);
      setError(null);
      setMessage("");
      try {
        const result = await fn();
        setMessage(success);
        return result;
      } catch (err) {
        setError(err);
        return null;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
  };
}
export function useIdempotencyKey() {
  const last = useRef(null);
  return (payload) => {
    const signature = JSON.stringify(payload);
    if (last.current?.signature !== signature)
      last.current = { signature, id: crypto.randomUUID() };
    return last.current.id;
  };
}
export function useCommunityImage(url, isPrivate = false, reload = 0) {
  const [state, setState] = useState({ url: null, source: null, error: null });
  useEffect(() => {
    let active = true;
    let objectUrl;
    setState({ url: null, source: url, error: null });
    if (url)
      fetchCommunityImage(url, isPrivate)
        .then((value) => {
          objectUrl = value;
          if (active) setState({ url: value, source: url, error: null });
          else URL.revokeObjectURL(value);
        })
        .catch((error) => {
          if (active) setState({ url: null, source: url, error });
        });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, isPrivate, reload]);
  return state.source === url ? state : { url: null, source: url, error: null };
}
export function CorporationImage({
  url,
  isPrivate = false,
  className = "",
  alt = "",
  fallback = "E",
}) {
  const image = useCommunityImage(url, isPrivate);
  return image.url ? (
    <img src={image.url} alt={alt} className={className} />
  ) : (
    <span
      className={`${className} corp-image-fallback`}
      aria-label={image.error ? "图片暂时不可用" : undefined}
    >
      {fallback}
    </span>
  );
}
