import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import * as api from "../services/apiStarsea";
import {
  battleSummary,
  KINDS,
  localDateTime,
  newContent,
  toWriteContent,
} from "../utils/starsea";
import {
  AccountBoundary,
  StarseaHeader,
  ErrorNotice,
  Loading,
  SafeImage,
  Status,
  useAlive,
  useLoad,
  useUnsavedStarsea,
} from "../components/starsea/StarseaUI";
import BattleEditor from "../components/starsea/BattleEditor";
import {
  CorporationEditor,
  LocationEditor,
} from "../components/starsea/LocationEditor";
import PostContent from "../components/starsea/PostContent";

function editableContent(content) {
  return {
    ...content,
    battle: content.battle
      ? {
          ...content.battle,
          sides: content.battle.sides.map((side) => ({
            ...side,
            losses: side.losses.map((row) => ({
              ...row,
              _key: crypto.randomUUID(),
            })),
          })),
        }
      : null,
  };
}

function Editor() {
  const { id } = useParams(),
    navigate = useNavigate(),
    location = useLocation(),
    alive = useAlive();
  const load = useLoad(
    () => (id ? api.getManagement(id) : Promise.resolve(null)),
    [id],
  );
  const [entry, setEntry] = useState(null),
    [content, setContent] = useState(newContent),
    [saved, setSaved] = useState(() =>
      JSON.stringify(toWriteContent(newContent())),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(location.state?.saved ? "草稿已保存" : ""),
    [preview, setPreview] = useState(false),
    [uploads, setUploads] = useState([]);
  const requestId = useRef(crypto.randomUUID()),
    creationPayload = useRef(null),
    lock = useRef(false);
  useEffect(() => {
    if (load.data) {
      setEntry(load.data);
      setContent(editableContent(load.data.revision.content));
      setSaved(JSON.stringify(toWriteContent(load.data.revision.content)));
    }
  }, [load.data]);
  const payload = useMemo(() => toWriteContent(content), [content]),
    dirty = JSON.stringify(payload) !== saved || uploads.length > 0,
    editable = !entry || entry.revision.status === "draft",
    summary = useMemo(() => battleSummary(content.battle), [content.battle]);
  useUnsavedStarsea(dirty, busy);
  function accept(next, notice) {
    if (!alive.current) return;
    setEntry(next);
    setContent(editableContent(next.revision.content));
    setSaved(JSON.stringify(toWriteContent(next.revision.content)));
    if (notice) setMessage(notice);
  }
  async function ensureSaved() {
    let current = entry;
    if (!current) {
      creationPayload.current ||= payload;
      try {
        current = await api.createPost(
          creationPayload.current,
          requestId.current,
        );
      } catch (error) {
        // A definite validation rejection did not create a post. Ambiguous
        // network/5xx results keep the original payload and idempotency key.
        if ([400, 413, 415, 422].includes(error.status)) {
          creationPayload.current = null;
          requestId.current = crypto.randomUUID();
        }
        throw error;
      }
      if (!alive.current) return null;
      setEntry(current);
    }
    if (
      JSON.stringify(toWriteContent(current.revision.content)) !==
      JSON.stringify(payload)
    )
      current = await api.saveDraft(current, payload);
    if (!alive.current) return null;
    accept(current);
    return current;
  }
  async function run(action) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (err) {
      if (alive.current)
        setError(
          err.status === 409
            ? `${err.message}。请先复制保留未保存的内容，再重新载入最新版本。`
            : err.message,
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save(submit = false) {
    await run(async () => {
      if (submit && uploads.length)
        throw new Error("请先重试或移除未完成的图片上传。");
      let current = await ensureSaved();
      if (!current) return;
      if (submit) {
        current = await api.submitPost(current);
        if (!alive.current) return;
      }
      accept(current, submit ? "已提交审核" : "草稿已保存");
    });
  }
  // Replace the fresh route only after the dirty guard observes the saved state.
  useEffect(() => {
    if (!id && entry && !dirty && !busy && !error && !uploads.length)
      navigate(`/starsea/${entry.id}/edit`, {
        replace: true,
        state: { saved: entry.revision.status === "draft" },
      });
  }, [id, entry?.id, dirty, busy, error, uploads.length, navigate]);
  async function uploadOne(item, current) {
    const asset = await api.uploadMedia(current.id, item.file, item.requestId);
    if (!alive.current) return;
    setContent((value) => ({
      ...value,
      images: value.images.some((image) => image.id === asset.id)
        ? value.images
        : [...value.images, { id: asset.id, caption: "" }],
    }));
    setUploads((value) =>
      value.filter((file) => file.requestId !== item.requestId),
    );
  }
  function addFiles(files) {
    if (!files.length) return;
    if (content.images.length + uploads.length + files.length > 12) {
      setError("最多上传 12 张图片。");
      return;
    }
    const invalid = files.find(
      (file) =>
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024,
    );
    if (invalid) {
      setError("请选择 5 MB 以内的 JPEG、PNG 或 WebP 图片。");
      return;
    }
    const items = files.map((file) => ({
      file,
      requestId: crypto.randomUUID(),
      error: "",
    }));
    setUploads((value) => [...value, ...items]);
    run(async () => {
      const current = await ensureSaved();
      if (!current) return;
      for (const item of items) {
        try {
          await uploadOne(item, current);
        } catch (err) {
          if (alive.current)
            setUploads((value) =>
              value.map((file) =>
                file.requestId === item.requestId
                  ? { ...file, error: err.message }
                  : file,
              ),
            );
        }
        if (!alive.current) return;
      }
    });
  }
  function retryUpload(item) {
    run(async () => {
      const current = await ensureSaved();
      if (current)
        try {
          await uploadOne(item, current);
        } catch (err) {
          if (alive.current)
            setUploads((value) =>
              value.map((file) =>
                file.requestId === item.requestId
                  ? { ...file, error: err.message }
                  : file,
              ),
            );
          throw err;
        }
    });
  }
  if (load.loading && id)
    return (
      <section className="starsea-page">
        <Loading />
      </section>
    );
  if (load.error)
    return (
      <section className="starsea-page">
        <ErrorNotice error={load.error} retry={load.reload} />
      </section>
    );
  return (
    <section className="starsea-page ss-editor">
      <StarseaHeader
        editor
        title={id ? "编辑见闻" : "发布见闻"}
        subtitle="留下事实，留下故事。审核通过后公开展示。"
      >
        <Link to="/starsea/mine">我的发布</Link>
        {entry && <Status value={entry.revision.status} />}
      </StarseaHeader>
      <ErrorNotice error={error} />
      {error && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              !dirty ||
              window.confirm("重新载入会丢失未保存的内容，确定继续吗？")
            )
              load.reload();
          }}
        >
          重新载入最新版本
        </button>
      )}
      {message && (
        <p className="ss-success" role="status">
          {message}
        </p>
      )}
      {entry?.published_revision_id && (
        <div className="ss-notice">
          已发布版本继续公开展示。这里的修改会作为新版本重新审核。
          <Link to={`/starsea/${entry.id}`}>查看公开版本 ↗</Link>
        </div>
      )}
      {entry?.revision.review_reason && (
        <div className="ss-notice">
          退回原因：{entry.revision.review_reason}
        </div>
      )}
      {!editable ? (
        <div className="ss-locked">
          <h2>
            {entry.revision.status === "pending"
              ? "审核中，内容已锁定"
              : "此版本不可直接编辑"}
          </h2>
          <p>
            {entry.revision.status === "pending"
              ? "如需修改，请先撤回本次审核。"
              : "创建新草稿后再修改，公开版本不受影响。"}
          </p>
          <button
            className="ss-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const next = await (entry.revision.status === "pending"
                  ? api.withdrawPost(entry)
                  : api.cloneDraft(entry));
                accept(next, "已创建可编辑草稿");
              })
            }
          >
            {entry.revision.status === "pending" ? "撤回修改" : "创建改稿"}
          </button>
          <PostContent entry={entry} isPrivate />
        </div>
      ) : (
        <>
          <fieldset disabled={busy} className="ss-editor-fields">
            <section className="ss-editor-section">
              <div className="ss-section-heading">
                <h2>基本信息</h2>
                <span className="ss-muted">
                  {dirty ? "有未保存修改" : "已保存 / 新草稿"}
                </span>
              </div>
              <div
                className="ss-type-options"
                role="group"
                aria-label="见闻类型"
              >
                {Object.entries(KINDS).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={content.kind === kind}
                    onClick={() =>
                      setContent((value) => ({
                        ...value,
                        kind,
                        battle: value.battle || newContent().battle,
                      }))
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label>
                标题
                <input
                  aria-label="标题"
                  maxLength={120}
                  value={content.title}
                  placeholder="用一句话说说发生了什么"
                  onChange={(event) =>
                    setContent({ ...content, title: event.target.value })
                  }
                />
              </label>
              <div className="ss-main-fields">
                <label>
                  发生时间（选填）
                  <input
                    aria-label="发生时间"
                    type="datetime-local"
                    value={localDateTime(content.occurred_at)}
                    onChange={(event) =>
                      setContent({
                        ...content,
                        occurred_at: event.target.value
                          ? new Date(event.target.value).toISOString()
                          : null,
                      })
                    }
                  />
                </label>
                <LocationEditor
                  value={content.location}
                  onChange={(location) => setContent({ ...content, location })}
                />
              </div>
            </section>
            {content.kind === "battle" && (
              <BattleEditor
                battle={content.battle || newContent().battle}
                onChange={(battle) => setContent({ ...content, battle })}
              />
            )}
            <section className="ss-editor-section">
              <div className="ss-section-heading">
                <h2>{content.kind === "battle" ? "战况补充" : "正文"}</h2>
                <small>{content.body.length} / 20000</small>
              </div>
              <label>
                {content.kind === "battle" ? "补充说明（选填）" : "见闻正文"}
                <textarea
                  aria-label="见闻正文"
                  rows={content.kind === "battle" ? 5 : 10}
                  maxLength={20000}
                  value={content.body}
                  placeholder={
                    content.kind === "battle"
                      ? "可以简短记录战斗经过；不需要写成长篇文章。"
                      : "讲述你的航行故事，或介绍军团的最新消息。"
                  }
                  onChange={(event) =>
                    setContent({ ...content, body: event.target.value })
                  }
                />
              </label>
            </section>
            <section className="ss-editor-section">
              <div className="ss-section-heading">
                <div>
                  <h2>图片与 KM 附件</h2>
                  <p>仅作为图片展示，不自动识别或估算损失。</p>
                </div>
                <small>{content.images.length} / 12</small>
              </div>
              <label className="ss-upload">
                添加图片
                <input
                  aria-label="上传见闻图片"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = "";
                    addFiles(files);
                  }}
                />
              </label>
              <p className="ss-muted">
                JPEG、PNG、WebP，每张不超过 5 MB；上传前会先创建草稿。
              </p>
              <div className="ss-upload-grid">
                {content.images.map((image, index) => (
                  <div key={image.id}>
                    <SafeImage id={image.id} isPrivate />
                    <label>
                      图片说明
                      <input
                        aria-label={`第${index + 1}张图片说明`}
                        value={image.caption}
                        maxLength={240}
                        onChange={(event) =>
                          setContent({
                            ...content,
                            images: content.images.map((value) =>
                              value.id === image.id
                                ? { ...value, caption: event.target.value }
                                : value,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setContent({
                          ...content,
                          images: content.images.filter(
                            (value) => value.id !== image.id,
                          ),
                        })
                      }
                    >
                      移除图片 {index + 1}
                    </button>
                  </div>
                ))}
              </div>
              {uploads.map((item) => (
                <div className="ss-upload-attempt" key={item.requestId}>
                  <span>{item.file.name}</span>
                  <span>{item.error || "待上传 / 上传中"}</span>
                  <button type="button" onClick={() => retryUpload(item)}>
                    重试上传
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setUploads((value) =>
                        value.filter(
                          (file) => file.requestId !== item.requestId,
                        ),
                      )
                    }
                  >
                    移除待上传
                  </button>
                </div>
              ))}
            </section>
            <section className="ss-editor-section">
              <h2>关联军团</h2>
              <CorporationEditor
                value={content.corporation_id}
                onChange={(corporation_id) =>
                  setContent({ ...content, corporation_id })
                }
                selected={entry?.corporation}
              />
            </section>
          </fieldset>
          <footer className="ss-editor-toolbar">
            <span>
              {busy
                ? "正在处理，请稍候…"
                : dirty
                  ? "未保存的修改"
                  : "草稿仅你和审核员可见"}
            </span>
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? "收起预览" : "预览"}
              </button>
              <button type="button" disabled={busy} onClick={() => save(false)}>
                保存草稿
              </button>
              <button
                type="button"
                className="ss-primary"
                disabled={busy}
                onClick={() => save(true)}
              >
                提交审核
              </button>
            </div>
          </footer>
          {preview && (
            <section className="ss-preview">
              <div className="ss-section-heading">
                <h2>内容预览</h2>
                <span>战损为本地预览，公开时由服务端重新汇总。</span>
              </div>
              <PostContent
                entry={{
                  ...entry,
                  revision: { content },
                  summary: content.kind === "battle" ? summary : null,
                }}
                isPrivate
                preview
              />
            </section>
          )}
        </>
      )}
    </section>
  );
}
export default function StarseaEditor() {
  return (
    <AccountBoundary required>
      <Editor />
    </AccountBoundary>
  );
}
