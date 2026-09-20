import { useEffect, useRef, useState } from "react";
import { Download, Image as ImageIcon } from "lucide-react";
import {
  POSTER_BACKGROUNDS,
  POSTER_TEMPLATES,
  drawCorporationPoster,
  normalizePosterBackground,
  posterFilename,
} from "../../utils/corporationPoster";
import { CommunityError, useCommunityImage } from "./CorporationUI";

const decodeImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(
      () => reject(new Error("图片加载超时，请重试")),
      12000,
    );
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("图片无法加载，请重试"));
    };
    image.src = url;
  });

export default function PosterStudio({
  corporation,
  content,
  approved = false,
  isPrivate = false,
  onBackgroundChange,
}) {
  const [template, setTemplate] = useState("recruitment");
  const [background, setBackground] = useState(
    normalizePosterBackground(content?.poster_background),
  );
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const canvas = useRef(null);
  const exportLock = useRef(false);
  const logo = useCommunityImage(
    content.logo_url || corporation.logo_url,
    isPrivate,
    retry,
  );
  const cover = useCommunityImage(
    content.cover_url || corporation.cover_url,
    isPrivate,
    retry,
  );
  useEffect(() => {
    setBackground(normalizePosterBackground(content?.poster_background));
  }, [content?.poster_background]);
  const serialized = JSON.stringify({ corporation, content, background });
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        if (logo.error || cover.error) throw logo.error || cover.error;
        if ((logo.source && !logo.url) || (cover.source && !cover.url)) return;
        await document.fonts.ready;
        const [logoImage, coverImage] = await Promise.all([
          logo.url ? decodeImage(logo.url) : null,
          cover.url ? decodeImage(cover.url) : null,
        ]);
        if (!active || !canvas.current) return;
        const offscreen = document.createElement("canvas");
        drawCorporationPoster(
          offscreen,
          corporation,
          { ...content, poster_background: background },
          template,
          approved,
          { logo: logoImage, cover: coverImage },
        );
        canvas.current.width = 1080;
        canvas.current.height = 1440;
        canvas.current.getContext("2d").drawImage(offscreen, 0, 0);
        setBusy(false);
      } catch (err) {
        if (active) {
          setError(err);
          setBusy(false);
        }
      }
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    serialized,
    template,
    background,
    approved,
    logo.url,
    logo.error,
    logo.source,
    cover.url,
    cover.error,
    cover.source,
    retry,
  ]);
  const download = async () => {
    if (busy || error || !canvas.current || exportLock.current) return;
    exportLock.current = true;
    try {
      const blob = await new Promise((resolve, reject) =>
        canvas.current.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("海报生成失败，请重试")),
          "image/png",
        ),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = posterFilename(corporation.name, template, approved);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setError(err);
    } finally {
      exportLock.current = false;
    }
  };
  const chooseBackground = (next) => {
    const normalized = normalizePosterBackground(next);
    setBackground(normalized);
    onBackgroundChange?.(normalized);
  };
  return (
    <section className="corp-poster-studio" aria-label="海报工作台">
      <div className="corp-section-heading">
        <div>
          <span className="corp-eyebrow">POSTER STUDIO</span>
          <h2>让招募更有辨识度</h2>
        </div>
        <ImageIcon size={20} aria-hidden="true" />
      </div>
      <div
        className="corp-template-switch"
        role="group"
        aria-label="选择海报模板"
      >
        {Object.entries(POSTER_TEMPLATES).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={template === id}
            className={template === id ? "active" : ""}
            onClick={() => setTemplate(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="corp-background-picker">
        <div className="corp-background-picker-label">
          <span>海报背景</span>
          <small>{POSTER_BACKGROUNDS[background]}</small>
        </div>
        <div
          className="corp-background-options"
          role="group"
          aria-label="选择海报背景"
        >
          {Object.entries(POSTER_BACKGROUNDS).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={background === id}
              className={`corp-background-option${background === id ? " active" : ""}`}
              data-background={id}
              onClick={() => chooseBackground(id)}
            >
              <span className="corp-background-swatch" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={`corp-poster-frame${busy ? " is-busy" : ""}`}>
        <canvas
          ref={canvas}
          aria-label={`${POSTER_TEMPLATES[template]}预览${approved ? "" : "，未审核"}`}
        />
        <span className="corp-poster-loading" hidden={!busy}>
          正在生成预览…
        </span>
      </div>
      <CommunityError error={error} retry={() => setRetry((x) => x + 1)} />
      <div className="corp-poster-note">
        <span>{approved ? "来自当前已审核资料" : "未审核 · 仅作预览"}</span>
        <span>1080 × 1440</span>
      </div>
      <button
        type="button"
        className="primary-btn corp-export"
        disabled={busy || Boolean(error)}
        onClick={download}
      >
        <Download size={17} />
        导出 PNG
      </button>
      <p className="corp-hint">
        长文案会自动换行并节选。导出前请检查预览中的标题、时间和联系方式。
      </p>
    </section>
  );
}
