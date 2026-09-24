import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Flag,
  Map,
  Plus,
  Radar,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Users,
  X,
} from "lucide-react";
import { AuthContext } from "../context/AuthContext";
import {
  createTacticalOrganization,
  createTacticalBoard,
  getTacticalMap,
  joinTacticalOrganization,
  listTacticalOrganizations,
  newRequestId,
} from "../services/apiTacticalCollaboration";
import { selectDefaultTacticalOrganization } from "../utils/tacticalOrganization";
import { BOARD_KINDS, boardsForOrganization, createBoardAttemptSignature, selectTacticalBoard } from "../utils/tacticalBoards";
import useTacticalSession from "../hooks/useTacticalSession";
import {
  ageLabel,
  isStale,
  permissions,
  REPORT_LABELS,
  ROLE_LABELS,
  SHIP_TYPES,
} from "../utils/tacticalCollaboration";
import { buildTacticalOverview } from "../utils/tacticalOverview";
import TacticalStrengthSummary from "../components/tactical/TacticalStrengthSummary";
import CollaborationMap from "../components/tactical/CollaborationMap";
import { systemDisplayName, visibleGateExits } from "../utils/tacticalMapLayout";
import { latestSystemIntel } from "../utils/tacticalSystemIntel";
import {
  discardReportOutbox,
  paginateTacticalRows,
  queueReportOutbox,
  readReportOutbox,
  retryReportOutbox,
} from "../utils/tacticalOutbox";
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
  WithdrawCount,
} from "../components/tactical/TacticalReportForm";
import TacticalMembers from "../components/tactical/TacticalMembers";
import PirateIntelBoard from "../components/tactical/PirateIntelBoard";
import "../styles/tacticalCollaboration.css";
import "../styles/tacticalOverview.css";

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
  const [boardType, setBoardType] = useState('war');
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
    const signature = createBoardAttemptSignature(kind, kind === 'create' ? name : invite, boardType);
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: newRequestId() };
    setBusy(true);
    setError("");
    try {
      const result =
        kind === "create"
          ? await createTacticalOrganization(name.trim(), attempt.current.id, boardType)
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
          一个组织最多三块板，共用同一批成员。加入组织只需审批一次。
        </p>
        {kind === "create" ? (
          <>
            <fieldset className="tac-board-kind-field">
              <legend>选择首块战术板</legend>
              <div className="tac-board-kind-options">
                {BOARD_KINDS.map((item) => {
                  const Icon = item.kind === 'pirate' ? Radar : Crosshair;
                  return <button key={item.kind} type="button" className="tac-board-kind-option"
                    aria-pressed={boardType === item.kind} onClick={() => setBoardType(item.kind)}>
                    <span className="tac-board-kind-icon"><Icon size={21} strokeWidth={1.8} /></span>
                    <span className="tac-board-kind-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                  </button>;
                })}
              </div>
            </fieldset>
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
          </>
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

function BoardForm({ organizationId, existingCount, onClose, onSuccess }) {
  const [kind, setKind] = useState('war');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(null);
  const submit = async (event) => {
    event.preventDefault();
    const finalName = name.trim();
    const signature = JSON.stringify([organizationId, kind, finalName]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: newRequestId() };
    setBusy(true);
    setError('');
    try {
      const response = await createTacticalBoard(organizationId, finalName, kind, attempt.current.id);
      onSuccess(response.result);
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return <TacticalDialog title="新建战术板" onClose={onClose}>
    <form className="tac-form" onSubmit={submit}>
      <p className="tac-muted">这个组织已有 {existingCount} / 3 块板。新板独立保存范围和内容，仍共用组织成员。</p>
      <fieldset className="tac-board-kind-field"><legend>板类型</legend><div className="tac-board-kind-options">
        {BOARD_KINDS.map(item => {
          const Icon = item.kind === 'pirate' ? Radar : Crosshair;
          return <button type="button" key={item.kind} className="tac-board-kind-option" aria-pressed={kind === item.kind} onClick={() => setKind(item.kind)}>
            <span className="tac-board-kind-icon"><Icon size={21} strokeWidth={1.8} /></span>
            <span className="tac-board-kind-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
          </button>;
        })}
      </div></fieldset>
      <label className="tac-field"><span>板名称</span><input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="如：北境伏击线索" /></label>
      {error && <p role="alert" className="tac-error">{error}</p>}
      <div className="tac-form-footer"><button type="button" className="tac-btn" onClick={onClose}>取消</button><button className="tac-btn is-primary" disabled={busy}>{busy ? '创建中…' : '创建战术板'}</button></div>
    </form>
  </TacticalDialog>;
}

export default function TacticalCollaborationPage() {
  const { isAuthenticated, userInfo } = useContext(AuthContext);
  const location = useLocation();
  const loginNext = `${location.pathname}${location.search}`;
  return (
    <div className="tac-page">
      {!isAuthenticated ? (
        <>
          <header className="tac-page-head">
            <div>
              <p className="tac-eyebrow">FLEET INTELLIGENCE</p>
              <h1>战术板</h1>
              <p>星系敌情实时共享，协同掌握战区态势。</p>
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
            <Link className="tac-btn is-primary" to={`/login?next=${encodeURIComponent(loginNext)}`}>
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
  const [boardForm, setBoardForm] = useState(false);
  const directoryRevision = useRef(0);
  const preferRealMap = import.meta.env.MODE === "tactical-local";
  useEffect(() => {
    let current = true;
    let inFlight = false;
    const refreshDirectory = async (initial = false) => {
      if (inFlight || (!initial && document.hidden)) return;
      inFlight = true;
      const revision = directoryRevision.current;
      let timeoutId;
      try {
        const timeout = new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error("组织目录请求超时，请稍后重试。")), 12000);
        });
        const data = await Promise.race([listTacticalOrganizations(), timeout]);
        if (!current || directoryRevision.current !== revision) return;
        setOrganizations((previous) => directoryRevision.current === revision ? data.organizations || [] : previous);
        if (initial) setSelected(selectDefaultTacticalOrganization(data.organizations || [], {
          requested: params.get("organization"), preferRealMap,
        }));
        setError("");
      } catch (failure) {
        if (current && initial && directoryRevision.current === revision) setError(failure.message);
      } finally {
        window.clearTimeout(timeoutId);
        inFlight = false;
        if (current && initial) setLoading(false);
      }
    };
    void refreshDirectory(true);
    const intervalId = window.setInterval(() => { void refreshDirectory(); }, 45000);
    const onReturn = () => { if (!document.hidden) void refreshDirectory(); };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      current = false;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, []);
  useEffect(() => {
    if (loading) return;
    const requested = params.get("organization");
    setSelected((current) => {
      const active = organizations.filter((item) => item.status === "active");
      const explicit = active.find((item) => String(item.id) === String(requested));
      if (explicit) return explicit.id;
      if (active.some((item) => String(item.id) === String(current))) return current;
      return selectDefaultTacticalOrganization(organizations, { requested, preferRealMap });
    });
  }, [params, organizations, loading, preferRealMap]);
  const selectOrganization = (id) => {
    if (!organizations.some((item) => item.status === "active" && String(item.id) === String(id))) return;
    setSelected(id);
    const next = new URLSearchParams(params);
    next.set("organization", String(id));
    next.delete('board');
    setParams(next, { replace: true });
  };
  const organization = organizations.find(
    (item) => String(item.id) === String(selected),
  );
  const boards = boardsForOrganization(organization);
  const board = selectTacticalBoard(boards, params.get('board'));
  const selectBoard = (id) => {
    if (!boards.some(item => String(item.id) === String(id))) return;
    const next = new URLSearchParams(params);
    if (id == null) next.delete('board'); else next.set('board', String(id));
    setParams(next, { replace: true });
  };
  const organizationControls = <div className="tac-organization-bar">
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
  </div>;
  const success = async (result, kind) => {
    if (kind === "create") {
      directoryRevision.current += 1;
      setOrganizations((current) => [...current, result]);
      setSelected(result.id);
      const next = new URLSearchParams(params);
      next.set("organization", String(result.id));
      const firstBoard = boardsForOrganization(result)[0];
      if (firstBoard?.id) next.set('board', String(firstBoard.id));
      else next.delete('board');
      setParams(next, { replace: true });
      setNotice("组织已创建，你是该组织的统帅。");
    } else {
      setNotice("申请已提交，等待统帅或指挥审批。");
      directoryRevision.current += 1;
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
          <>
          <div className="tac-board-switcher" role="group" aria-label="选择战术板">
            {boards.map(item => {
              const Icon = item.kind === 'pirate' ? Radar : Crosshair;
              return <button type="button" key={item.id ?? 'legacy'} className="tac-board-switch"
                aria-pressed={String(board?.id) === String(item.id)} onClick={() => selectBoard(item.id)}>
                <Icon size={17} /><span>{item.name}</span><small>{item.kind === 'pirate' ? '海盗情报' : '战争沙盘'}</small>
              </button>;
            })}
            {['founder', 'commander'].includes(organization.role) && boards.length < 3 &&
              <button type="button" className="tac-board-add" onClick={() => setBoardForm(true)}><Plus size={16} /> 新建战术板</button>}
          </div>
          {board?.kind === 'pirate' ? <PirateIntelBoard key={`${organization.id}:${board.id}`} organization={organization} board={board}
            organizationControls={organizationControls} onOpenOrganization={() => setForm(true)} /> :
          <ConnectedBoard key={`${organization.id}:${board?.id ?? 'legacy'}`} organization={organization} boardId={board?.id}
            onOpenOrganization={() => setForm(true)}
            organizationControls={organizationControls} />}
          </>
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
      {boardForm && organization && <BoardForm organizationId={organization.id} existingCount={boards.length}
        onClose={() => setBoardForm(false)} onSuccess={created => {
          directoryRevision.current += 1;
          setOrganizations(current => current.map(item => item.id === organization.id ? { ...item, boards: [...boardsForOrganization(item), created] } : item));
          const next = new URLSearchParams(params);
          next.set('board', String(created.id));
          setParams(next, { replace: true });
          setNotice('新战术板已创建。');
        }} />}
    </>
  );
}

function ConnectedBoard({ organization, boardId, organizationControls, onOpenOrganization }) {
  const session = useTacticalSession(organization.id, boardId);
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
          {!snapshot && permissions(role).manageMembers &&
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
          boardId={boardId}
          snapshot={snapshot}
          execute={execute}
          refresh={refresh}
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
                ? "请联系统帅确认成员资格，已加载的战术数据已清除。"
                : "连接成功后会读取你有权查看的最新上报记录。"}
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

function BoardContent({ organizationId, boardId, snapshot, execute, refresh, status, organizationControls, connectionControls, connectionError, onOpenOrganization, onOpenMembers }) {
  const mobile = useMobile();
  const can = permissions(snapshot.role);
  const [mapData, setMapData] = useState(null);
  const [mapError, setMapError] = useState("");
  const [mapAttempt, setMapAttempt] = useState(0);
  const [selectedSystem, setSelectedSystem] = useState(null);
  // Keep a map context card open when a marker is selected, even if the
  // overview drawer is already expanded. This preserves the map-to-detail
  // link without hiding the list the user was using.
  const [systemDetailOpen, setSystemDetailOpen] = useState(false);
  const [selectedForce, setSelectedForce] = useState(null);
  const panelList = useRef(null);
  const [tab, setTab] = useState("forces");
  const [query, setQuery] = useState("");
  const [overviewScope, setOverviewScope] = useState('current');
  const [groupBy, setGroupBy] = useState('side');
  const [clock, setClock] = useState(Date.now());
  const serverClock = useMemo(() => ({ server: Date.parse(snapshot.server_time) || Date.now(), local: Date.now() }), [snapshot.server_time]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const currentServerTime = serverClock.server + Math.max(0, clock - serverClock.local);
  const [sideFilter, setSideFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [moving, setMoving] = useState(false);
  const [systemQuery, setSystemQuery] = useState("");
  const [focusSystem, setFocusSystem] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const outboxScope = useMemo(() => ({
    userId: snapshot.user_id,
    organizationId,
    boardId: snapshot.board?.is_default ? null : boardId,
    storage: window.localStorage,
  }), [snapshot.user_id, organizationId, boardId, snapshot.board?.is_default]);
  const [outbox, setOutbox] = useState(() => {
    try { return readReportOutbox(outboxScope); } catch { return []; }
  });
  const syncOutbox = useCallback(() => {
    try { setOutbox(readReportOutbox(outboxScope)); } catch { setOutbox([]); }
  }, [outboxScope]);
  const queueReport = useCallback((command) => {
    const entry = queueReportOutbox(outboxScope, command);
    syncOutbox();
    return entry;
  }, [outboxScope, syncOutbox]);
  const retryQueuedReport = useCallback(async (entry) => {
    try {
      await retryReportOutbox(outboxScope, entry, execute);
      setNotice("待发送上报已提交。");
    } catch (failure) {
      setError(failure.message);
    } finally {
      syncOutbox();
    }
  }, [outboxScope, execute, syncOutbox]);
  const discardQueuedReport = useCallback((entry) => {
    discardReportOutbox(outboxScope, entry.id);
    syncOutbox();
  }, [outboxScope, syncOutbox]);
  useEffect(() => syncOutbox(), [syncOutbox, snapshot.state_version]);
  const scopeVersion = snapshot.scope?.version;
  useEffect(() => {
    let active = true;
    setMapData(null);
    setMapError("");
    if (mobile) return;
    getTacticalMap(organizationId, boardId)
      .then((data) => {
        if (active) setMapData(data);
      })
      .catch((failure) => {
        if (active) setMapError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [organizationId, boardId, scopeVersion, mobile, mapAttempt]);
  const overview = useMemo(() => buildTacticalOverview({ forces: snapshot.forces, reports: snapshot.reports, role: snapshot.role,
    scope: overviewScope, systemIds: mapData ? new Set(mapData.systems.map(node => Number(node.system_id))) : null, now: currentServerTime }),
    [snapshot.forces, snapshot.reports, snapshot.role, overviewScope, mapData, currentServerTime]);
  const systemIntel = useMemo(() => latestSystemIntel(snapshot.reports), [snapshot.reports]);
  const selectedIntel = systemIntel.find(item => Number(item.system_id) === Number(selectedSystem?.id));
  const selectedHistory = snapshot.reports.filter(item => item.report_kind === 'system_count' && Number(item.system_id) === Number(selectedSystem?.id))
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at) || b.id - a.id);
  const selectedNode = mapData?.systems?.find(item => Number(item.system_id) === Number(selectedSystem?.id));
  const systemIds = useMemo(
    () =>
      new Set(
        (mapData?.systems || []).map((system) => Number(system.system_id)),
      ),
    [mapData],
  );
  // Keep map layout inputs stable when only list filters or local fields change.
  const filteredForces = useMemo(() => snapshot.forces.filter(
    (item) => sideFilter === "all" || item.side === sideFilter,
  ), [snapshot.forces, sideFilter]);
  const mapReports = useMemo(() => sideFilter === 'friendly' ? [] : snapshot.reports,
    [snapshot.reports, sideFilter]);
  const scopeLabel = item => {
    const inside = typeof item.in_scope === 'boolean' ? item.in_scope : mapData ? systemIds.has(Number(item.system_id)) : null;
    return inside === false ? '范围外' : inside === null ? '范围待确认' : '';
  };
  const forces = [...overview.enemy.forces, ...(overview.friendly?.forces || [])].filter(item => sideFilter === 'all' || item.side === sideFilter).filter((force) =>
    `${force.name} ${force.system_name} ${force.source_author_name || ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  ).sort((a,b) => (groupBy === 'system' ? a.system_name.localeCompare(b.system_name, 'zh-CN') : a.side.localeCompare(b.side)) || a.id - b.id);
  const countRows = sideFilter === 'friendly' ? [] : overview.enemy.systems.filter(row => row.report && `${row.systemName} ${row.report.author_name}`.toLowerCase().includes(query.toLowerCase()));
  const reports = snapshot.reports.filter(report => overviewScope === 'all' || (typeof report.in_scope === 'boolean' ? report.in_scope : systemIds.has(Number(report.system_id)))).filter((report) =>
    `${report.fleet_name || ''} ${report.system_name} ${report.author_name} ${report.notes}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const [forcePage, setForcePage] = useState(1);
  const [reportPage, setReportPage] = useState(1);
  useEffect(() => { setForcePage(1); setReportPage(1); }, [query, sideFilter, groupBy, overviewScope]);
  const forcePageData = paginateTacticalRows(forces, forcePage, mobile ? 12 : 24);
  const reportPageData = paginateTacticalRows(reports, reportPage, mobile ? 12 : 24);
  const visibleForces = forcePageData.items;
  const visibleReports = reportPageData.items;
  const force = snapshot.forces.find((item) => item.id === selectedForce);
  // Follow the selected fleet's identity without panning the user's camera.
  useEffect(() => {
    if (selectedForce == null) return;
    if (!force) { setSelectedForce(null); return; }
    setSelectedSystem(current => current && ({ id: force.system_id, name: force.system_name }));
  }, [selectedForce, force?.system_id, force?.system_name]);
  useEffect(() => {
    if ((collapsed && !mobile) || tab !== 'forces') return;
    const list = panelList.current;
    const target = selectedForce != null ? `[data-force-row-id="${Number(selectedForce)}"] .tac-force-main` : `[data-count-row-id="${Number(selectedSystem?.id)}"]`;
    const row = list?.querySelector(target);
    if (!row) return;
    const item = row.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }, [selectedForce, selectedSystem?.id, collapsed, mobile, tab, query]);
  useEffect(() => {
    if ((collapsed && !mobile) || tab !== 'reports' || selectedReportId == null) return;
    const row = panelList.current?.querySelector(`[data-report-row-id="${Number(selectedReportId)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedReportId, collapsed, mobile, tab, query]);
  const selectedFleets = filteredForces.filter(item => Number(item.system_id) === Number(selectedSystem?.id))
    .sort((a, b) => Number(b.id === selectedForce) - Number(a.id === selectedForce) || a.id - b.id);
  const selectedExits = useMemo(() => selectedSystem ? visibleGateExits(
    mapData?.systems, mapData?.stargates, mapData?.boundary_exits, [selectedSystem.id],
  ) : [], [mapData, selectedSystem]);
  const chooseSystem = (node) => {
    setSelectedForce(null);
    setTab('forces');
    setQuery('');
    setSystemDetailOpen(true);
    setSelectedSystem({
      id: node.system_id ?? node.id,
      name: systemDisplayName(node),
    });
  };
  const focusMapSystem = (node) => {
    chooseSystem(node);
    setFocusSystem({ ...node, _focusToken: Date.now() });
    setSystemQuery("");
  };
  const chooseForce = (item, focus = false) => {
    setSelectedForce(item.id);
    // Keep an already-open overview usable when its row or a map marker is
    // selected. The star detail takes the right context slot only on explicit
    // star selection or while the overview is collapsed.
    setSystemDetailOpen(collapsed);
    setSelectedSystem({ id: item.system_id, name: item.system_name });
    setTab("forces");
    if (!focus) setQuery('');
    if (focus) {
      const node = mapData?.systems?.find(node => Number(node.system_id) === Number(item.system_id));
      if (node) setFocusSystem({ ...node, _focusToken: Date.now() });
    }
  };
  const chooseCount = (row, focus = true) => {
    setSelectedForce(null);
    setSystemDetailOpen(collapsed);
    setSelectedSystem({ id: row.systemId, name: row.systemName });
    if (focus) {
      const node = mapData?.systems?.find(node => Number(node.system_id) === row.systemId);
      if (node) setFocusSystem({ ...node, _focusToken: Date.now() });
    }
  };
  const move = async (item, destination, kind = 'correction') => {
    if (moving) return;
    setMoving(true);
    setError("");
    try {
      await execute("force.move", {
        force_id: item.id,
        expected_version: item.version,
        destination_system_id: destination,
        kind,
        ...(kind === 'correction' ? { reason: '指挥通过星图拖拽调整部署位置' } : {}),
      });
      setNotice("部队位置已更新；观察时间未改变。");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setMoving(false);
    }
  };
  const canManageCount = useCallback(item => status === 'live' && !moving &&
    (can.manageForces || Number(item.author_id) === Number(snapshot.user_id)),
    [status, moving, can.manageForces, snapshot.user_id]);
  const moveCount = async (item, destination) => {
    if (!canManageCount(item)) return;
    setMoving(true);
    setError("");
    try {
      await execute('report.move', {report_id:item.id, expected_version:item.version, destination_system_id:destination});
      setNotice('人数上报位置已更正；观测时间未改变。');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setMoving(false);
    }
  };
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!error) return undefined;
    const timer = window.setTimeout(() => setError(""), 3600);
    return () => window.clearTimeout(timer);
  }, [error]);
  return (
    <section className={mobile ? "tac-board-mobile" : "tac-immersive"} aria-label="组织战术板">
      <div className="tac-command-bar">
        <div className="tac-command-identity">
          <div className="tac-command-title"><Crosshair size={20} /><h1>战术板</h1></div>
          {organizationControls}
          {connectionControls}
        </div>
        <div className="tac-command-links">
          {can.manageMembers ? <button type="button" className="tac-members-card" aria-label="人员管理" onClick={onOpenMembers}>
            <Users size={17} /><span>成员 {snapshot.member_count ?? '—'}<small>在线 {snapshot.online_count} / {snapshot.capacity || 100}</small></span>
          </button> : <div className="tac-members-card is-readonly"><Users size={16} /><span>在线 {snapshot.online_count}<small>协作成员 / {snapshot.capacity || 100}</small></span></div>}
          <Link className="tac-btn is-small" to="/starmap">星系导航 <ArrowUpRight size={14} /></Link>
          <button type="button" className="tac-icon-btn" aria-label="创建 / 加入组织" title="创建 / 加入组织" onClick={onOpenOrganization}><Plus size={18} /></button>
        </div>
      </div>
      <TacticalStrengthSummary overview={overview} scope={overviewScope} status={status} />
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
          <button type="button" className="tac-btn is-small" disabled={status !== 'live'}
            onClick={() => setMapAttempt(attempt => attempt + 1)}>重新加载星图</button>
        </p>
      )}
      </div>
      {outbox.length > 0 && <section className="tac-outbox" aria-label="待发送上报">
        <div className="tac-section-head"><strong>待发送上报</strong><span>{outbox.length} 条 · 仅保存在当前浏览器</span></div>
        {outbox.map(entry => <div className="tac-outbox-row" key={entry.id}>
          <span>{entry.payload?.people == null ? '人数未知' : `${entry.payload.people} 人`} · 星系 {entry.payload?.system_id || '未选'}<small>{entry.status === 'conflict' ? '需要重新核对' : entry.status === 'sending' ? '发送中' : entry.error || '等待重试'}</small></span>
          <div className="tac-row-actions"><button type="button" className="tac-btn is-small" disabled={entry.status === 'sending' || entry.status === 'conflict' || status !== 'live'} onClick={() => retryQueuedReport(entry)}>重试</button><button type="button" className="tac-text-btn" onClick={() => discardQueuedReport(entry)}>丢弃</button></div>
        </div>)}
      </section>}
      <div
        className={`tac-board-layout${collapsed && !mobile ? " is-panel-collapsed" : ""}${selectedSystem && (collapsed || systemDetailOpen) && !mobile ? " has-system-detail" : ""}`}
      >
        {!mobile && (
          <section className="tac-map-section">
            <CollaborationMap
              systems={mapData?.systems || []}
              stargates={mapData?.stargates || []}
              constellations={mapData?.constellations || []}
              scope={mapData?.scope || snapshot.scope}
              canEditScope={can.manageForces && status === "live"}
              onOpenScope={() => setDialog({ kind: "scope" })}
              boundaryExits={mapData?.boundary_exits || []}
              forces={filteredForces}
              reports={mapReports}
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
              onSelectReport={(report) => {
                setSelectedReportId(report.id);
                setTab("reports");
                setQuery(report.author_name || report.system_name || "");
                setCollapsed(false);
              }}
              onSelectCount={(report) => {
                // Resolve against the unfiltered source: a map selection must
                // still work when the overview search hides the matching row.
                const row = overview.enemy.systems.find(item => Number(item.report?.id) === Number(report.id)) ||
                  overview.enemy.systems.find(item => Number(item.systemId) === Number(report.system_id));
                if (row) chooseCount(row, false);
                setSelectedReportId(null);
                setQuery("");
                setTab("forces");
              }}
              onFocusReports={(node) => {
                setTab("reports");
                setQuery(systemDisplayName(node));
                setCollapsed(false);
              }}
              onMoveRejected={(reason) => setError(reason)}
              canMove={can.manageForces && status === "live" && !moving}
              onMoveForce={move}
              canArchiveForce={can.manageForces && status === "live"}
              onArchiveForce={force => setDialog({kind:'archive',initial:force})}
              canMoveCount={canManageCount}
              canWithdrawCount={canManageCount}
              onMoveCount={moveCount}
              onWithdrawCount={report=>setDialog({kind:'withdraw-count',initial:report})}
            >
              <div className="tac-map-controls" aria-label="星图工具">
                <label className="tac-search"><Search size={16} /><input aria-label="搜索当前星图" placeholder="查找当前星图的星系" value={systemQuery} onChange={(event) => setSystemQuery(event.target.value)} /></label>
                {systemQuery.trim() && <div className="tac-map-search-results">
                  {(mapData?.systems || []).filter((node) => `${node.zh_name || ""} ${node.name || ""}`.toLowerCase().includes(systemQuery.trim().toLowerCase())).slice(0, 8).map((node) => <button key={node.system_id} type="button" onClick={() => focusMapSystem(node)}><span>{node.zh_name || node.name}</span><small>{node.security_status == null ? "安等未知" : Number(node.security_status).toFixed(2)}</small></button>)}
                </div>}
                {can.manageForces && <div className="tac-side-filter" aria-label="部署阵营筛选">{[["all", "全部阵营"], ["enemy", "仅敌方"], ["friendly", "仅己方"]].map(([value, label]) => <button type="button" key={value} aria-pressed={sideFilter === value} onClick={() => setSideFilter(value)}>{label}</button>)}</div>}
              </div>
              {selectedSystem && (collapsed || systemDetailOpen) && (
                <section className="tac-system-detail" aria-label="星系敌情详情">
                  <header><div><small>星系敌情</small><h2>{selectedSystem.name}</h2></div><div className="tac-system-detail-actions">{collapsed && <button type="button" className="tac-system-back" aria-label="展开兵力总览" onClick={() => { setSystemDetailOpen(false); setCollapsed(false); }}><ChevronLeft size={14} />总览</button>}<button type="button" className="tac-icon-btn" aria-label="关闭星系详情" onClick={() => { setSelectedSystem(null); setSystemDetailOpen(false); }}><X size={17} /></button></div></header>
                  <div className="tac-system-fleets">
                    {selectedFleets.slice(0, 6).map(item => <div className={`tac-system-fleet-row is-${item.side}`} key={item.id}>
                      <button type="button" onClick={() => chooseForce(item)}><span>{item.name}</span><span>{item.people ?? '未知'}{item.people == null ? '' : '人'}</span></button>
                      <small>{item.source_author_name ? `${item.source_author_name} 上报` : '指挥录入'} · {ageLabel(item.observed_at, currentServerTime)}</small>
                      {item.side === 'enemy' && <button type="button" className="tac-text-btn" disabled={status !== 'live'} onClick={() => setDialog({kind:'report',selectedFleet:item})}>更新这支舰队</button>}
                      {item.id === selectedForce && <button type="button" className="tac-text-btn" onClick={() => { setCollapsed(false); setSystemDetailOpen(false); setTab('forces'); setQuery(''); }}>查看部署详情</button>}
                    </div>)}
                    {selectedFleets.length > 6 && <button type="button" className="tac-text-btn" onClick={() => { setCollapsed(false); setTab('forces'); setQuery(selectedSystem.name); }}>查看全部 {selectedFleets.length} 支舰队</button>}
                  </div>
                  {!selectedFleets.length && <p className="tac-muted">此星系暂无已标注舰队</p>}
                    <button className="tac-btn is-primary" type="button" disabled={status !== 'live'} onClick={() => setDialog({ kind: 'report', initialMode: 'new' })}><Plus size={16} />上报敌方舰队</button>
                  <div className="tac-system-count"><span>星系总人数</span><strong>{selectedIntel ? selectedIntel.people ?? '未知' : '未上报'}</strong>{selectedIntel?.people != null && <small>人</small>}
                    <span className="tac-system-security">安等 {selectedNode?.security_status == null ? '未知' : Number(selectedNode.security_status).toFixed(2)}</span>
                  </div>
                  {selectedIntel && <div className={`tac-system-source${isStale(selectedIntel.observed_at, currentServerTime) ? ' is-stale' : ''}`}>
                    <span>{selectedIntel.author_name} · {ageLabel(selectedIntel.observed_at, currentServerTime)}</span>
                    <time>{new Date(selectedIntel.observed_at).toLocaleString()}</time>
                    <ShipComposition ships={selectedIntel.ships} />
                  </div>}
                  <button className="tac-text-btn" type="button" disabled={status !== 'live'} onClick={() => setDialog({ kind: 'report',initialMode:'system_count' })}>更新星系总人数</button>
                  {selectedHistory.length > 0 && <details className="tac-system-history"><summary>上报记录 · {selectedHistory.length}</summary>{selectedHistory.map(row => <div key={row.id}><span>{row.author_name} · {row.people ?? '未知'}{row.people == null ? '' : ' 人'}{row.status==='withdrawn'?' · 已撤下':''}<small>{new Date(row.observed_at).toLocaleString()}</small></span>{row.author_id === snapshot.user_id && row.status!=='withdrawn' && <button type="button" className="tac-text-btn" disabled={status !== 'live'} onClick={() => setDialog({ kind: 'report', initial: row })}>修订</button>}</div>)}</details>}
                  {selectedExits.length > 0 && <details className="tac-system-exits"><summary>相邻星门 · {selectedExits.length}</summary>
                  <div className="tac-boundary-list">
                    <strong>{selectedSystem.name} · 相邻星门 <button type="button" className="tac-text-btn" aria-label="收起相邻星门" onClick={() => { setSelectedSystem(null); setSystemDetailOpen(false); }}>收起</button></strong>
                    {selectedExits.map((exit) => (
                        <div key={exit.destination_system_id}>
                          <span>
                            {exit.destination_name} <small>{exit.loaded ? "已加载" : "当前加载范围外"}</small>
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
                                  move(force, exit.destination_system_id, 'gate_move')
                                }
                              >
                                移动至此 <ArrowUpRight size={13} />
                              </button>
                            )}
                        </div>
                      ))}
                  </div>
                  </details>}
                </section>
                )}
            </CollaborationMap>
            {collapsed && <button className="tac-panel-reopen tac-btn" type="button" aria-label="展开兵力总览" onClick={() => { setSystemDetailOpen(false); setCollapsed(false); }}><ChevronLeft size={16} />兵力总览</button>}
          </section>
        )}
        {(!collapsed || mobile) && (
          <aside className="tac-side-panel" aria-label="兵力总览与上报记录">
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
                aria-label="兵力总览"
                aria-pressed={tab === "forces"}
                onClick={() => setTab("forces")}
              >
                兵力总览
              </button>
              <button
                type="button"
                aria-label="上报记录"
                aria-pressed={tab === "reports"}
                onClick={() => setTab("reports")}
              >
                上报记录<span>{reports.length}</span>
              </button>
              {!mobile && <button type="button" className="tac-icon-btn tac-panel-collapse" aria-label="收起兵力总览" onClick={() => setCollapsed(true)}><ChevronRight size={17} /></button>}
            </div>
            <div className="tac-overview-options">
              <div className="tac-overview-scope" role="group" aria-label="统计范围">{[['current','当前战区'],['all','组织全部']].map(([value,label])=><button type="button" key={value} aria-pressed={overviewScope === value} onClick={()=>setOverviewScope(value)}>{label}</button>)}</div>
              {tab === 'forces' && <button type="button" className="tac-text-btn" onClick={()=>setGroupBy(groupBy === 'side' ? 'system' : 'side')}>{groupBy === 'side' ? '按星系分组' : '按阵营分组'}</button>}
            </div>
            {overviewScope === 'current' && overview.outsideCount > 0 && <p className="tac-overview-hint">另有 {overview.outsideCount} 条范围外记录</p>}
            {overviewScope === 'current' && overview.scopeUnknown > 0 && <p className="tac-overview-hint">{overview.scopeUnknown} 条记录范围待确认，未计入</p>}
            <label className="tac-search">
              <Search size={16} />
              <input
                aria-label="搜索部署或上报记录"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="部队、星系或上报者"
              />
            </label>
            <div className="tac-panel-list" ref={panelList}>
              {tab === 'forces' && <p className="tac-overview-method">敌方逐星系统计：人数上报优先；无人数上报时取舰队合计，两者不相加。{overview.enemy.systems.filter(row => row.source === 'system_report').length} 个星系取人数上报，{overview.enemy.systems.filter(row => row.source === 'fleets').length} 个星系取舰队合计。</p>}
              {tab === "forces" ? (
                <>
                  {countRows.length > 0 && <section className="tac-count-list" aria-label="星系人数上报"><h3>人数上报 <small>每个星系仅取最新记录</small></h3>{countRows.map(row=><button type="button" className={`tac-count-row${Number(selectedSystem?.id) === row.systemId ? ' is-selected' : ''}${row.stale ? ' is-stale' : ''}`} key={row.systemId} data-count-row-id={row.systemId} onClick={()=>chooseCount(row)}><span>{row.systemName}{scopeLabel(row.report) && <em>{scopeLabel(row.report)}</em>}<small>{row.report.author_name} · {ageLabel(row.observedAt,currentServerTime)}{row.stale ? ' · 待复核' : ''}</small></span><span>{row.people ?? '未知'}{row.people == null ? '' : '人'}</span></button>)}</section>}
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
                    visibleForces.map((item, index) => (
                      <article
                        key={item.id}
                        data-force-row-id={item.id}
                        className={`tac-force-card is-${item.side}${item.id === selectedForce ? " is-selected" : ""}`}
                      >
                        {(index === 0 || (groupBy === 'side' ? visibleForces[index-1].side !== item.side : visibleForces[index-1].system_id !== item.system_id)) && <h3 className="tac-fleet-group-title">{groupBy === 'system' ? item.system_name : item.side === 'enemy' ? '敌方舰队' : '己方舰队'}</h3>}
                        <button
                          type="button"
                          className="tac-force-main"
                          onClick={() => chooseForce(item, true)}
                        >
                          <span className="tac-force-title">
                            <span className={`tac-side-badge is-${item.side}`}>
                              {item.side === "friendly" ? "己方" : "敌方"}
                            </span>
                            <strong>{item.name}</strong>
                          </span>
                          <span className="tac-force-location">
                            {item.system_name}
                            {scopeLabel(item) && (
                                <small>{scopeLabel(item)}</small>
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
                          <span className="tac-fleet-source">{item.source_author_name ? `${item.source_author_name} 上报` : '指挥录入'}</span>
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
                            {item.side === 'enemy' && <button type="button" className="tac-btn is-small" disabled={status !== 'live'} onClick={() => setDialog({kind:'report',selectedFleet:item})}>更新这支舰队</button>}
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
                      <strong>暂无已标注舰队</strong>
                      <p>只知道敌方人数也可直接上报，无需填写舰队名称。</p>
                    </div>
                  )}
                </>
              ) : reports.length ? (
                visibleReports.map((item) => (
                  <article className={`tac-report-card${Number(selectedReportId) === Number(item.id) ? ' is-selected' : ''}`} data-report-row-id={item.id} key={item.id}>
                    <div className="tac-section-head">
                      <strong>{item.fleet_name || item.system_name}</strong>
                      <span className="tac-badge">
                        {item.report_kind === 'system_count' ? '星系人数' : item.report_kind === 'fleet_intel' ? (item.is_current ? '当前估计' : '历史观察') : REPORT_LABELS[item.status]}
                      </span>
                    </div>
                    {item.report_kind === 'fleet_intel' && <small>{item.system_name} · 舰队 #{item.force_id}</small>}
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
                      {can.manageForces && !['system_count','fleet_intel'].includes(item.report_kind) && item.status !== "confirmed" && (
                        <button
                          type="button"
                          className="tac-btn is-small is-primary"
                          title="旧版舰队线索：可选采纳为独立部署或关联已有部署，不与星系总人数相加"
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
                  <strong>暂无上报记录</strong>
                  <p>一次上报即可同步给组织内成员，己方部署仅指挥层可见。</p>
                </div>
              )}
            </div>
            {(tab === 'forces' ? forcePageData.pageCount : reportPageData.pageCount) > 1 && <nav className="tac-pager" aria-label="列表分页">
              <button type="button" className="tac-btn is-small" disabled={(tab === 'forces' ? forcePageData.page : reportPageData.page) <= 1}
                onClick={() => tab === 'forces' ? setForcePage(page => Math.max(1, page - 1)) : setReportPage(page => Math.max(1, page - 1))}>上一页</button>
              <span>第 {tab === 'forces' ? forcePageData.page : reportPageData.page} / {tab === 'forces' ? forcePageData.pageCount : reportPageData.pageCount} 页 · 共 {tab === 'forces' ? forcePageData.total : reportPageData.total} 条</span>
              <button type="button" className="tac-btn is-small" disabled={(tab === 'forces' ? forcePageData.page : reportPageData.page) >= (tab === 'forces' ? forcePageData.pageCount : reportPageData.pageCount)}
                onClick={() => tab === 'forces' ? setForcePage(page => Math.min(forcePageData.pageCount, page + 1)) : setReportPage(page => Math.min(reportPageData.pageCount, page + 1))}>下一页</button>
            </nav>}
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
          手机端提供上报记录查看与快速上报，不加载星图。
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
          forces={snapshot.forces}
          selectedFleet={dialog.selectedFleet}
          initialMode={dialog.initialMode}
          selectedSystem={selectedSystem}
          execute={execute}
          onClose={() => setDialog(null)}
          onSuccess={setNotice}
          onQueue={queueReport}
          onRefresh={refresh}
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
      {dialog?.kind === 'withdraw-count' && <WithdrawCount report={dialog.initial} execute={execute}
        onClose={()=>setDialog(null)} onSuccess={setNotice}/>}
    </section>
  );
}
