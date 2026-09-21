import { useRef, useState } from "react";
import { newRequestId } from "../../services/apiTacticalCollaboration";
import {
  localDateTime,
  reportPayload,
  SHIP_TYPES,
} from "../../utils/tacticalCollaboration";
import {
  ShipComposition,
  SystemPicker,
  TacticalDialog,
  TacticalSelect,
} from "./TacticalControls";

export default function TacticalReportForm({
  organizationId,
  initial = null,
  selectedSystem,
  kind = "report",
  side = "enemy",
  execute,
  onClose,
  onSuccess,
}) {
  const [location, setLocation] = useState(
    initial
      ? { id: initial.system_id, name: initial.system_name }
      : selectedSystem,
  );
  const [draft, setDraft] = useState({
    name: initial?.name || "",
    side: initial?.side || side,
    people: initial?.people ?? "",
    ships: initial?.ships || {},
    notes: initial?.notes || "",
    observed_at: localDateTime(initial?.observed_at || new Date()),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(null);
  const set = (field, value) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const title =
    kind === "force"
      ? initial
        ? "修改部署"
        : side === "friendly"
          ? "添加己方部署"
          : "添加敌方部署"
      : initial
        ? "修改我的上报"
        : "快速上报";
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const content = reportPayload({ ...draft, system_id: location?.id });
      const payload = {
        ...content,
        ...(kind === "force"
          ? { name: draft.name.trim(), side: draft.side }
          : {}),
        ...(initial
          ? {
              [kind === "force" ? "force_id" : "report_id"]: initial.id,
              expected_version: initial.version,
            }
          : {}),
      };
      if (kind === "force" && !draft.name.trim())
        throw new Error("请填写部队名称。");
      const serialized = JSON.stringify(payload);
      // Preserve the id only for retries of the identical user command.
      if (request.current?.serialized !== serialized)
        request.current = { serialized, id: newRequestId() };
      await execute(`${kind}.${initial ? "update" : "create"}`, payload, {
        requestId: request.current.id,
      });
      onSuccess(
        kind === "report"
          ? initial
            ? "上报修订已提交"
            : "上报已提交"
          : "部署已保存",
      );
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <TacticalDialog title={title} onClose={onClose}>
      <form className="tac-form" onSubmit={submit}>
        <p className="tac-muted">
          人数与舰船数分别填写。留空表示未知，填写 0 表示确认没有。
        </p>
        {initial && kind === "report" && initial.status !== "pending" && (
          <p className="tac-notice">
            此上报已被指挥采用，修订不会直接覆盖已确认的部署，指挥需重新核对。
          </p>
        )}
        {kind === "force" && (
          <div className="tac-form-grid">
            <label className="tac-field">
              <span>部队名称</span>
              <input
                required
                maxLength={80}
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </label>
            <div className="tac-field">
              <span>部署阵营</span>
              <TacticalSelect
                label="部署阵营"
                value={draft.side}
                options={[
                  { value: "enemy", label: "敌方部署" },
                  { value: "friendly", label: "己方部署" },
                ]}
                onChange={(value) => set("side", value)}
              />
            </div>
          </div>
        )}
        <SystemPicker
          organizationId={organizationId}
          value={location}
          onChange={setLocation}
        />
        <div className="tac-form-grid">
          <label className="tac-field">
            <span>
              {kind === "force" && draft.side === "friendly"
                ? "己方人数"
                : "敌方人数"}
            </span>
            <input
              inputMode="numeric"
              type="number"
              min="0"
              max="1000000"
              step="1"
              placeholder="未知"
              value={draft.people}
              onChange={(event) => set("people", event.target.value)}
            />
          </label>
          <label className="tac-field">
            <span>观察时间</span>
            <input
              type="datetime-local"
              required
              value={draft.observed_at}
              onChange={(event) => set("observed_at", event.target.value)}
            />
          </label>
        </div>
        <fieldset className="tac-field">
          <legend>
            舰船构成 <small>仅填写已确认的数量</small>
          </legend>
          <div className="tac-ship-grid">
            {Object.entries(SHIP_TYPES).map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  inputMode="numeric"
                  placeholder="未知"
                  value={draft.ships[key] ?? ""}
                  onChange={(event) =>
                    set("ships", { ...draft.ships, [key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
        <label className="tac-field">
          <span>情报备注</span>
          <textarea
            maxLength={1000}
            rows={3}
            placeholder="方向、舰队标识、观察依据等"
            value={draft.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </label>
        {error && (
          <p className="tac-error" role="alert">
            {error}
          </p>
        )}
        <div className="tac-form-footer">
          <button type="button" className="tac-btn" onClick={onClose}>
            取消
          </button>
          <button className="tac-btn is-primary" disabled={busy}>
            {busy
              ? "提交中…"
              : kind === "report"
                ? initial
                  ? "保存修订"
                  : "提交上报"
                : "保存部署"}
          </button>
        </div>
      </form>
    </TacticalDialog>
  );
}

export function ConfirmReport({ report, forces, execute, onClose, onSuccess }) {
  const [name, setName] = useState(`${report.system_name} · 敌方舰队`);
  // Pin the target actually reviewed. A live snapshot must not silently advance
  // the CAS version while the commander is deciding whether to replace it.
  const [target, setTarget] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const force = target;
      if (report.status === "corrected" && !force)
        throw new Error("修订情报须明确关联已有部队，不能重复建立部署。");
      await execute("report.confirm", {
        report_id: report.id,
        expected_version: report.version,
        name: name.trim(),
        ...(force
          ? { force_id: force.id, force_expected_version: force.version }
          : {}),
      });
      onSuccess("情报已确认");
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <TacticalDialog title="确认敌方部署" onClose={onClose}>
      <form className="tac-form" onSubmit={submit}>
        <p className="tac-notice">
          同一支部队的多次目击不能相加。关联已有部队会替换该部队当前估计，请先核对。
        </p>
        <div className="tac-field">
          <span>确认方式</span>
          <TacticalSelect
            label="确认方式"
            value={
              target?.id || (report.status === "corrected" ? "choose" : "new")
            }
            onChange={(value) =>
              setTarget(
                forces.find((item) => String(item.id) === String(value)) ||
                  null,
              )
            }
            options={[
              ...(report.status === "corrected"
                ? []
                : [{ value: "new", label: "建立新敌方部署" }]),
              ...forces
                .filter((force) => force.side === "enemy")
                .map((force) => ({
                  value: force.id,
                  label: `关联：${force.name} · ${force.system_name}`,
                })),
            ]}
          />
        </div>
        <label className="tac-field">
          <span>部队名称</span>
          <input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {target && (
          <p className="tac-notice">
            将替换「{target.name}」当前估计：{target.people ?? "未知"} 人 ·{" "}
            {target.system_name} · 版本 {target.version}
            。新快照不会自动改写本次核对基准。
          </p>
        )}
        <p className="tac-muted">
          {report.system_name} · {report.people ?? "未知"} 人 · 上报者{" "}
          {report.author_name}
        </p>
        <ShipComposition ships={report.ships} includeUnknown />
        <p className="tac-muted">
          观察时间：{new Date(report.observed_at).toLocaleString()}
        </p>
        {report.notes && <p className="tac-report-notes">{report.notes}</p>}
        {error && (
          <p className="tac-error" role="alert">
            {error}
          </p>
        )}
        <div className="tac-form-footer">
          <button type="button" className="tac-btn" onClick={onClose}>
            取消
          </button>
          <button className="tac-btn is-primary" disabled={busy}>
            确认部署
          </button>
        </div>
      </form>
    </TacticalDialog>
  );
}

export function MoveForce({
  force,
  organizationId,
  execute,
  onClose,
  onSuccess,
}) {
  const [destination, setDestination] = useState(null);
  const [kind, setKind] = useState("gate_move");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!destination) return setError("请选择目标星系。");
    setBusy(true);
    try {
      await execute("force.move", {
        force_id: force.id,
        expected_version: force.version,
        destination_system_id: destination.id,
        kind,
        ...(kind === "correction" ? { reason: reason.trim() } : {}),
      });
      onSuccess("部队位置已更新，原观察时间保持不变");
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <TacticalDialog title="移动部队" onClose={onClose}>
      <form className="tac-form" onSubmit={submit}>
        <p className="tac-muted">
          {force.name} · 当前位于 {force.system_name}。人数与舰船构成保持不变。
        </p>
        <TacticalSelect
          label="移动方式"
          value={kind}
          onChange={setKind}
          options={[
            { value: "gate_move", label: "通过相邻星门" },
            { value: "correction", label: "人工纠正位置（须说明原因）" },
          ]}
        />
        <SystemPicker
          organizationId={organizationId}
          value={destination}
          onChange={setDestination}
          label="搜索目标星系"
        />
        {kind === "correction" && (
          <label className="tac-field">
            <span>纠正原因</span>
            <textarea
              required
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
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
            确认移动
          </button>
        </div>
      </form>
    </TacticalDialog>
  );
}

export function ArchiveForce({ force, execute, onClose, onSuccess }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const archive = async () => {
    setBusy(true);
    setError("");
    try {
      await execute("force.archive", {
        force_id: force.id,
        expected_version: force.version,
      });
      onSuccess("部署已归档，历史上报仍保留。");
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <TacticalDialog title="归档部署" onClose={onClose}>
      <p>
        确认将「{force.name}
        」从当前部署中归档？适用于已撤离、解散或失去战术意义的部队。原始上报与审计记录仍保留。
      </p>
      {error && (
        <p role="alert" className="tac-error">
          {error}
        </p>
      )}
      <div className="tac-form-footer">
        <button type="button" className="tac-btn" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="tac-btn is-primary"
          disabled={busy}
          onClick={archive}
        >
          {busy ? "归档中…" : "确认归档"}
        </button>
      </div>
    </TacticalDialog>
  );
}
