import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Flag,
  Map,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Users,
} from "lucide-react";
import { AuthContext } from "../context/AuthContext";
import {
  createTacticalOrganization,
  getTacticalMap,
  joinTacticalOrganization,
  listTacticalOrganizations,
  newRequestId,
} from "../services/apiTacticalCollaboration";
import useTacticalSession from "../hooks/useTacticalSession";
import {
  ageLabel,
  isStale,
  permissions,
  REPORT_LABELS,
  ROLE_LABELS,
  SHIP_TYPES,
  summarizeForces,
} from "../utils/tacticalCollaboration";
import CollaborationMap from "../components/tactical/CollaborationMap";
import {
  ShipComposition,
  ScopeEditor,
  TacticalDialog,
  TacticalSelect,
} from "../components/tactical/TacticalControls";
import TacticalReportForm, {
  ArchiveForce,
  ConfirmReport,
  MoveForce,
} from "../components/tactical/TacticalReportForm";
import TacticalMembers from "../components/tactical/TacticalMembers";
import "../styles/tacticalCollaboration.css";

function useMobile() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

function OrganizationForm({ initialInvite = "", onClose, onSuccess }) {
  const [kind, setKind] = useState(initialInvite ? "join" : "create");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState(initialInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef(null);
  const submitting = useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const signature = JSON.stringify([kind, kind === 'create' ? name.trim() : invite.trim()]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: newRequestId() };
    setBusy(true);
    setError("");
    try {
      const result =
        kind === "create"
          ? await createTacticalOrganization(name.trim(), attempt.current.id)
          : await joinTacticalOrganization(invite.trim(), attempt.current.id);
      onSuccess(result.result, kind);
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <TacticalDialog title="创建或加入组织" onClose={onClose}>
      <form className="tac-form" onSubmit={submit}>
        <div className="tac-segmented">
          <button
            type="button"
            aria-pressed={kind === "create"}
            onClick={() => setKind("create")}
          >
            创建组织
          </button>
          <button
            type="button"
            aria-pressed={kind === "join"}
            onClick={() => setKind("join")}
          >
            申请加入
          </button>
        </div>
        <p className="tac-muted">
          一个组织共用一张战术板。加入只需审批一次，不需要反复切换作战房间。
        </p>
        {kind === "create" ? (
          <label className="tac-field">
            <span>组织名称</span>
            <input
              value={name}
              required
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：北境联合指挥部"
            />
          </label>
        ) : (
          <label className="tac-field">
            <span>邀请码</span>
            <input
              value={invite}
              required
              maxLength={200}
              onChange={(event) => setInvite(event.target.value)}
              placeholder="输入统帅或指挥提供的邀请码"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="tac-error">
            {error}
          </p>
        )}
        <div className="tac-form-footer">
          <button type="button" className="tac-btn" onClick={onClose}>
            取消
          </button>
          <button className="tac-btn is-primary" disabled={busy}>
            {busy ? "提交中…" : kind === "create" ? "创建组织" : "提交加入申请"}
          </button>
        </div>
      </form>
    </TacticalDialog>
  );
}

export default function TacticalCollaborationPage() {
  const { isAuthenticated, userInfo } = useContext(AuthContext);
  return (
    <div className="tac-page">
      {!isAuthenticated ? (
        <>
          <header className="tac-page-head">
            <div>
              <p className="tac-eyebrow">FLEET INTELLIGENCE</p>
              <h1>战术板</h1>
              <p>从斥候的第一条目击，到指挥的全局判断。</p>
            </div>
            <Link className="tac-btn" to="/starmap">
              星系导航
              <ArrowUpRight size={16} />
            </Link>
          </header>
          <section className="tac-welcome">
            <div className="tac-welcome-icon">
              <Crosshair size={30} />
            </div>
            <h2>同一张星图，同步每一次变化</h2>
            <p>
              组织内共享敌情，按角色保护己方部署。登录后创建组织，或使用指挥提供的邀请加入。
            </p>
            <Link className="tac-btn is-primary" to="/login">
              登录后进入战术板
              <ArrowUpRight size={17} />
            </Link>
          </section>
        </>
      ) : (
        <AuthenticatedBoard key={userInfo?.userId || "authenticated"} />
      )}
    </div>
  );
}

function AuthenticatedBoard() {
  const [params, setParams] = useSearchParams();
  const [organizations, setOrganizations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(Boolean(params.get("invite")));
  useEffect(() => {
    let current = true;
    listTacticalOrganizations()
      .then((data) => {
        if (!current) return;
        setOrganizations(data.organizations || []);
        setSelected(
          data.organizations?.find((item) => item.status === "active" && String(item.id) === params.get("organization"))?.id ||
          data.organizations?.find((item) => item.status === "active")?.id ||
            null,
        );
      })
      .catch((failure) => {
        if (current) setError(failure.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (loading) return;
    const requested = params.get("organization");
    const authorized = organizations.find((item) => item.status === "active" && String(item.id) === requested);
    setSelected(authorized?.id || organizations.find((item) => item.status === "active")?.id || null);
  }, [params, organizations, loading]);
  const selectOrganization = (id) => {
    if (!organizations.some((item) => item.status === "active" && String(item.id) === String(id))) return;
    setSelected(id);
    const next = new URLSearchParams(params);
    next.set("organization", String(id));
    setParams(next, { replace: true });
  };
  const organization = organizations.find(
    (item) => String(item.id) === String(selected),
  );
  const success = async (result, kind) => {
    if (kind === "create") {
      setOrganizations((current) => [...current, result]);
      setSelected(result.id);
      const next = new URLSearchParams(params);
      next.set("organization", String(result.id));
      setParams(next, { replace: true });
      setNotice("组织已创建，你是该组织的统帅。");
    } else {
      setNotice("申请已提交，等待统帅或指挥审批。");
      try {
        const data = await listTacticalOrganizations();
        setOrganizations(data.organizations || []);
      } catch (failure) {
        setError(failure.message);
      }
    }
  };
  const closeForm = () => {
    setForm(false);
    if (params.has("invite")) {
      const next = new URLSearchParams(params);
      next.delete("invite");
      setParams(next, { replace: true });
    }
  };
  return (
    <>
      {!organization && <header className="tac-page-head">
        <div>
          <p className="tac-eyebrow">FLEET INTELLIGENCE</p>
          <h1>战术板</h1>
          <p>组织协同 · 敌情共享 · 局部作战</p>
        </div>
        <div className="tac-head-actions">
          <Link className="tac-btn" to="/starmap">
            星系导航
            <ArrowUpRight size={16} />
          </Link>
          <button
            type="button"
            className="tac-btn"
            onClick={() => setForm(true)}
          >
            <Plus size={16} />
            创建 / 加入组织
          </button>
        </div>
      </header>}
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
      {loading ? (
        <div className="tac-welcome" role="status">
          正在读取组织…
        </div>
      ) : organization ? (
          <ConnectedBoard key={organization.id} organization={organization}
            onOpenOrganization={() => setForm(true)}
            organizationControls={<div className="tac-organization-bar">
            <div className="tac-org-identity">
              <Shield size={19} />
              <TacticalSelect
                label="选择组织"
                value={selected}
                onChange={selectOrganization}
                options={organizations
                  .filter((item) => item.status === "active")
                  .map((item) => ({ value: item.id, label: item.name }))}
              />
            </div>
          </div>} />
      ) : (
        <section className="tac-welcome">
          <div className="tac-welcome-icon">
            <Users size={28} />
          </div>
          <h2>建立你的指挥网络</h2>
          <p>
            统帅与指挥掌握敌我全局，斥候专注上报。所有敌方部署对组织内斥候可见。
          </p>
          <button
            type="button"
            className="tac-btn is-primary"
            onClick={() => setForm(true)}
          >
            创建或加入组织
            <ArrowUpRight size={17} />
          </button>
          {organizations
            .filter((item) => item.status !== "active")
            .map((item) => (
              <p key={item.id} className="tac-muted">
                {item.name} ·{" "}
                {item.status === "pending"
                  ? "等待审批"
                  : item.status === "removed"
                    ? "已移除，请联系统帅"
                    : "暂不可进入"}
              </p>
            ))}
        </section>
      )}
      {form && (
        <OrganizationForm
          initialInvite={params.get("invite") || ""}
          onClose={closeForm}
          onSuccess={success}
        />
      )}
    </>
  );
}

function ConnectedBoard({ organization, organizationControls, onOpenOrganization }) {
  const session = useTacticalSession(organization.id);
  const { snapshot, status, error, refresh, execute, invalidateAccess } =
    session;
  const role = snapshot?.role || organization.role;
  const [members, setMembers] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  useEffect(
    () => setMembers(false),
    [snapshot?.permission_version, role, status === "revoked"],
  );
  const labels = {
    connecting: "正在连接",
    live: "实时同步",
    offline: "连接中断 · 待恢复",
    full: "在线名额已满",
    revoked: "访问已撤销",
  };
  const connectionControls = (
      <div className="tac-connection-row">
        <div className={`tac-connection is-${status}`} role="status">
          <span className="tac-presence-dot" />
          {labels[status]}
          {status !== "revoked" && (
            <span className="tac-role">{ROLE_LABELS[role]}</span>
          )}
        </div>
        <div className="tac-row-actions">
          {permissions(role).manageMembers &&
            status !== "revoked" &&
            !accessDenied && (
              <button
                type="button"
                className="tac-btn is-small"
                onClick={() => setMembers(true)}
              >
                <Users size={16} />
                人员管理
              </button>
            )}
          {status !== "live" && status !== "revoked" && (
            <button
              type="button"
              className="tac-btn is-small"
              onClick={refresh}
            >
              <RefreshCw size={15} />
              重试连接
            </button>
          )}
        </div>
      </div>
  );
  const connectionError = error && (
        <p className="tac-error" role="alert">
          {error}
          {status === "offline"
            ? " 已有数据可能过时；恢复连接后请手动提交未发送内容。"
            : ""}
        </p>
      );
  return (
    <>
      {snapshot && !accessDenied ? (
        <BoardContent
          key={`${snapshot.permission_version}:${snapshot.role}`}
          organizationId={organization.id}
          snapshot={snapshot}
          execute={execute}
          status={status}
          organizationControls={organizationControls}
          connectionControls={connectionControls}
          connectionError={connectionError}
          onOpenOrganization={onOpenOrganization}
          onOpenMembers={() => setMembers(true)}
        />
      ) : (
        <>
        {organizationControls}
        {connectionControls}
        {connectionError}
        <section className="tac-welcome">
          <Radio size={28} />
          <h2>
            {status === "full"
              ? "当前在线人数已达上限"
              : status === "revoked"
                ? "你已无法访问此战术板"
                : "正在建立安全连接"}
          </h2>
          <p>
            {status === "full"
              ? "最多 100 个在线账号。统帅和指挥仍可管理人员及审批申请。"
              : status === "revoked"
                ? "请联系统帅确认成员资格，已加载的战术情报已清除。"
                : "连接成功后会读取你有权查看的最新情报。"}
          </p>
        </section>
        </>
      )}
      {members && status !== "revoked" && !accessDenied && (
        <TacticalMembers
          key={`${role}:${snapshot?.permission_version}`}
          organizationId={organization.id}
          role={role}
          execute={execute}
          onClose={() => setMembers(false)}
          onAccessDenied={() => {
            setAccessDenied(true);
            invalidateAccess?.();
          }}
        />
      )}
    </>
  );
}

function BoardContent({ organizationId, snapshot, execute, status, organizationControls, connectionControls, connectionError, onOpenOrganization, onOpenMembers }) {
  const mobile = useMobile();
  const can = permissions(snapshot.role);
  const [mapData, setMapData] = useState(null);
  const [mapError, setMapError] = useState("");
  const [selectedSystem, setSelectedSystem] = useState(null);
  const [selectedForce, setSelectedForce] = useState(null);
  const [tab, setTab] = useState("forces");
  const [query, setQuery] = useState("");
  const [sideFilter, setSideFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [moving, setMoving] = useState(false);
  const [systemQuery, setSystemQuery] = useState("");
  const [focusSystem, setFocusSystem] = useState(null);
  const scopeVersion = snapshot.scope?.version;
  useEffect(() => {
    let active = true;
    setMapData(null);
    setMapError("");
    if (mobile) return;
    getTacticalMap(organizationId)
      .then((data) => {
        if (active) setMapData(data);
      })
      .catch((failure) => {
        if (active) setMapError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [organizationId, scopeVersion, mobile]);
  const summary = summarizeForces(snapshot.forces || []);
  const pending = snapshot.reports.filter(
    (report) => report.status !== "confirmed",
  ).length;
  const systemIds = useMemo(
    () =>
      new Set(
        (mapData?.systems || []).map((system) => Number(system.system_id)),
      ),
    [mapData],
  );
  const filteredForces = snapshot.forces.filter(
    (item) => sideFilter === "all" || item.side === sideFilter,
  );
  const forces = filteredForces.filter((force) =>
    `${force.name} ${force.system_name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const reports = snapshot.reports.filter((report) =>
    `${report.system_name} ${report.author_name} ${report.notes}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const force = snapshot.forces.find((item) => item.id === selectedForce);
  const chooseSystem = (node) =>
    setSelectedSystem({
      id: node.system_id ?? node.id,
      name: node.zh_name || node.name,
    });
  const focusMapSystem = (node) => {
    chooseSystem(node);
    setFocusSystem({ ...node, _focusToken: Date.now() });
    setSystemQuery("");
  };
  const chooseForce = (item) => {
    setSelectedForce(item.id);
    setSelectedSystem({ id: item.system_id, name: item.system_name });
    setCollapsed(false);
    setTab("forces");
  };
  const move = async (item, destination) => {
    if (moving) return;
    setMoving(true);
    setError("");
    try {
      await execute("force.move", {
        force_id: item.id,
        expected_version: item.version,
        destination_system_id: destination,
        kind: "gate_move",
      });
      setNotice("部队已通过星门移动；观察时间未改变。");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setMoving(false);
    }
  };
  const currentServerTime = Date.parse(snapshot.server_time) || Date.now();
  return (
    <section className={mobile ? "tac-board-mobile" : "tac-immersive"} aria-label="组织战术板">
      <div className="tac-command-bar">
        <div className="tac-command-identity">
          <div className="tac-command-title"><Crosshair size={20} /><h1>战术板</h1></div>
          {organizationControls}
          {connectionControls}
        </div>
        <div className="tac-command-links">
          <Link className="tac-btn is-small" to="/starmap">星系导航 <ArrowUpRight size={14} /></Link>
          <button type="button" className="tac-icon-btn" aria-label="创建 / 加入组织" title="创建 / 加入组织" onClick={onOpenOrganization}><Plus size={18} /></button>
        </div>
      </div>
      <section className="tac-summary" aria-label="战术概览">
        <div>
          <span>敌方部署</span>
          <strong>
            {summary.forces}
            <small>支</small>
          </strong>
          <p>
            {summary.knownPeople} 已知人数
            {summary.unknownForces
              ? ` · ${summary.unknownForces} 支人数未知`
              : ""}
          </p>
        </div>
        <div>
          <span>{can.manageForces ? "待核对情报" : "我的待核对情报"}</span>
          <strong>
            {pending}
            <small>条</small>
          </strong>
          <p>情报不自动累加为部队</p>
        </div>
        <div>
          <span>组织当前在线</span>
          <strong>
            {snapshot.online_count}
            <small>/ {snapshot.capacity || 100}</small>
          </strong>
          <p>同一账号多标签页只计一人</p>
        </div>
      </section>
      <div className="tac-board-actions">
        <div className="tac-scope-label">
          <Map size={16} />
          <span>
            {snapshot.scope?.region_ids?.length || 0} 个作战星域 · 边界{" "}
            {snapshot.scope?.border_hops || 0} 跳
          </span>
          {can.manageForces && (
            <button
              type="button"
              className="tac-text-btn"
              disabled={status !== "live"}
              onClick={() => setDialog({ kind: "scope" })}
            >
              调整范围
            </button>
          )}
        </div>
        <div className="tac-row-actions">
          {can.manageForces && (
            <button
              type="button"
              className="tac-btn"
              disabled={status !== "live"}
              onClick={() => setDialog({ kind: "force", side: "friendly" })}
            >
              <Flag size={16} />
              添加己方部署
            </button>
          )}
          <button
            type="button"
            className="tac-btn is-primary"
            disabled={status !== "live"}
            onClick={() => setDialog({ kind: "report" })}
          >
            <Plus size={17} />
            快速上报
          </button>
        </div>
      </div>
      <div className="tac-board-messages" aria-live="polite">
      {connectionError}
      {notice && (
        <p role="status" className="tac-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="tac-error">
          {error}
        </p>
      )}
      {mapError && (
        <p role="alert" className="tac-error">
          局部星图加载失败：{mapError}
        </p>
      )}
      </div>
      <div
        className={`tac-board-layout${collapsed && !mobile ? " is-panel-collapsed" : ""}`}
      >
        {!mobile && (
          <section className="tac-map-section">
            <CollaborationMap
              systems={mapData?.systems || []}
              stargates={mapData?.stargates || []}
              constellations={mapData?.constellations || []}
              scope={mapData?.scope}
              boundaryExits={mapData?.boundary_exits || []}
              forces={filteredForces}
              selectedSystemId={selectedSystem?.id}
              onSelectSystem={chooseSystem}
              selectedForceId={selectedForce}
              onSelectForce={chooseForce}
              focusSystem={focusSystem}
              onFocusSystem={(node) => {
                focusMapSystem(node);
                setQuery(node.zh_name || node.name);
                setCollapsed(false);
                setTab("forces");
              }}
              canMove={can.manageForces && status === "live" && !moving}
              onMoveForce={move}
            />
            <div className="tac-map-controls" aria-label="星图工具">
              <label className="tac-search"><Search size={16} /><input aria-label="搜索当前星图" placeholder="查找当前星图的星系" value={systemQuery} onChange={(event) => setSystemQuery(event.target.value)} /></label>
              {systemQuery.trim() && <div className="tac-map-search-results">
                {(mapData?.systems || []).filter((node) => `${node.zh_name || ""} ${node.name || ""}`.toLowerCase().includes(systemQuery.trim().toLowerCase())).slice(0, 8).map((node) => <button key={node.system_id} type="button" onClick={() => focusMapSystem(node)}><span>{node.zh_name || node.name}</span><small>{node.security_status == null ? "安等未知" : Number(node.security_status).toFixed(2)}</small></button>)}
              </div>}
              {can.manageForces && <div className="tac-side-filter" aria-label="部署阵营筛选">{[["all", "全部阵营"], ["enemy", "仅敌方"], ["friendly", "仅己方"]].map(([value, label]) => <button type="button" key={value} aria-pressed={sideFilter === value} onClick={() => setSideFilter(value)}>{label}</button>)}</div>}
              <span className="tac-map-provenance">{mapData?.data_source?.label || "星图"}{mapData?.data_source && !mapData.data_source.is_real ? " · 非完整真实星图" : ""}</span>
            </div>
            {collapsed && <button className="tac-panel-reopen tac-btn" type="button" aria-label="展开情报侧栏" onClick={() => setCollapsed(false)}><ChevronLeft size={16} />部署与情报 <span>{snapshot.forces.length}</span></button>}
            <div className="tac-map-bottom">
              <span>
                {selectedSystem
                  ? `上报地点：${selectedSystem.name}`
                  : "在星图上选择一个星系，快速填写目击情报。"}
              </span>
              {selectedSystem && (
                <button
                  type="button"
                  className="tac-text-btn"
                  disabled={status !== "live"}
                  onClick={() => setDialog({ kind: "report" })}
                >
                  在此上报
                  <ArrowUpRight size={15} />
                </button>
              )}
            </div>
            {selectedSystem &&
              (mapData?.boundary_exits || []).some(
                (exit) => Number(exit.system_id) === Number(selectedSystem.id),
              ) && (
                <div className="tac-boundary-list">
                  <strong>{selectedSystem.name} · 边界星门</strong>
                  {mapData.boundary_exits
                    .filter(
                      (exit) =>
                        Number(exit.system_id) === Number(selectedSystem.id),
                    )
                    .map((exit) => (
                      <div key={exit.destination_system_id}>
                        <span>
                          {exit.destination_name} <small>当前加载范围外</small>
                        </span>
                        {can.manageForces &&
                          force &&
                          Number(force.system_id) ===
                            Number(selectedSystem.id) && (
                            <button
                              type="button"
                              className="tac-text-btn"
                              disabled={status !== "live" || moving}
                              aria-label={`移动到${exit.destination_name}`}
                              onClick={() =>
                                move(force, exit.destination_system_id)
                              }
                            >
                              移动至此 <ArrowUpRight size={13} />
                            </button>
                          )}
                      </div>
                    ))}
                </div>
              )}
          </section>
        )}
        {(!collapsed || mobile) && (
          <aside className="tac-side-panel" aria-label="部署与情报">
            {mobile && can.manageForces && (
              <div className="tac-side-filter" aria-label="部署阵营筛选">
                {[
                  ["all", "全部阵营"],
                  ["enemy", "仅敌方"],
                  ["friendly", "仅己方"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={sideFilter === value}
                    onClick={() => setSideFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="tac-panel-tabs">
              <button
                type="button"
                aria-label="部署"
                aria-pressed={tab === "forces"}
                onClick={() => setTab("forces")}
              >
                部署<span>{snapshot.forces.length}</span>
              </button>
              <button
                type="button"
                aria-label="情报"
                aria-pressed={tab === "reports"}
                onClick={() => setTab("reports")}
              >
                情报<span>{snapshot.reports.length}</span>
              </button>
              {can.manageMembers && <button type="button" aria-label="成员" onClick={onOpenMembers}>成员<span>{snapshot.online_count}</span></button>}
              {!mobile && <button type="button" className="tac-icon-btn tac-panel-collapse" aria-label="收起情报侧栏" onClick={() => setCollapsed(true)}><ChevronRight size={17} /></button>}
            </div>
            <label className="tac-search">
              <Search size={16} />
              <input
                aria-label="搜索部署或情报"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="部队、星系或上报者"
              />
            </label>
            <div className="tac-panel-list">
              {tab === "forces" ? (
                <>
                  {can.manageForces && (
                    <button
                      type="button"
                      className="tac-add-force"
                      disabled={status !== "live"}
                      onClick={() =>
                        setDialog({ kind: "force", side: "enemy" })
                      }
                    >
                      <Plus size={16} />
                      手动添加敌方部署
                    </button>
                  )}
                  {forces.length ? (
                    forces.map((item) => (
                      <article
                        key={item.id}
                        className={`tac-force-card is-${item.side}${item.id === selectedForce ? " is-selected" : ""}`}
                      >
                        <button
                          type="button"
                          className="tac-force-main"
                          onClick={() => chooseForce(item)}
                        >
                          <span className="tac-force-title">
                            <span className={`tac-side-badge is-${item.side}`}>
                              {item.side === "friendly" ? "己方" : "敌方"}
                            </span>
                            <strong>{item.name}</strong>
                          </span>
                          <span className="tac-force-location">
                            {item.system_name}
                            {mapData &&
                              !systemIds.has(Number(item.system_id)) && (
                                <small>范围外</small>
                              )}
                          </span>
                          <span className="tac-force-count">
                            {item.people ?? "?"}
                            <small>
                              {item.people == null ? "人数未知" : "人"}
                            </small>
                          </span>
                          <span
                            className={`tac-age${isStale(item.observed_at, currentServerTime) ? " is-stale" : ""}`}
                          >
                            {ageLabel(item.observed_at, currentServerTime)}
                          </span>
                        </button>
                        {item.id === selectedForce && (
                          <div className="tac-force-details">
                            <div className="tac-ship-summary">
                              {Object.entries(SHIP_TYPES)
                                .filter(([key]) => item.ships?.[key] != null)
                                .map(([key, label]) => (
                                  <span key={key}>
                                    {label}
                                    <b>{item.ships[key]}</b>
                                  </span>
                                ))}
                            </div>
                            {item.notes && <p>{item.notes}</p>}
                            <small>
                              最后编辑：
                              {new Date(item.updated_at).toLocaleString()}
                            </small>
                            {can.manageForces && (
                              <div className="tac-row-actions">
                                <button
                                  type="button"
                                  className="tac-btn is-small"
                                  disabled={status !== "live"}
                                  onClick={() =>
                                    setDialog({ kind: "force", initial: item })
                                  }
                                >
                                  编辑部署
                                </button>
                                <button
                                  type="button"
                                  className="tac-btn is-small"
                                  disabled={status !== "live"}
                                  onClick={() =>
                                    setDialog({ kind: "move", initial: item })
                                  }
                                >
                                  移动部队
                                </button>
                                <button
                                  type="button"
                                  className="tac-btn is-small"
                                  disabled={status !== "live"}
                                  onClick={() =>
                                    setDialog({
                                      kind: "archive",
                                      initial: item,
                                    })
                                  }
                                >
                                  归档部署
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    ))
                  ) : (
                    <div className="tac-empty">
                      <Crosshair size={24} />
                      <strong>暂时没有部署</strong>
                      <p>斥候上报后，由指挥确认或关联敌方部队。</p>
                    </div>
                  )}
                </>
              ) : reports.length ? (
                reports.map((item) => (
                  <article className="tac-report-card" key={item.id}>
                    <div className="tac-section-head">
                      <strong>{item.system_name}</strong>
                      <span className="tac-badge">
                        {REPORT_LABELS[item.status]}
                      </span>
                    </div>
                    <p>
                      {item.people ?? "未知"} 人 · {item.author_name}
                    </p>
                    <ShipComposition ships={item.ships} />
                    {item.notes && (
                      <p className="tac-report-notes">{item.notes}</p>
                    )}
                    <small
                      className={
                        isStale(item.observed_at, currentServerTime)
                          ? "tac-age is-stale"
                          : "tac-age"
                      }
                    >
                      {ageLabel(item.observed_at, currentServerTime)}
                    </small>
                    <div className="tac-row-actions">
                      {item.author_id === snapshot.user_id && (
                        <button
                          type="button"
                          className="tac-btn is-small"
                          disabled={status !== "live"}
                          onClick={() =>
                            setDialog({ kind: "report", initial: item })
                          }
                        >
                          修改我的上报
                        </button>
                      )}
                      {can.manageForces && item.status !== "confirmed" && (
                        <button
                          type="button"
                          className="tac-btn is-small is-primary"
                          disabled={status !== "live"}
                          onClick={() =>
                            setDialog({ kind: "confirm", initial: item })
                          }
                        >
                          确认 / 关联
                        </button>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <div className="tac-empty">
                  <Radio size={24} />
                  <strong>暂无情报</strong>
                  <p>一次上报即可同步给组织内所有指挥。</p>
                </div>
              )}
            </div>
            <div className="tac-panel-foot">
              <Shield size={13} />
              {can.manageForces
                ? "敌我部署仅指挥层完整可见"
                : "所有敌方部署可见 · 己方部署保密"}
            </div>
          </aside>
        )}
      </div>
      {mobile && (
        <p className="tac-mobile-note">
          手机端提供情报查看与快速上报，不加载星图。
          <Link to="/starmap">打开路径规划</Link>
        </p>
      )}
      {dialog?.kind === "scope" && (
        <ScopeEditor
          organizationId={organizationId}
          scope={snapshot.scope}
          execute={execute}
          onClose={() => setDialog(null)}
        />
      )}
      {["report", "force"].includes(dialog?.kind) && (
        <TacticalReportForm
          organizationId={organizationId}
          kind={dialog.kind}
          initial={dialog.initial}
          side={dialog.side}
          selectedSystem={selectedSystem}
          execute={execute}
          onClose={() => setDialog(null)}
          onSuccess={setNotice}
        />
      )}
      {dialog?.kind === "confirm" && (
        <ConfirmReport
          report={dialog.initial}
          forces={snapshot.forces}
          execute={execute}
          onClose={() => setDialog(null)}
          onSuccess={setNotice}
        />
      )}
      {dialog?.kind === "move" && (
        <MoveForce
          force={dialog.initial}
          organizationId={organizationId}
          execute={execute}
          onClose={() => setDialog(null)}
          onSuccess={setNotice}
        />
      )}
      {dialog?.kind === "archive" && (
        <ArchiveForce
          force={dialog.initial}
          execute={execute}
          onClose={() => setDialog(null)}
          onSuccess={setNotice}
        />
      )}
    </section>
  );
}
