import { useEffect, useRef, useState } from "react";
import { Check, Download } from "lucide-react";
import { POSTER_BACKGROUNDS, POSTER_TEMPLATES, drawCorporationPoster, normalizePosterBackground, posterFilename } from "../../utils/corporationPoster";
import { posterArtworkUrl, posterThumbnailUrl } from "../../utils/corporationPosterAssets";
import { CommunityError, useCommunityImage } from "./CorporationUI";
import "../../styles/corporationPoster.css";

const decodeImage = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  const finish = (error) => {
    clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
    if (error) reject(error);
    else resolve(image);
  };
  const timer = setTimeout(() => finish(new Error("图片加载超时，请重试")), 12000);
  image.onload = () => finish();
  image.onerror = () => finish(new Error("图片无法加载，请重试"));
  image.src = url;
});

export default function PosterStudio({ corporation, content, approved = false, isPrivate = false, onBackgroundChange }) {
  const [template, setTemplate] = useState("recruitment");
  const [background, setBackground] = useState(normalizePosterBackground(content?.poster_background));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [renderedKey, setRenderedKey] = useState(null);
  const [exporting, setExporting] = useState(false);
  const canvas = useRef(null);
  const exportLock = useRef(false);
  const readyKey = useRef(null);
  const mounted = useRef(true);
  const logo = useCommunityImage(content.logo_url || corporation.logo_url, isPrivate, retry);
  const cover = useCommunityImage(content.cover_url || corporation.cover_url, isPrivate, retry);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readyKey.current = null; };
  }, []);
  useEffect(() => {
    setBackground(normalizePosterBackground(content?.poster_background));
  }, [content?.poster_background]);
  const renderKey = JSON.stringify({ corporation, content, background, template, approved, retry, logo: logo.url, cover: cover.url });
  const canExport = !busy && !error && !exporting && renderedKey === renderKey;
  useEffect(() => {
    let active = true;
    readyKey.current = null;
    setBusy(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        if (logo.error || cover.error) throw logo.error || cover.error;
        if ((logo.source && !logo.url) || (cover.source && !cover.url)) return;
        await document.fonts.ready;
        const [logoImage, coverImage, artwork] = await Promise.all([
          logo.url ? decodeImage(logo.url) : null,
          cover.url ? decodeImage(cover.url) : null,
          decodeImage(posterArtworkUrl(background)),
        ]);
        if (!active || !canvas.current) return;
        const offscreen = document.createElement("canvas");
        drawCorporationPoster(offscreen, corporation, { ...content, poster_background: background }, template, approved,
          { logo: logoImage, cover: coverImage, background: artwork });
        canvas.current.width = 1080;
        canvas.current.height = 1440;
        const context = canvas.current.getContext("2d");
        if (!context) throw new Error("浏览器不支持海报绘制");
        context.drawImage(offscreen, 0, 0);
        canvas.current.dataset.background = background;
        canvas.current.dataset.template = template;
        readyKey.current = renderKey;
        setRenderedKey(renderKey);
        setBusy(false);
      } catch (err) {
        if (active) { setError(err); setBusy(false); }
      }
    }, 100);
    return () => { active = false; clearTimeout(timer); };
  }, [renderKey, logo.error, cover.error, logo.source, cover.source]);

  const download = async () => {
    if (!canExport || readyKey.current !== renderKey || !canvas.current || exportLock.current) return;
    const snapshotKey = readyKey.current;
    exportLock.current = true;
    setExporting(true);
    try {
      const blob = await new Promise((resolve, reject) => canvas.current.toBlob(
        value => value ? resolve(value) : reject(new Error("海报生成失败，请重试")), "image/png"));
      if (!mounted.current || readyKey.current !== snapshotKey) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = posterFilename(corporation.name, template, approved);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      if (mounted.current) setError(err);
    } finally {
      exportLock.current = false;
      if (mounted.current) setExporting(false);
    }
  };
  const chooseBackground = next => {
    if (next === background) return;
    readyKey.current = null;
    setBackground(next);
    onBackgroundChange?.(next);
  };

  return (
    <section className="corp-poster-studio" aria-label="海报工作台">
      <div className="corp-studio-controls">
        <div className="corp-studio-settings">
        <div className="corp-studio-intro">
          <h3>选择画面，传达你们的故事</h3>
          <p>军团资料自动排版，挑选适合你们的背景即可导出。</p>
        </div>
        <div className="corp-studio-field">
          <span className="corp-studio-label">海报内容</span>
          <div className="corp-template-switch" role="group" aria-label="选择海报模板">
            {Object.entries(POSTER_TEMPLATES).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={template === id} disabled={exporting}
                className={template === id ? "active" : ""} onClick={() => { if (template !== id) { readyKey.current = null; setTemplate(id); } }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="corp-background-picker">
          <div className="corp-background-picker-label">
            <span>海报背景</span><small>8 种星海视角</small>
          </div>
          <div className="corp-background-options" role="group" aria-label="选择海报背景">
            {Object.entries(POSTER_BACKGROUNDS).map(([id, label]) => (
              <button key={id} type="button" aria-label={label} aria-pressed={background === id} disabled={exporting}
                className={"corp-background-option" + (background === id ? " active" : "")}
                data-background={id} onClick={() => chooseBackground(id)}>
                <img src={posterThumbnailUrl(id)} alt="" width="160" height="100" />
                <span>{label}</span>
                {background === id && <Check size={15} className="corp-art-check" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
        <CommunityError error={error} retry={() => setRetry(x => x + 1)} />
        </div>
        <div className="corp-studio-export">
          <button type="button" className="primary-btn corp-export" disabled={!canExport} onClick={download}>
            <Download size={17} />{exporting ? "正在导出…" : "导出 PNG"}
          </button>
          <p className="corp-hint">长文案会自动节选。导出前请核对标题、时间与联系方式。</p>
          {onBackgroundChange && <p className="corp-hint">背景选择随资料草稿保存；导出海报不会提交审核。</p>}
        </div>
      </div>
      <div className="corp-studio-preview">
        <div className="corp-poster-preview-label"><span>实时预览</span><span>1080 × 1440</span></div>
        <div className={"corp-poster-frame" + (!canExport && !exporting ? " is-busy" : "")} aria-busy={busy}>
          <canvas ref={canvas} aria-label={POSTER_TEMPLATES[template] + "预览" + (approved ? "" : "，未审核")} />
          <span className="corp-poster-loading" hidden={!busy}>正在生成预览…</span>
        </div>
        <p className="corp-poster-note">{approved ? "来自当前已审核资料" : "未审核 · 仅作预览"}</p>
      </div>
    </section>
  );
}
