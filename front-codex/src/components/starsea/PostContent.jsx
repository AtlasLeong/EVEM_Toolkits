import { Link } from "react-router-dom";
import { battleVisualSummary, formatIsk, KINDS } from "../../utils/starsea";
import { SafeImage, formatDate } from "./StarseaUI";

export default function PostContent({
  entry,
  isPrivate = false,
  preview = false,
}) {
  const content = entry.revision.content,
    location = content.location,
    visual = content.kind === "battle" ? battleVisualSummary(entry.summary || content.battle) : null;
  return (
    <article className="ss-detail">
      <header className={content.kind === "battle" ? "ss-detail-head ss-battle-head" : "ss-detail-head"}>
        <div className="ss-meta">
          <span>{KINDS[content.kind]}</span>
          <span>{entry.author_name || "你的见闻"}</span>
          {preview && <span>草稿预览</span>}
        </div>
        <h1>{content.title || "未命名见闻"}</h1>
        <div className="ss-meta">
          {content.occurred_at && <time>{formatDate(content.occurred_at)}</time>}
          {location && (
            <span>
              {[
                location.region_name,
                location.constellation_name,
                location.solarsystem_name,
              ]
                .filter(Boolean)
                .join(" / ") || "已选择发生地点"}
            </span>
          )}
        </div>
      </header>
      {content.kind === "battle" && (
        <section className="ss-battle-report" aria-label="双方损失对比">
          <div className="ss-battle-report-bar">
            <span className="ss-battle-eyebrow">COMBAT REPORT / 战斗复盘</span>
            <strong>{visual.total_ships.toLocaleString()} 艘确认损失</strong>
            <span>{visual.sides.length} 方 · 按已录入的舰船型号汇总</span>
          </div>
          <div className="ss-battle-summary">
            {visual.sides.map((side, index) => (
              <div className={`ss-summary-side ss-summary-side-${index}`} key={index}>
                <div className="ss-side-heading">
                  <span className="ss-side-marker" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
                  <h2>{side.name || `第 ${index + 1} 方`}</h2>
                  {visual.leading_side === index && side.total_ships > 0 && <span className="ss-side-leading">损失较多</span>}
                </div>
                <div className="ss-total">
                  <strong>{Number(side.total_ships).toLocaleString()}</strong>
                  <span>艘损失</span>
                </div>
                <div className="ss-loss-meter" aria-label={`${side.name}损失占比 ${Math.round(side.share * 100)}%`}>
                  <span style={{ width: `${Math.max(side.share * 100, side.total_ships ? 5 : 0)}%` }} />
                </div>
                <p className="ss-isk">{formatIsk(side.isk_loss)}</p>
                <div className="ss-class-list">
                  {side.by_class.map((item) => (
                    <span key={item.name}>
                      {item.name}
                      <b>{item.quantity}</b>
                    </span>
                  ))}
                  {!side.by_class.length && <span>暂无舰种明细</span>}
                </div>
                <ul className="ss-model-list">
                  {(content.battle?.sides[index]?.losses || []).map((row, rowIndex) => (
                    <li key={rowIndex}>
                      <span>
                        {row.ship_name || "未知型号"}
                        <small>
                          {row.ship_id == null
                            ? row.ship_name && row.ship_name !== "未知型号"
                              ? "自填"
                              : "未知"
                            : row.source_version || "目录型号"}
                        </small>
                      </span>
                      <strong>× {row.quantity}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
      {content.body && <div className="ss-body">{content.body}</div>}
      {content.images?.length > 0 && (
        <section className="ss-gallery" aria-label="见闻配图">
          {content.images.map((image) => (
            <SafeImage
              key={image.id}
              id={image.id}
              caption={image.caption}
              isPrivate={isPrivate}
            />
          ))}
        </section>
      )}
      {entry.corporation && (
        <aside className="ss-linked-corp">
          <span>关联军团</span>
          <Link to={`/corporations/${entry.corporation.id}`}>
            {entry.corporation.name} ↗
          </Link>
          <small>仅表示内容关联，不代表军团官方立场。</small>
        </aside>
      )}
    </article>
  );
}
