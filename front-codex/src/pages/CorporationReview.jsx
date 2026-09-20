import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ShieldCheck } from "lucide-react";
import { AuthContext } from "../context/AuthContext";
import {
  EmptyState,
  LoadingBar,
  PageHeader,
  Panel,
} from "../components/ui/Primitives";
import {
  BENEFITS,
  CORPORATION_TYPES,
  REGION_TAGS,
  decideCorporationReview,
  getCommunityCapabilities,
  getCorporationReview,
  listCorporationReviews,
  setCorporationVisibility,
} from "../services/apiCommunity";
import {
  POSTER_BACKGROUNDS,
  normalizePosterBackground,
} from "../utils/corporationPoster";
import {
  CommunityError,
  CommunityGuest,
  CommunityNav,
  CorporationImage,
  Pagination,
  useCommunityAction,
  usePrivateCommunity,
  useRefreshPublicCorporations,
} from "../components/community/CorporationUI";
import PosterDialog from "../components/community/PosterDialog";
import { CorporationLocationLabel } from "../components/community/CorporationLocation";
import {
  activityKind,
  activityLabels,
  normalizeCustomActivityTags,
  LEGACY_EVENT_FIELDS,
} from "../utils/corporationActivity.js";
import "../styles/corporations.css";

export default function CorporationReviewPage() {
  const { isAuthenticated, userInfo } = useContext(AuthContext);
  return (
    <div className="corp-page">
      <PageHeader
        title="军团审核"
        subtitle="核实管理权限，审阅将对外展示的完整资料。"
        action={
          <span className="corp-hint">
            <ShieldCheck size={16} />
            管理员审核
          </span>
        }
      />
      <CommunityNav />
      {isAuthenticated ? (
        <ReviewWorkspace key={userInfo?.userId || userInfo?.userName} />
      ) : (
        <CommunityGuest />
      )}
    </div>
  );
}
function ReviewWorkspace() {
  const { prefix, refresh } = usePrivateCommunity();
  const [kind, setKind] = useState("claims");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState("");
  const capability = useQuery({
    queryKey: [...prefix, "capabilities"],
    queryFn: getCommunityCapabilities,
    retry: false,
    gcTime: 0,
  });
  const allowed = capability.data?.can_review === true;
  const listing = useQuery({
    queryKey: [...prefix, "reviews", kind, page],
    queryFn: () => listCorporationReviews(kind, page),
    enabled: allowed,
    retry: 1,
    gcTime: 0,
  });
  if (capability.isPending) return <LoadingBar />;
  if (capability.isError)
    return (
      <CommunityError
        error={capability.error}
        retry={() => capability.refetch()}
      />
    );
  if (!allowed)
    return (
      <EmptyState
        title="此页面仅供管理员使用"
        desc="普通账号可以在“我的军团”查看自己的申请和审核结果。"
      />
    );
  return (
    <>
      <div className="corp-editor-tabs" role="group" aria-label="审核类型">
        {[
          ["claims", "归属申请"],
          ["revisions", "资料审核"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={kind === value ? "active" : ""}
            onClick={() => {
              setKind(value);
              setSelected(null);
              setPage(1);
              setNotice("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {notice && (
        <p className="corp-success" role="status">
          <Check size={16} />
          {notice}
        </p>
      )}
      <div className="corp-review-layout">
        <Panel title="待审列表">
          {listing.isPending ? (
            <LoadingBar />
          ) : listing.isError ? (
            <CommunityError
              error={listing.error}
              retry={() => listing.refetch()}
            />
          ) : (
            <>
              {listing.data.results.length ? (
                <div className="corp-review-list">
                  {listing.data.results.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={selected === item.id ? "active" : ""}
                      onClick={() => {
                        setSelected(item.id);
                        setNotice("");
                      }}
                    >
                      <strong>{item.corporation?.name || item.name}</strong>
                      <span>
                        {item.applicant_name ||
                          item.author_name ||
                          `#${item.id}`}{" "}
                        · 待审核
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="暂无待审内容"
                  desc="新的申请和资料会显示在这里。"
                />
              )}
              <Pagination
                page={page}
                count={listing.data.count}
                change={setPage}
              />
            </>
          )}
        </Panel>
        {selected ? (
          <ReviewDetail
            key={`${kind}-${selected}`}
            kind={kind}
            id={selected}
            prefix={prefix}
            done={async () => {
              setSelected(null);
              setNotice("审核已完成");
              await refresh();
            }}
          />
        ) : (
          <Panel className="corp-review-placeholder">
            <ShieldCheck size={32} />
            <h2>选择一条待审内容</h2>
            <p>资料审核与管理权限核实相互独立，请先确认申请说明和公开信息。</p>
          </Panel>
        )}
      </div>
      <VisibilityTools refresh={refresh} />
    </>
  );
}
function ReviewDetail({ kind, id, prefix, done }) {
  const refreshPublic = useRefreshPublicCorporations();
  const [showPoster, setShowPoster] = useState(false);
  const query = useQuery({
    queryKey: [...prefix, "review", kind, id],
    queryFn: () => getCorporationReview(kind, id),
    retry: 1,
    gcTime: 0,
  });
  const [reason, setReason] = useState("");
  const action = useCommunityAction();
  if (query.isPending) return <LoadingBar />;
  if (query.isError)
    return <CommunityError error={query.error} retry={() => query.refetch()} />;
  const data = query.data;
  const decide = (decision) =>
    action.run(async () => {
      await decideCorporationReview(kind, id, decision, reason.trim());
      await refreshPublic(data.corporation?.id);
      await done();
    });
  const fields = {
    tagline: "军团口号",
    introduction: "军团介绍",
    alliance: "所属联盟",
    active_time: "活跃时间",
    recruitment_status: "招募状态",
    requirements: "招募要求",
    benefits: "军团支持",
    public_contact: "公开联系方式",
    activity_description: "主要活动介绍",
    ...Object.fromEntries(
      Object.entries(LEGACY_EVENT_FIELDS).filter(([key]) => data[key]),
    ),
  };
  return (
    <div className="corp-review-detail">
      <Panel
        title={
          (kind === "claims" ? data.proposed_name : null) ??
          data.corporation?.name ??
          "审核详情"
        }
        subtitle={
          kind === "claims"
            ? "通过仅授予管理权，不会自动公开主页。"
            : "以下是待审版本的不可变快照，通过后将替换当前公开版本。"
        }
      >
        {kind === "claims" ? (
          <>
            <dl className="corp-review-fields">
              <div>
                <dt>申请军团名称</dt>
                <dd>
                  {data.proposed_name ?? data.corporation?.name ?? "未填写"}
                </dd>
              </div>
              <div>
                <dt>申请军团简称</dt>
                <dd>
                  {(data.proposed_short_name ?? data.corporation?.short_name) ||
                    "未填写"}
                </dd>
              </div>
            </dl>
            <h3>申请说明</h3>
            <p className="corp-prose">{data.statement}</p>
            <div className="corp-contact">
              <span>验证联系方式（私有）</span>
              <strong>{data.contact}</strong>
            </div>
          </>
        ) : (
          <>
            <dl className="corp-review-fields">
              <div>
                <dt>军团驻地</dt>
                <dd>
                  <CorporationLocationLabel
                    location={data.base_location}
                    legacy={data.base_region}
                  />
                </dd>
              </div>
              {Object.entries(fields).map(([field, label]) => (
                <div key={field}>
                  <dt>{label}</dt>
                  <dd>{data[field] || "未填写"}</dd>
                </div>
              ))}
              <div>
                <dt>活动资料版本</dt>
                <dd>
                  {activityKind(data) === "overview"
                    ? "主要活动介绍（旧版活动不再用于公开活动区）"
                    : "旧版活动资料"}
                </dd>
              </div>
              <div>
                <dt>活动方向</dt>
                <dd>
                  {activityLabels(data.activities).join(" / ") || "未填写"}
                </dd>
              </div>
              <div>
                <dt>自定义活动标签</dt>
                <dd>
                  {normalizeCustomActivityTags(data.custom_activity_tags).join(
                    " / ",
                  ) || "未填写"}
                </dd>
              </div>
              <div>
                <dt>军团类型</dt>
                <dd>
                  <div className="corp-tags">
                    {(data.corp_types || []).map((value) => (
                      <span key={value} className="corp-tag-type">
                        {CORPORATION_TYPES[value] || value}
                      </span>
                    ))}
                  </div>
                  {!data.corp_types?.length && "未填写"}
                </dd>
              </div>
              <div>
                <dt>区域标签</dt>
                <dd>
                  <div className="corp-tags">
                    {(data.region_tags || []).map((value) => (
                      <span key={value} className="corp-tag-region">
                        {REGION_TAGS[value] || value}
                      </span>
                    ))}
                  </div>
                  {!data.region_tags?.length && "未填写"}
                </dd>
              </div>
              <div>
                <dt>福利列表</dt>
                <dd>
                  <div className="corp-tags">
                    {(data.benefit_keys || []).map((value) => (
                      <span key={value}>{BENEFITS[value] || value}</span>
                    ))}
                  </div>
                  {!data.benefit_keys?.length && "未填写"}
                </dd>
              </div>
              <div>
                <dt>福利补充</dt>
                <dd>{data.benefits_note || "未填写"}</dd>
              </div>
              <div>
                <dt>海报背景</dt>
                <dd>
                  {
                    POSTER_BACKGROUNDS[
                      normalizePosterBackground(data.poster_background)
                    ]
                  }
                </dd>
              </div>
            </dl>
            <div className="corp-review-images">
              <CorporationImage
                url={data.logo_url}
                isPrivate
                className="corp-review-logo"
                fallback="无徽标"
              />
              <CorporationImage
                url={data.cover_url}
                isPrivate
                className="corp-review-cover"
                fallback="无封面"
              />
            </div>
            <button
              type="button"
              className="ghost-btn corp-review-poster-trigger"
              onClick={() => setShowPoster(true)}
            >
              预览海报
            </button>
          </>
        )}
        <div className="corp-form corp-review-decision">
          <label>
            审核意见
            <textarea
              className="text-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="驳回时必填；通过时建议记录核验依据"
            />
          </label>
          <CommunityError error={action.error} />
          <div className="corp-inline-actions">
            <button
              className="ghost-btn"
              type="button"
              disabled={action.busy || !reason.trim()}
              onClick={() => decide("reject")}
            >
              驳回并说明原因
            </button>
            <button
              className="primary-btn"
              type="button"
              disabled={action.busy}
              onClick={() => decide("approve")}
            >
              {kind === "claims" ? "批准申请" : "批准并发布"}
            </button>
          </div>
        </div>
      </Panel>
      {kind === "revisions" && (
        <PosterDialog
          open={showPoster}
          onClose={() => setShowPoster(false)}
          corporation={data.corporation}
          content={data}
          isPrivate
        />
      )}
    </div>
  );
}
function VisibilityTools({ refresh }) {
  const refreshPublic = useRefreshPublicCorporations();
  const [id, setId] = useState("");
  const [reason, setReason] = useState("");
  const action = useCommunityAction();
  return (
    <details className="corp-visibility">
      <summary>已发布内容管理</summary>
      <p className="corp-hint">
        下架会同时关闭公开主页和图片。重新上架仍只能显示已通过审核的资料。
      </p>
      <div className="corp-form">
        <div className="corp-two-fields">
          <label>
            军团编号
            <input
              className="text-input"
              value={id}
              onChange={(e) => setId(e.target.value)}
              inputMode="numeric"
              pattern="[0-9]+"
            />
          </label>
          <label>
            管理原因
            <input
              className="text-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
            />
          </label>
        </div>
        <div className="corp-inline-actions">
          {[
            [false, "下架军团"],
            [true, "重新上架"],
          ].map(([value, label]) => (
            <button
              className="ghost-btn"
              type="button"
              key={label}
              disabled={action.busy || !/^[1-9]\d*$/.test(id) || !reason.trim()}
              onClick={() =>
                action.run(async () => {
                  await setCorporationVisibility(id, value, reason.trim());
                  await refreshPublic(id);
                  await refresh();
                }, "公开状态已更新")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <CommunityError error={action.error} />
        {action.message && (
          <p role="status" className="corp-success">
            {action.message}
          </p>
        )}
      </div>
    </details>
  );
}
