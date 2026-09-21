import { useEffect, useRef, useState } from "react";
import { Copy, Link2, Users } from "lucide-react";
import { getTacticalMembers } from "../../services/apiTacticalCollaboration";
import { ROLE_LABELS } from "../../utils/tacticalCollaboration";
import { TacticalDialog } from "./TacticalControls";

export default function TacticalMembers({
  organizationId,
  role,
  execute,
  onClose,
  onAccessDenied,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(null);
  const [remove, setRemove] = useState(null);
  const alive = useRef(true);
  const failureHandler = (failure) => {
    if (!alive.current) return;
    if (
      [401, 403, 404].includes(failure.status) ||
      failure.name === "AuthSessionChangedError"
    ) {
      alive.current = false;
      setData(null);
      setInvite(null);
      setRemove(null);
      setNotice("");
      onAccessDenied?.();
      onClose();
      return;
    }
    setError(failure.message);
  };
  const reload = async () => {
    try {
      const next = await getTacticalMembers(organizationId);
      if (alive.current) setData(next);
    } catch (failure) {
      failureHandler(failure);
    }
  };
  useEffect(() => {
    alive.current = true;
    reload();
    const timer = setInterval(reload, 5000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [organizationId]);
  const run = async (action, payload) => {
    setBusy(true);
    setError("");
    try {
      const result = await execute(action, payload, { requireLease: false });
      if (!alive.current) return;
      setNotice("人员操作已完成");
      await reload();
      return alive.current ? result : undefined;
    } catch (failure) {
      failureHandler(failure);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const createInvite = async () => {
    const result = await run("invite.create", {});
    if (result && alive.current) setInvite(result);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/tactical?invite=${encodeURIComponent(invite.invite_code)}`,
      );
      setNotice("邀请链接已复制");
    } catch {
      setNotice("无法自动复制，请选择下方链接手动复制。");
    }
  };
  const online = new Map(
    (data?.online || []).map((member) => [member.user_id, member]),
  );
  return (
    <TacticalDialog title="人员管理" onClose={onClose} wide>
      <div className="tac-form">
        <div className="tac-member-summary">
          <div>
            <Users size={20} />
            <strong>
              {data?.online_count ?? "—"} / {data?.capacity || 100}
            </strong>
            <span>当前在线</span>
          </div>
          <button
            type="button"
            className="tac-btn"
            disabled={busy}
            onClick={createInvite}
          >
            <Link2 size={16} />
            生成邀请链接
          </button>
        </div>
        {invite && (
          <div className="tac-invite-box">
            <label className="tac-field">
              <span>邀请链接 · 新成员默认斥候</span>
              <input
                readOnly
                aria-label="邀请链接"
                value={`${window.location.origin}/tactical?invite=${encodeURIComponent(invite.invite_code)}`}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <button type="button" className="tac-btn" onClick={copy}>
              <Copy size={16} />
              复制链接
            </button>
            <small>
              有效期至 {new Date(invite.expires_at).toLocaleString()}
            </small>
          </div>
        )}
        {error && (
          <p role="alert" className="tac-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="tac-notice">
            {notice}
          </p>
        )}
        <section>
          <h3>
            待审批{" "}
            <span className="tac-badge">{data?.applications?.length || 0}</span>
          </h3>
          {data?.applications?.length ? (
            data.applications.map((application) => (
              <div className="tac-member-row" key={application.id}>
                <div>
                  <strong>{application.display_name}</strong>
                  <small>申请加入组织</small>
                </div>
                <div className="tac-row-actions">
                  <button
                    type="button"
                    className="tac-btn"
                    aria-label={`拒绝${application.display_name}`}
                    disabled={busy}
                    onClick={() =>
                      run("join.review", {
                        application_id: application.id,
                        decision: "reject",
                      })
                    }
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    className="tac-btn is-primary"
                    aria-label={`批准${application.display_name}`}
                    disabled={busy}
                    onClick={() =>
                      run("join.review", {
                        application_id: application.id,
                        decision: "approve",
                      })
                    }
                  >
                    批准
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="tac-muted">没有待处理申请。</p>
          )}
        </section>
        <section>
          <div className="tac-section-head">
            <h3>组织成员</h3>
            <span className="tac-muted">在线与组织成员数分别统计</span>
          </div>
          <label className="tac-field">
            <span className="sr-only">搜索成员</span>
            <input
              aria-label="搜索成员"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索昵称或角色"
            />
          </label>
          <div className="tac-members-list">
            {data?.members
              ?.filter((member) =>
                `${member.display_name} ${ROLE_LABELS[member.role]}`.includes(
                  query,
                ),
              )
              .map((member) => (
                <div className="tac-member-row" key={member.id}>
                  <div>
                    <strong>{member.display_name}</strong>
                    <small>
                      <span
                        className={`tac-presence-dot ${online.has(member.user_id) ? "is-online" : ""}`}
                      />
                      {ROLE_LABELS[member.role]} ·{" "}
                      {member.status === "removed"
                        ? "已移除"
                        : online.has(member.user_id)
                          ? online.get(member.user_id).connection_status ===
                            "reconnecting"
                            ? "重连中"
                            : "在线"
                          : "离线"}
                      {online.has(member.user_id) && (
                        <>
                          {" "}
                          · 进入{" "}
                          {new Date(
                            online.get(member.user_id).joined_at,
                          ).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </>
                      )}
                      {online.get(member.user_id)?.last_reported_at && (
                        <>
                          {" "}
                          · 最近上报{" "}
                          {new Date(
                            online.get(member.user_id).last_reported_at,
                          ).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </>
                      )}
                    </small>
                  </div>
                  <div className="tac-row-actions">
                    {role === "founder" &&
                      member.role !== "founder" &&
                      member.status === "active" && (
                        <button
                          type="button"
                          className="tac-btn is-small"
                          disabled={busy}
                          onClick={() =>
                            run("member.role", {
                              member_id: member.id,
                              role:
                                member.role === "scout" ? "commander" : "scout",
                            })
                          }
                        >
                          {member.role === "scout" ? "任命指挥" : "调整为斥候"}
                        </button>
                      )}
                    {member.status === "removed" && role === "founder" ? (
                      <button
                        type="button"
                        className="tac-btn is-small"
                        disabled={busy}
                        onClick={() =>
                          run("member.restore", { member_id: member.id })
                        }
                      >
                        恢复为斥候
                      </button>
                    ) : member.status === "active" &&
                      member.role !== "founder" &&
                      (role === "founder" || member.role === "scout") ? (
                      <button
                        type="button"
                        className="tac-btn is-small is-danger"
                        aria-label={`移除${member.display_name}`}
                        disabled={busy}
                        onClick={() => setRemove(member)}
                      >
                        移除
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
          </div>
        </section>
        {remove && (
          <TacticalDialog title="确认移除成员" onClose={() => setRemove(null)}>
            <p>
              移除「{remove.display_name}
              」后，将立即撤销其访问权限。历史情报仍保留；恢复成员由统帅处理。
            </p>
            <div className="tac-form-footer">
              <button
                type="button"
                className="tac-btn"
                onClick={() => setRemove(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="tac-btn is-danger"
                disabled={busy}
                onClick={async () => {
                  const result = await run("member.remove", {
                    member_id: remove.id,
                  });
                  if (result) setRemove(null);
                }}
              >
                确认移除
              </button>
            </div>
          </TacticalDialog>
        )}
      </div>
    </TacticalDialog>
  );
}
