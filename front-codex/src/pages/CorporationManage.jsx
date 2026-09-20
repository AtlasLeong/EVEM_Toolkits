import { useContext, useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  Check,
  ChevronRight,
  ImagePlus,
  LockKeyhole,
  Plus,
  Save,
  Send,
  X,
} from "lucide-react";
import { AuthContext } from "../context/AuthContext";
import {
  EmptyState,
  LoadingBar,
  PageHeader,
  Panel,
} from "../components/ui/Primitives";
import {
  ACTIVITIES,
  BENEFITS,
  CORPORATION_TYPES,
  REGION_TAGS,
  createCorporationClaim,
  createCorporationDraft,
  getCorporationManagement,
  getMyCorporations,
  saveCorporationDraft,
  submitCorporationDraft,
  uploadCorporationMedia,
  withdrawCorporationDraft,
} from "../services/apiCommunity";
import {
  CommunityError,
  CommunityGuest,
  CommunityNav,
  CorporationImage,
  Pagination,
  RevisionStatus,
  useCommunityAction,
  useIdempotencyKey,
  usePrivateCommunity,
} from "../components/community/CorporationUI";
import PosterDialog from "../components/community/PosterDialog";
import CorporationLocation from "../components/community/CorporationLocation";
import CorporationSelect from "../components/community/CorporationSelect";
import CorporationShare from "../components/community/CorporationShare";
import CorporationCover from "../components/community/CorporationCover";
import { normalizePosterBackground } from "../utils/corporationPoster";
import {
  activityKind,
  LEGACY_EVENT_FIELDS,
  normalizeCustomActivityTags,
  validateCustomActivityTags,
  CUSTOM_TAG_LIMIT,
  CUSTOM_TAG_LENGTH,
} from "../utils/corporationActivity.js";
import "../styles/corporations.css";

const textFields = {
  tagline: "",
  introduction: "",
  alliance: "",
  base_region: "",
  active_time: "",
  recruitment_status: "open",
  requirements: "",
  benefits: "",
  benefits_note: "",
  public_contact: "",
  activity_description: "",
  event_title: "",
  event_time: "",
  event_location: "",
  event_description: "",
};
export const contentFromRevision = (revision) => ({
  ...textFields,
  ...Object.fromEntries(
    Object.keys(textFields).map((k) => [k, revision?.[k] ?? textFields[k]]),
  ),
  activities: revision?.activities || [],
  custom_activity_tags: normalizeCustomActivityTags(
    revision?.custom_activity_tags,
  ),
  activity_content_kind: activityKind(revision),
  corp_types: revision?.corp_types || [],
  region_tags: revision?.region_tags || [],
  benefit_keys: revision?.benefit_keys || [],
  benefits_note: revision?.benefits_note || "",
  poster_background: normalizePosterBackground(revision?.poster_background),
  base_location: revision?.base_location || null,
  logo_asset_id: revision?.logo_asset_id ?? null,
  cover_asset_id: revision?.cover_asset_id ?? null,
  logo_url: revision?.logo_url || null,
  cover_url: revision?.cover_url || null,
});
const payloadFromForm = (form) => ({
  ...Object.fromEntries(
    Object.entries(form).filter(
      ([key]) =>
        !["logo_url", "cover_url", "activity_content_kind"].includes(key) &&
        !Object.hasOwn(LEGACY_EVENT_FIELDS, key),
    ),
  ),
  base_location: form.base_location
    ? {
        region_id: String(form.base_location.region_id),
        constellation_id: form.base_location.constellation_id
          ? String(form.base_location.constellation_id)
          : null,
        solarsystem_id: form.base_location.solarsystem_id
          ? String(form.base_location.solarsystem_id)
          : null,
      }
    : null,
});

export default function CorporationManagePage() {
  const { isAuthenticated, userInfo } = useContext(AuthContext);
  return (
    <div className="corp-page">
      <PageHeader
        title="我的军团"
        subtitle="一次完善资料，拥有军团主页与三款宣传海报。"
      />
      <CommunityNav />
      {isAuthenticated ? (
        <Management key={userInfo?.userId || userInfo?.userName} />
      ) : (
        <CommunityGuest />
      )}
    </div>
  );
}

function Management() {
  const { prefix, refresh } = usePrivateCommunity();
  const [params, setParams] = useSearchParams();
  const selected = params.get("id");
  const [showClaim, setShowClaim] = useState(false);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [...prefix, "mine", page],
    queryFn: () => getMyCorporations(page),
    retry: 1,
    gcTime: 0,
  });
  return (
    <>
      <div className="corp-management-toolbar">
        <p>
          <LockKeyhole size={16} />
          先核实管理者，再审核公开资料。
        </p>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => setShowClaim((v) => !v)}
        >
          {showClaim ? <X size={16} /> : <Plus size={16} />}申请创建 / 认领
        </button>
      </div>
      {showClaim && <ClaimForm onSaved={refresh} />}
      {query.isPending ? (
        <LoadingBar />
      ) : query.isError ? (
        <CommunityError error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          {!query.data.corporations.length &&
            !query.data.claims.length &&
            !showClaim && (
              <EmptyState
                title="还没有管理的军团"
                desc="点击“申请创建 / 认领”，填写军团名称与验证说明。通过后即可编辑主页。"
              />
            )}
          {query.data.corporations.length > 0 && (
            <div className="corp-owned-list">
              {query.data.corporations.map((corp) => (
                <button
                  key={corp.id}
                  type="button"
                  className={String(corp.id) === selected ? "active" : ""}
                  onClick={() => {
                    setParams({ id: corp.id });
                    setShowClaim(false);
                  }}
                >
                  <span className="corp-owned-mark">
                    {corp.short_name || corp.name.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{corp.name}</strong>
                    <small>
                      {corp.is_listed === false
                        ? "已下架 · 请联系管理员"
                        : "资料与海报"}
                    </small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          )}
          {query.data.claims.length > 0 && (
            <Panel className="corp-claims" title="归属申请记录">
              {query.data.claims.map((claim) => (
                <div className="corp-claim-row" key={claim.id}>
                  <div>
                    <strong>{claim.corporation?.name || claim.name}</strong>
                    <p>
                      {claim.review_reason ||
                        "管理员会根据说明核实军团管理权限，验证联系方式不会公开。"}
                    </p>
                  </div>
                  <RevisionStatus value={claim.status} />
                </div>
              ))}
            </Panel>
          )}
          <Pagination
            page={page}
            count={Math.max(
              query.data.claims_count || 0,
              query.data.corporations_count || 0,
            )}
            change={setPage}
          />
        </>
      )}
      {selected && (
        <ManagedCorporation
          key={selected}
          id={selected}
          prefix={prefix}
          refresh={refresh}
        />
      )}
    </>
  );
}

function ClaimForm({ onSaved }) {
  const [form, setForm] = useState({
    name: "",
    short_name: "",
    statement: "",
    contact: "",
  });
  const action = useCommunityAction();
  const keyFor = useIdempotencyKey();
  const change = (e) =>
    setForm((v) => ({ ...v, [e.target.name]: e.target.value }));
  return (
    <Panel
      title="申请创建 / 认领"
      subtitle="已有同名且尚未认领的军团会提交认领申请；不能通过申请接管他人的军团。"
    >
      <form
        className="corp-form"
        onSubmit={(e) => {
          e.preventDefault();
          const payload = Object.fromEntries(
            Object.entries(form).map(([k, v]) => [k, v.trim()]),
          );
          action.run(async () => {
            await createCorporationClaim({
              ...payload,
              request_id: keyFor(payload),
            });
            await onSaved();
          }, "申请已提交，请等待管理员核实。");
        }}
      >
        <div className="corp-two-fields">
          <label>
            军团名称
            <input
              className="text-input"
              name="name"
              value={form.name}
              onChange={change}
              required
              maxLength={80}
              placeholder="请填写游戏内完整名称"
            />
          </label>
          <label>
            军团简称
            <input
              className="text-input"
              name="short_name"
              value={form.short_name}
              onChange={change}
              maxLength={20}
              placeholder="例如 VOY"
            />
          </label>
        </div>
        <label>
          申请说明
          <textarea
            className="text-input"
            name="statement"
            value={form.statement}
            onChange={change}
            rows={3}
            maxLength={1000}
            required
            placeholder="说明你的游戏角色、军团职务，以及如何核实管理权限。请勿填写密码。"
          />
        </label>
        <label>
          验证联系方式
          <input
            className="text-input"
            name="contact"
            value={form.contact}
            onChange={change}
            maxLength={200}
            required
            placeholder="仅你与管理员可见，不会展示在军团主页"
          />
        </label>
        <CommunityError error={action.error} />
        {action.message && (
          <p className="corp-success" role="status">
            <Check size={16} />
            {action.message}
          </p>
        )}
        <div className="corp-form-actions">
          <p className="corp-hint">
            申请通过后，再完善公开资料并提交内容审核。
          </p>
          <button type="submit" className="primary-btn" disabled={action.busy}>
            <Send size={16} />
            {action.busy ? "提交中…" : "提交申请"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function ManagedCorporation({ id, prefix, refresh }) {
  const query = useQuery({
    queryKey: [...prefix, "manage", id],
    queryFn: () => getCorporationManagement(id),
    retry: 1,
    gcTime: 0,
  });
  if (query.isPending) return <LoadingBar />;
  if (query.isError)
    return <CommunityError error={query.error} retry={() => query.refetch()} />;
  return (
    <DraftEditor
      key={query.data.working_revision?.id || "new"}
      corporation={query.data}
      revision={query.data.working_revision}
      refresh={refresh}
    />
  );
}

function DraftEditor({ corporation, revision, refresh }) {
  const [current, setCurrent] = useState(revision);
  const [form, setForm] = useState(() => contentFromRevision(revision));
  const [tab, setTab] = useState("profile");
  const [uploading, setUploading] = useState(false);
  const [showPoster, setShowPoster] = useState(false);
  const [customTagDraft, setCustomTagDraft] = useState("");
  const [tagError, setTagError] = useState("");
  const customTagId = useId();
  const action = useCommunityAction();
  const keyFor = useIdempotencyKey();
  const editorBusy = action.busy || uploading;
  useEffect(() => {
    setCurrent(revision);
    setForm(contentFromRevision(revision));
    setCustomTagDraft("");
    setTagError("");
  }, [revision?.id, revision?.version, revision?.status]);
  const editable = corporation.can_edit && current?.status === "draft";
  const pending = current?.status === "pending";
  const change = (e) =>
    setForm((value) => ({ ...value, [e.target.name]: e.target.value }));
  const create = () =>
    action.run(async () => {
      await createCorporationDraft(
        corporation.id,
        keyFor({
          id: corporation.id,
          revision: current?.id,
          version: current?.version,
          status: current?.status,
        }),
      );
      await refresh();
    });
  const save = async () => {
    if (uploading) throw new Error("请等待图片上传完成后再保存");
    if ([...form.activity_description].length > 1500)
      throw new Error("主要活动介绍最多 1500 字，请精简后再保存。");
    // Include text still in the tag input, so saving cannot silently discard it.
    const customTags = validateCustomActivityTags([
      ...form.custom_activity_tags,
      ...(customTagDraft ? [customTagDraft] : []),
    ]);
    const result = await saveCorporationDraft(current.id, {
      expected_version: current.version,
      ...payloadFromForm(form),
      custom_activity_tags: customTags,
    });
    setCurrent(result);
    setForm(contentFromRevision(result));
    setCustomTagDraft("");
    setTagError("");
    return result;
  };
  const submit = () =>
    action.run(async () => {
      const saved = await save();
      const result = await submitCorporationDraft(saved.id, saved.version);
      setCurrent(result);
      await refresh();
    }, "已提交审核，公开内容将在通过后更新。");
  const input = (name, label, max, rows = 0, placeholder = "") => (
    <label>
      {label}
      {rows ? (
        <textarea
          className={`text-input corp-textarea${rows >= 6 ? " is-large" : rows <= 3 ? " is-compact" : ""}`}
          aria-label={label}
          name={name}
          value={form[name]}
          onChange={change}
          maxLength={name === "activity_description" ? undefined : max}
          aria-invalid={
            name === "activity_description" &&
            [...form.activity_description].length > max
              ? true
              : undefined
          }
          aria-describedby={
            name === "activity_description"
              ? `${customTagId}-activity-hint`
              : undefined
          }
          rows={rows}
          disabled={!editable || editorBusy}
          placeholder={placeholder}
        />
      ) : (
        <input
          className="text-input"
          name={name}
          value={form[name]}
          onChange={change}
          maxLength={max}
          disabled={!editable || editorBusy}
          placeholder={placeholder}
        />
      )}
    </label>
  );
  const addCustomTag = () => {
    try {
      const custom_activity_tags = validateCustomActivityTags([
        ...form.custom_activity_tags,
        customTagDraft,
      ]);
      setForm((value) => ({ ...value, custom_activity_tags }));
      setCustomTagDraft("");
      setTagError("");
    } catch (error) {
      setTagError(error.message);
    }
  };
  const toggle = (field, id, max) =>
    setForm((value) => {
      const selected = value[field] || [];
      if (selected.includes(id))
        return { ...value, [field]: selected.filter((item) => item !== id) };
      if (selected.length >= max) return value;
      return { ...value, [field]: [...selected, id] };
    });
  const optionGroup = (field, label, options, max) => (
    <fieldset
      className="corp-option-group"
      disabled={!editable || action.busy}
      aria-label={label}
    >
      <legend>
        {label} <small>最多 {max} 项</small>
      </legend>
      <div className="corp-option-grid">
        {Object.entries(options).map(([id, option]) => {
          const checked = (form[field] || []).includes(id);
          return (
            <label key={id} className={checked ? "is-selected" : ""}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && (form[field] || []).length >= max}
                onChange={() => toggle(field, id, max)}
              />
              {option}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
  return (
    <div className="corp-editor-section">
      <div className="corp-editor-heading">
        <div>
          <span className="corp-eyebrow">YOUR CORPORATION</span>
          <h2>{corporation.name}</h2>
        </div>
        <div className="corp-inline-actions">
          {current && <RevisionStatus value={current.status} />}
          {corporation.published_revision && corporation.is_listed && (
            <>
              <Link
                to={`/corporations/${corporation.id}`}
                className="ghost-btn"
              >
                查看公开主页
              </Link>
              <CorporationShare id={corporation.id} />
            </>
          )}
          {current && (
            <button
              type="button"
              className="primary-btn"
              onClick={() => setShowPoster(true)}
              disabled={editorBusy}
            >
              <ImagePlus size={16} />
              制作海报
            </button>
          )}
        </div>
      </div>
      {pending && (
        <p className="corp-notice">审核中，公开页面仍展示上次通过的版本。</p>
      )}
      {current?.review_reason && (
        <p className="corp-notice">审核意见：{current.review_reason}</p>
      )}
      <CommunityError error={action.error} />
      {action.message && (
        <p className="corp-success" role="status">
          <Check size={16} />
          {action.message}
        </p>
      )}
      {!current ? (
        <Panel
          title="从第一份资料开始"
          subtitle="保存草稿仅自己可见，提交审核通过后才会公开。"
        >
          <button
            type="button"
            className="primary-btn"
            onClick={create}
            disabled={action.busy || !corporation.can_edit}
          >
            创建资料草稿
          </button>
        </Panel>
      ) : (
        <div className="corp-editor-layout">
          <div className="corp-editor-main">
            <Panel className="corp-editor-panel">
              <div
                className="corp-editor-tabs"
                role="group"
                aria-label="编辑区域"
              >
                {[
                  ["profile", "基本资料"],
                  ["recruitment", "招募信息"],
                  ["event", "主要活动"],
                ].map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    className={tab === id ? "active" : ""}
                    disabled={editorBusy}
                    aria-pressed={tab === id}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="corp-form">
                {tab === "profile" && (
                  <>
                    <div className="corp-editor-intro">
                      <h3>先让飞行员认识你们</h3>
                      <p>
                        名称与简称来自已核实的归属申请。介绍与图片会用于军团主页。
                      </p>
                    </div>
                    {input(
                      "tagline",
                      "军团口号",
                      80,
                      0,
                      "一句话介绍你们的共同追求",
                    )}
                    {input(
                      "introduction",
                      "军团介绍",
                      5000,
                      6,
                      "介绍军团的故事、风格与日常活动（提交审核时必填）",
                    )}
                    {input("alliance", "所属联盟", 80)}
                    <CorporationLocation
                      value={form.base_location}
                      legacy={form.base_region}
                      disabled={!editable || editorBusy}
                      onLegacyChange={(base_region) =>
                        setForm((value) => ({ ...value, base_region }))
                      }
                      onChange={(base_location) =>
                        setForm((value) => ({
                          ...value,
                          base_location,
                          base_region:
                            base_location?.region_name ||
                            (value.base_location ? "" : value.base_region),
                        }))
                      }
                    />
                    {optionGroup(
                      "corp_types",
                      "军团类型",
                      CORPORATION_TYPES,
                      2,
                    )}
                    {optionGroup("region_tags", "活动区域", REGION_TAGS, 3)}
                    <fieldset
                      className="corp-activities"
                      disabled={!editable || editorBusy}
                    >
                      <legend>活动方向</legend>
                      {Object.entries(ACTIVITIES).map(([id, label]) => (
                        <label key={id}>
                          <input
                            type="checkbox"
                            checked={form.activities.includes(id)}
                            onChange={(e) =>
                              setForm((value) => ({
                                ...value,
                                activities: e.target.checked
                                  ? [...value.activities, id]
                                  : value.activities.filter(
                                      (item) => item !== id,
                                    ),
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                    {form.activities.includes("pvp") && (
                      <div className="corp-legacy-tag">
                        <span>舰队作战（旧标签）</span>
                        <button
                          type="button"
                          className="corp-tag-remove"
                          aria-label="移除旧标签：舰队作战"
                          disabled={!editable || editorBusy}
                          onClick={() =>
                            setForm((value) => ({
                              ...value,
                              activities: value.activities.filter(
                                (item) => item !== "pvp",
                              ),
                            }))
                          }
                        >
                          <X size={15} />
                        </button>
                        <p>
                          旧标签仍会保留。你可以选择更准确的活动方向，再移除它。
                        </p>
                      </div>
                    )}
                    <div className="corp-custom-tags-editor">
                      <label htmlFor={customTagId}>自定义活动标签</label>
                      <p className="corp-field-hint" id={`${customTagId}-hint`}>
                        补充具体玩法，例如反收割、小队游猎。最多{" "}
                        {CUSTOM_TAG_LIMIT} 个，每个 {CUSTOM_TAG_LENGTH} 字。
                      </p>
                      <div className="corp-custom-tag-input">
                        <input
                          id={customTagId}
                          className="text-input"
                          value={customTagDraft}
                          placeholder="输入一个标签，按 Enter 添加"
                          aria-describedby={`${customTagId}-hint${tagError ? ` ${customTagId}-error` : ""}`}
                          aria-invalid={Boolean(tagError)}
                          disabled={
                            !editable ||
                            editorBusy ||
                            form.custom_activity_tags.length >= CUSTOM_TAG_LIMIT
                          }
                          onChange={(event) => {
                            setCustomTagDraft(event.target.value);
                            setTagError("");
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" &&
                              !event.nativeEvent.isComposing &&
                              event.keyCode !== 229
                            ) {
                              event.preventDefault();
                              addCustomTag();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={addCustomTag}
                          disabled={
                            !editable ||
                            editorBusy ||
                            form.custom_activity_tags.length >=
                              CUSTOM_TAG_LIMIT ||
                            !customTagDraft.trim()
                          }
                        >
                          <Plus size={16} />
                          添加标签
                        </button>
                      </div>
                      {tagError && (
                        <p
                          className="corp-tag-error"
                          id={`${customTagId}-error`}
                          role="alert"
                        >
                          {tagError}
                        </p>
                      )}
                      <div
                        className="corp-custom-tag-list"
                        aria-label="已添加的自定义标签"
                      >
                        {form.custom_activity_tags.map((tag) => (
                          <span key={tag}>
                            {tag}
                            <button
                              type="button"
                              className="corp-tag-remove"
                              aria-label={`移除标签：${tag}`}
                              disabled={!editable || editorBusy}
                              onClick={() => {
                                setForm((value) => ({
                                  ...value,
                                  custom_activity_tags:
                                    value.custom_activity_tags.filter(
                                      (item) => item !== tag,
                                    ),
                                }));
                                setTagError("");
                              }}
                            >
                              <X size={14} />
                            </button>
                          </span>
                        ))}
                        <span className="corp-tag-count">
                          {form.custom_activity_tags.length} /{" "}
                          {CUSTOM_TAG_LIMIT}
                        </span>
                      </div>
                    </div>
                    <div className="corp-two-fields">
                      <MediaField
                        id={corporation.id}
                        field="logo"
                        label="军团徽标"
                        form={form}
                        setForm={setForm}
                        setUploading={setUploading}
                        disabled={!editable || editorBusy}
                      />
                      <MediaField
                        id={corporation.id}
                        field="cover"
                        label="军团封面"
                        form={form}
                        setForm={setForm}
                        setUploading={setUploading}
                        disabled={!editable || editorBusy}
                      />
                    </div>
                  </>
                )}
                {tab === "recruitment" && (
                  <>
                    <div className="corp-editor-intro">
                      <h3>把加入的理由说清楚</h3>
                      <p>
                        招募要求、军团支持和公开联系方式会自动填入招募海报。
                      </p>
                    </div>
                    <div className="corp-two-fields">
                      <CorporationSelect
                        label="招募状态"
                        value={form.recruitment_status}
                        onChange={(recruitment_status) =>
                          setForm((value) => ({ ...value, recruitment_status }))
                        }
                        disabled={!editable || editorBusy}
                        options={[
                          { value: "open", label: "正在招募" },
                          { value: "closed", label: "暂缓招募" },
                        ]}
                        searchable={false}
                      />
                      {input("active_time", "活跃时间", 120)}
                    </div>
                    {input("requirements", "招募要求", 1500, 4)}
                    {input("benefits", "军团支持", 1500, 4)}
                    {optionGroup("benefit_keys", "福利列表", BENEFITS, 8)}
                    {input(
                      "benefits_note",
                      "福利补充说明",
                      500,
                      3,
                      "补充说明福利内容、补损规则或加入条件",
                    )}
                    {input(
                      "public_contact",
                      "公开联系方式",
                      200,
                      0,
                      "会公开展示在军团主页与海报中（提交审核时必填）",
                    )}
                  </>
                )}
                {tab === "event" && (
                  <>
                    <div className="corp-editor-intro">
                      <h3>你们的日常，值得被看见</h3>
                      <p>
                        介绍军团长期开展的活动，帮助飞行员找到适合自己的玩法。内容也会用于主要活动海报。
                      </p>
                    </div>
                    {input(
                      "activity_description",
                      "主要活动介绍",
                      1500,
                      6,
                      "例如：参与联盟主权战，组织驻地反收割；平日开展小队游猎、矿业生产与工业协作。也可以介绍参与方式、新人能参与的内容。",
                    )}
                    <p
                      className={`corp-field-hint${[...form.activity_description].length > 1500 ? " is-error" : ""}`}
                      id={`${customTagId}-activity-hint`}
                    >
                      描述常态玩法即可，无需填写某一次活动的日期或集结点。
                      {[...form.activity_description].length} / 1500 字
                    </p>
                    {Object.keys(LEGACY_EVENT_FIELDS).some(
                      (key) => form[key],
                    ) && (
                      <details className="corp-legacy-activity">
                        <summary>查看旧版活动资料</summary>
                        <p className="corp-field-hint">
                          旧资料保留供参考，不会自动填入主要活动。保存新版后，公开内容将在审核通过后更新。
                        </p>
                        <dl className="corp-review-fields">
                          {Object.entries(LEGACY_EVENT_FIELDS).map(
                            ([key, label]) =>
                              form[key] && (
                                <div key={key}>
                                  <dt>{label}</dt>
                                  <dd>{form[key]}</dd>
                                </div>
                              ),
                          )}
                        </dl>
                      </details>
                    )}
                  </>
                )}
              </div>
            </Panel>
            <div className="corp-editor-actions">
              {editable ? (
                <>
                  <button
                    className="ghost-btn"
                    type="button"
                    disabled={editorBusy}
                    onClick={() => action.run(save, "草稿已保存")}
                  >
                    <Save size={16} />
                    保存草稿
                  </button>
                  <button
                    className="primary-btn"
                    type="button"
                    disabled={editorBusy}
                    onClick={submit}
                  >
                    <Send size={16} />
                    {action.busy ? "处理中…" : "提交审核"}
                  </button>
                </>
              ) : (
                corporation.can_edit &&
                (pending ? (
                  <button
                    className="ghost-btn"
                    type="button"
                    disabled={editorBusy}
                    onClick={() =>
                      action.run(async () => {
                        await withdrawCorporationDraft(
                          current.id,
                          current.version,
                        );
                        await refresh();
                      }, "已撤回，可以创建新草稿。")
                    }
                  >
                    撤回审核
                  </button>
                ) : (
                  <button
                    className="primary-btn"
                    type="button"
                    disabled={editorBusy}
                    onClick={create}
                  >
                    创建新版草稿
                  </button>
                ))
              )}
              <p className="corp-hint">
                提交时会先保存当前编辑。图片上传完成后，仍需保存草稿才能关联。
              </p>
            </div>
          </div>
          <PosterDialog
            open={showPoster}
            onClose={() => setShowPoster(false)}
            corporation={{
              id: corporation.id,
              name: corporation.name,
              short_name: corporation.short_name,
            }}
            content={
              editable ? { ...form, activity_content_kind: "overview" } : form
            }
            approved={current.status === "approved"}
            isPrivate
            onBackgroundChange={
              editable && !editorBusy
                ? (poster_background) =>
                    setForm((value) => ({ ...value, poster_background }))
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

function MediaField({
  id,
  field,
  label,
  form,
  setForm,
  disabled,
  setUploading,
}) {
  const action = useCommunityAction();
  const request = useRef(null);
  const defaultCover =
    field === "cover" && !form.cover_asset_id && !form.cover_url;
  const upload = async (file) => {
    if (!file) return;
    if (
      !/\.(png|jpe?g|webp)$/i.test(file.name) ||
      !/^image\/(png|jpeg|webp)$/.test(file.type)
    ) {
      action.setError(new Error("仅支持 PNG、JPG、WEBP 图片"));
      return;
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      action.setError(new Error("每张图片需在 5 MiB 以内"));
      return;
    }
    request.current = { file, id: crypto.randomUUID() };
    await send();
  };
  const send = () =>
    action.run(async () => {
      setUploading(true);
      try {
        const result = await uploadCorporationMedia(
          id,
          request.current.file,
          request.current.id,
        );
        setForm((value) => ({
          ...value,
          [`${field}_asset_id`]: result.id,
          [`${field}_url`]: result.private_url,
        }));
        request.current = null;
      } finally {
        setUploading(false);
      }
    }, "图片已上传，请保存草稿。");
  return (
    <div className="corp-media-field">
      <span>{label}</span>
      <div
        className={`corp-media-preview is-${field}`}
        role={defaultCover ? "img" : undefined}
        aria-label={defaultCover ? "军团默认封面" : undefined}
      >
        {defaultCover ? (
          <CorporationCover corporation={{ id }} thumbnail />
        ) : (
          <CorporationImage
            url={form[`${field}_url`]}
            isPrivate
            className="corp-media-thumbnail"
            fallback={<ImagePlus size={24} />}
          />
        )}
      </div>
      <label className="ghost-btn corp-file-label">
        <ImagePlus size={15} />
        {action.busy ? "上传中…" : "选择图片"}
        <input
          type="file"
          aria-label={`上传${label}`}
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || action.busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            upload(file);
          }}
        />
      </label>
      {defaultCover && (
        <small className="corp-default-cover-hint">
          当前使用默认封面，上传图片后可替换
        </small>
      )}
      {form[`${field}_asset_id`] && !disabled && (
        <button
          type="button"
          className="corp-text-button"
          onClick={() =>
            setForm((value) => ({
              ...value,
              [`${field}_asset_id`]: null,
              [`${field}_url`]: null,
            }))
          }
        >
          移除图片
        </button>
      )}
      <CommunityError
        error={action.error}
        retry={request.current ? send : undefined}
      />
      {action.message && <small>{action.message}</small>}
      <small>PNG / JPG / WEBP · 最多 5 MiB</small>
    </div>
  );
}
