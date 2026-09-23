import hashlib
import warnings
from io import BytesIO

from django.core.files.storage import FileSystemStorage
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import APIException, ValidationError

from .preflight import PreflightError, check_storage_configuration

MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 20_000_000


class StorageUnavailable(APIException):
    status_code = 503
    default_detail = '图片暂时无法保存或读取，请稍后再试。'


def private_storage():
    # Apply the same read-only gate during media access as during release checks.
    # Otherwise a later configuration change could bypass the private/persistent
    # root policy, or a valid prefixed STATICFILES_DIRS entry could break uploads.
    try:
        resolved = check_storage_configuration()
    except (PreflightError, OSError, RuntimeError, TypeError, ValueError) as exc:
        raise StorageUnavailable() from exc
    return FileSystemStorage(location=resolved, base_url=None, file_permissions_mode=0o600, directory_permissions_mode=0o700)


def upload_bytes(upload):
    """Bounded, cheap read only. Never invokes a decoder before quota reservation."""
    if not upload or not hasattr(upload, 'read'):
        raise ValidationError({'file': '请选择需要上传的图片。'})
    return upload.read(MAX_BYTES + 1)


def sanitized_image(upload, raw=None):
    if not upload or not hasattr(upload, 'read') or upload.size > MAX_BYTES:
        raise ValidationError({'file': '请选择不超过 5 MiB 的 PNG、JPEG 或 WebP 图片。'})
    if raw is None:
        raw = upload_bytes(upload)
    if not raw or len(raw) > MAX_BYTES:
        raise ValidationError({'file': '文件不能为空且不能超过 5 MiB。'})
    extension = str(upload.name).rsplit('.', 1)[-1].lower()
    expected = {'png': 'PNG', 'jpg': 'JPEG', 'jpeg': 'JPEG', 'webp': 'WEBP'}.get(extension)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                if not expected or image.format != expected or image.width * image.height > MAX_PIXELS or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError
                image.verify()
            with Image.open(BytesIO(raw)) as image:
                image.load()
                oriented = ImageOps.exif_transpose(image)
                oriented.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
                # A new raster removes all EXIF, XMP, ICC, text and source metadata.
                mode = 'RGBA' if 'A' in oriented.getbands() or 'transparency' in oriented.info else 'RGB'
                converted = oriented.convert(mode)
                clean = Image.new(mode, converted.size)
                clean.paste(converted)
                output = BytesIO()
                clean.save(output, 'WEBP', quality=90, method=4)
                data = output.getvalue()
                if len(data) > MAX_BYTES:
                    raise ValueError
                metadata = dict(width=clean.width, height=clean.height, size=len(data), content_type='image/webp', sha256=hashlib.sha256(data).hexdigest(), original_sha256=hashlib.sha256(raw).hexdigest())
                return metadata, data
    except (ValueError, OSError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValidationError({'file': '图片无效、格式不符、含动画或像素超过 2000 万。'})
