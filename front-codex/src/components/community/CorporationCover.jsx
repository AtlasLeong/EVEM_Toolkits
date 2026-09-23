import { useState } from "react";
import { useCommunityImage } from "./CorporationUI";
import { defaultCorporationCoverKey } from "../../utils/corporationCover";
import { corporationCoverUrl } from "../../utils/corporationCoverAssets";

export default function CorporationCover({ corporation, thumbnail = false, loadUpload = true }) {
  const key = defaultCorporationCoverKey(corporation);
  const defaultUrl = corporationCoverUrl(key, thumbnail);
  const image = useCommunityImage(loadUpload ? corporation.cover_url : null);
  const [loadedUpload, setLoadedUpload] = useState(null);
  const [failedUpload, setFailedUpload] = useState(null);
  const [failedDefault, setFailedDefault] = useState(null);
  const decodeFailed = Boolean(image.url && failedUpload === image.url);
  const uploadUrl = decodeFailed ? null : image.url;
  const showUpload = Boolean(uploadUrl && loadedUpload === uploadUrl);
  const uploadState = image.error || decodeFailed
    ? "failed"
    : showUpload ? "ready" : corporation.cover_url ? "loading" : "none";

  return (
    <span
      className="corp-cover-surface"
      data-cover-key={key}
      data-cover-kind={showUpload ? "custom" : "default"}
      data-cover-upload-state={uploadState}
      aria-hidden="true"
    >
      <img
        src={defaultUrl}
        className={`corp-cover-picture corp-cover-default${showUpload || failedDefault === defaultUrl ? " is-hidden" : ""}`}
        alt=""
        loading={thumbnail ? "lazy" : "eager"}
        decoding="async"
        onError={() => setFailedDefault(defaultUrl)}
      />
      {uploadUrl && (
        <img
          key={uploadUrl}
          src={uploadUrl}
          className={`corp-cover-picture corp-cover-upload${showUpload ? " is-ready" : ""}`}
          alt=""
          decoding="async"
          onLoad={() => setLoadedUpload(uploadUrl)}
          onError={() => setFailedUpload(uploadUrl)}
        />
      )}
    </span>
  );
}
