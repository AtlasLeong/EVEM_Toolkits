import { useState } from "react";
import { Check, Link2 } from "lucide-react";

export default function CorporationShare({ id }) {
  const [state, setState] = useState("");
  const url = new URL(`/corporations/${id}`, window.location.origin).href;
  const localPreview =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("manual");
    }
  };
  return (
    <div className="corp-share">
      <button type="button" className="ghost-btn" onClick={copy}>
        {state === "copied" ? <Check size={16} /> : <Link2 size={16} />}分享军团
      </button>
      {state === "copied" && (
        <span className="corp-share-status" role="status">
          {localPreview ? "已复制 · 本地链接仅本机可访问" : "链接已复制"}
        </span>
      )}
      {state === "manual" && (
        <div className="corp-share-fallback">
          <p role="status">自动复制未成功，请选择下方链接手动复制。</p>
          <input
            className="text-input"
            aria-label="军团分享链接"
            value={url}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          {localPreview ? (
            <small>本地预览链接仅本机可访问，上线后会使用正式域名。</small>
          ) : null}
        </div>
      )}
    </div>
  );
}
