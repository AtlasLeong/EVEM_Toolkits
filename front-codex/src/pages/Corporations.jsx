import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, Clock3, MapPin, Search, Users } from "lucide-react";
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
  getCommunityRegions,
  getCorporation,
  listCorporations,
} from "../services/apiCommunity";
import {
  ActivityTags,
  BackToCorporations,
  CommunityError,
  CommunityNav,
  CorporationImage,
  Pagination,
} from "../components/community/CorporationUI";
import PosterDialog from "../components/community/PosterDialog";
import CorporationSelect, {
  catalogLabel,
  catalogSecurity,
} from "../components/community/CorporationSelect";
import CorporationShare from "../components/community/CorporationShare";
import CorporationCover from "../components/community/CorporationCover";
import { CorporationLocationLabel } from "../components/community/CorporationLocation";
import { activityKind } from "../utils/corporationActivity.js";
import "../styles/corporations.css";

export default function CorporationsPage() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [activity, setActivity] = useState("");
  const [region, setRegion] = useState("");
  const [page, setPage] = useState(1);
  const regions = useQuery({
    queryKey: ["community-regions"],
    queryFn: getCommunityRegions,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const list = useQuery({
    queryKey: ["corporations-public", q, activity, region, page],
    queryFn: () => listCorporations({ q, activity, region, page }),
    retry: 1,
  });
  return (
    <div className="corp-page corp-directory-page">
      <PageHeader
        title="军团大厅"
        subtitle="在新伊甸，找到与你同行的人。"
        action={
          <Link className="primary-btn" to="/corporations/manage">
            <Users size={17} />
            展示我的军团
          </Link>
        }
      />
      <CommunityNav />
      <div className="corp-directory-intro">
        <span className="corp-eyebrow">FIND YOUR FLEET</span>
        <h2>不同的航向，同样的热爱。</h2>
        <p>寻找志同道合的飞行员，从了解一个军团开始。</p>
      </div>
      <form
        className="corp-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input.trim());
          setPage(1);
        }}
      >
        <label className="corp-search-input">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="搜索军团"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={80}
            placeholder="搜索军团名称或简称"
          />
        </label>
        <CorporationSelect
          label="活动星域"
          value={region}
          compact
          loading={regions.isPending}
          error={regions.error}
          onRetry={() => regions.refetch()}
          options={[
            { value: "", label: "全部活动星域" },
            ...(regions.data || []).map((item) => ({
              value: catalogLabel(item, "r"),
              label: catalogLabel(item, "r"),
              security: catalogSecurity(item.r_safetylvl),
            })),
          ]}
          onChange={(value) => {
            setRegion(value);
            setPage(1);
          }}
        />
        <CorporationSelect
          label="活动方向"
          value={activity}
          compact
          options={[
            { value: "", label: "全部活动方向" },
            ...Object.entries(ACTIVITIES).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
          onChange={(value) => {
            setActivity(value);
            setPage(1);
          }}
        />
        <button type="submit" className="primary-btn">
          查找军团
        </button>
      </form>
      {list.isPending ? (
        <LoadingBar />
      ) : list.isError ? (
        <CommunityError error={list.error} retry={() => list.refetch()} />
      ) : (
        <>
          <div className="corp-list-caption">
            <span>{q || activity || region ? "筛选结果" : "探索军团"}</span>
            <span>{list.data.count} 个已公开军团</span>
          </div>
          {list.data.results.length ? (
            <div className="corp-grid">
              {list.data.results.map((corp) => (
                <CorporationCard key={corp.id} corporation={corp} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={
                q || activity || region
                  ? "没有找到匹配的军团"
                  : "还没有公开的军团"
              }
              desc="你可以调整筛选条件，或申请创建军团主页。审核通过后就会在这里展示。"
            />
          )}
          <Pagination page={page} count={list.data.count} change={setPage} />
        </>
      )}
      <div className="corp-directory-footer">
        <span>每个军团都有自己的故事。</span>
        <Link to="/corporations/manage">
          让大家认识你的军团
          <ArrowUpRight size={16} />
        </Link>
      </div>
    </div>
  );
}

function CorporationCard({ corporation: corp }) {
  const content = corp.revision;
  return (
    <Link className="corp-card" to={`/corporations/${corp.id}`}>
      <div className="corp-card-cover">
        <CorporationCover corporation={corp} thumbnail />
        <span className="corp-card-kicker">
          {corp.short_name || "CORPORATION"}
        </span>
        <span
          className={`corp-recruiting${content.recruitment_status === "closed" ? " is-closed" : ""}`}
        >
          {content.recruitment_status === "closed" ? "暂缓招募" : "正在招募"}
        </span>
      </div>
      <div className="corp-card-body">
        <CorporationImage
          url={corp.logo_url}
          className="corp-card-logo"
          alt=""
          fallback={corp.short_name?.slice(0, 2) || corp.name.slice(0, 1)}
        />
        <h3>
          {corp.name}
          <ArrowUpRight size={18} />
        </h3>
        <p>{content.tagline || "欢迎了解我们的军团。"}</p>
        <ActivityTags
          values={content.activities}
          custom={content.custom_activity_tags}
          limit={4}
        />
        <MetadataTags content={content} compact />
        <div className="corp-card-meta">
          <span>
            <MapPin size={14} />
            <CorporationLocationLabel
              location={content.base_location}
              legacy={content.base_region}
              empty="活动星域待补充"
              regionOnly
            />
          </span>
          <span>
            <Clock3 size={14} />
            {content.active_time || "联系了解活跃时间"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function MetadataTags({ content, compact = false }) {
  const values = [
    ...(content.corp_types || []).map((value) => ({
      key: `type-${value}`,
      label: CORPORATION_TYPES[value] || value,
      tone: "corp-tag-type",
    })),
    ...(content.region_tags || []).map((value) => ({
      key: `region-${value}`,
      label: REGION_TAGS[value] || value,
      tone: "corp-tag-region",
    })),
  ];
  const visible = compact ? values.slice(0, 2) : values;
  const hidden = values.length - visible.length;
  return (
    <div className="corp-tags corp-metadata-tags" aria-label="军团标签">
      {visible.map((item) => (
        <span className={item.tone} key={item.key}>
          {item.label}
        </span>
      ))}
      {hidden > 0 && <span>+{hidden}</span>}
    </div>
  );
}

function BenefitTags({ content }) {
  const values = content.benefit_keys || [];
  return (
    <div className="corp-benefits">
      {values.map((value) => (
        <span key={value}>{BENEFITS[value] || value}</span>
      ))}
      {content.benefits_note && (
        <p className="corp-benefits-note">{content.benefits_note}</p>
      )}
      {content.benefits && <p className="corp-prose">{content.benefits}</p>}
      {!values.length && !content.benefits_note && !content.benefits && (
        <p className="corp-prose">请联系军团了解。</p>
      )}
    </div>
  );
}

export function CorporationDetailPage() {
  const { id } = useParams();
  const [showPoster, setShowPoster] = useState(false);
  const query = useQuery({
    queryKey: ["corporations-public", "detail", id],
    queryFn: () => getCorporation(id),
    retry: 1,
  });
  if (query.isPending)
    return (
      <div className="corp-page">
        <BackToCorporations />
        <LoadingBar />
      </div>
    );
  if (query.isError)
    return (
      <div className="corp-page">
        <BackToCorporations />
        <PageHeader title="军团详情" />
        <CommunityError error={query.error} retry={() => query.refetch()} />
      </div>
    );
  const corp = query.data;
  const content = corp.revision;
  return (
    <div className="corp-page corp-profile-page">
      <BackToCorporations />
      <div className="corp-profile-cover">
        <CorporationCover corporation={corp} />
        <span className="corp-eyebrow">
          CORPORATION / {corp.short_name || "NEW EDEN"}
        </span>
      </div>
      <section className="corp-profile-summary">
        <div className="corp-profile-heading">
          <CorporationImage
            url={corp.logo_url}
            className="corp-profile-logo"
            fallback={corp.short_name?.slice(0, 2) || corp.name.slice(0, 1)}
          />
          <div className="corp-profile-identity">
            <h1>{corp.name}</h1>
            <p>{content.tagline}</p>
          </div>
          <div className="corp-profile-actions">
            <CorporationShare id={corp.id} />
            <button
              type="button"
              className="primary-btn"
              onClick={() => setShowPoster(true)}
            >
              制作海报
              <ArrowUpRight size={17} />
            </button>
          </div>
        </div>
        <div className="corp-profile-tag-rail">
          <ActivityTags
            values={content.activities}
            custom={content.custom_activity_tags}
          />
          <MetadataTags content={content} />
        </div>
      </section>
      <div className="corp-detail-layout">
        <div className="corp-detail-main">
          <Panel title="关于军团">
            <p className="corp-prose">{content.introduction}</p>
            <dl className="corp-facts">
              <div>
                <dt>所属联盟</dt>
                <dd>{content.alliance || "未填写"}</dd>
              </div>
              <div>
                <dt>军团驻地</dt>
                <dd>
                  <CorporationLocationLabel
                    location={content.base_location}
                    legacy={content.base_region}
                  />
                </dd>
              </div>
              <div>
                <dt>活跃时间</dt>
                <dd>{content.active_time || "未填写"}</dd>
              </div>
            </dl>
          </Panel>
          <Panel
            title="期待你的加入"
            subtitle={
              content.recruitment_status === "closed"
                ? "目前暂缓招募，欢迎后续关注。"
                : "联系军团，了解适合你的下一段旅程。"
            }
          >
            <div className="corp-two-sections">
              <div>
                <h3>招募要求</h3>
                <p className="corp-prose">
                  {content.requirements || "请联系军团了解。"}
                </p>
              </div>
              <div>
                <h3>军团支持</h3>
                <BenefitTags content={content} />
              </div>
            </div>
            <div className="corp-contact">
              <span>联系军团</span>
              <strong>{content.public_contact}</strong>
            </div>
          </Panel>
          {activityKind(content) === "overview" &&
            content.activity_description && (
              <Panel title="主要活动">
                <p className="corp-prose">{content.activity_description}</p>
              </Panel>
            )}
          {activityKind(content) === "legacy_event" && content.event_title && (
            <Panel
              title={content.event_title}
              subtitle={`旧版活动资料 · ${[content.event_time, content.event_location].filter(Boolean).join(" · ")}`}
            >
              <p className="corp-prose">{content.event_description}</p>
            </Panel>
          )}
          <p className="corp-hint">
            资料由军团提供并经站点审核；招募、活动及交易信息请自行核实。
          </p>
        </div>
      </div>
      <PosterDialog
        open={showPoster}
        onClose={() => setShowPoster(false)}
        corporation={corp}
        content={{
          ...content,
          logo_url: corp.logo_url,
          cover_url: corp.cover_url,
        }}
        approved
      />
    </div>
  );
}
