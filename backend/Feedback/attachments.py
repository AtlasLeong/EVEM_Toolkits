import hashlib
import re
import warnings
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from PIL import Image, UnidentifiedImageError
from rest_framework.exceptions import APIException, ValidationError

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TICKET_BYTES = 50 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
CONTENT_TYPES = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                 'webp': 'image/webp', 'pdf': 'application/pdf', 'txt': 'text/plain', 'log': 'text/plain'}


class UploadUnavailable(APIException):
    status_code = 503
    default_detail = '附件暂时无法保存或读取，请稍后重试。'


def private_storage():
    root = getattr(settings, 'FEEDBACK_UPLOAD_ROOT', None)
    if not root or not Path(root).is_absolute():
        raise UploadUnavailable()
    return FileSystemStorage(location=root, base_url=None, file_permissions_mode=0o600, directory_permissions_mode=0o700)


def attachment_data(attachment):
    return {name: getattr(attachment, name) for name in ('id', 'name', 'size', 'content_type', 'created_at')}


def validated_upload(upload):
    if not upload or not hasattr(upload, 'read'):
        raise ValidationError({'file': '请选择需要上传的文件。'})
    name = re.sub(r'[\x00-\x1f\x7f]', '', upload.name.replace('\\', '/').split('/')[-1]).strip()
    if not name or len(name) > 200:
        raise ValidationError({'file': '文件名无效或超过 200 个字符。'})
    extension = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if extension not in CONTENT_TYPES:
        raise ValidationError({'file': '仅支持 PNG、JPG、WEBP、PDF、TXT 和 LOG 文件。'})
    if upload.size > MAX_FILE_BYTES:
        raise ValidationError({'file': '每个文件不能超过 10 MiB。'})
    data = upload.read(MAX_FILE_BYTES + 1)
    if not data or len(data) > MAX_FILE_BYTES:
        raise ValidationError({'file': '文件不能为空且不能超过 10 MiB。'})
    try:
        if extension in ('png', 'jpg', 'jpeg', 'webp'):
            expected_format = {'jpg': 'JPEG', 'jpeg': 'JPEG', 'png': 'PNG', 'webp': 'WEBP'}[extension]
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(BytesIO(data)) as picture:
                    if picture.format != expected_format or picture.width * picture.height > MAX_IMAGE_PIXELS:
                        raise ValueError
                    # No animated images: avoids many-frame decompression and ambiguous previews.
                    if getattr(picture, 'n_frames', 1) != 1:
                        raise ValueError
                    picture.verify()
                with Image.open(BytesIO(data)) as picture:
                    picture.load()
        elif extension == 'pdf':
            if not data.startswith(b'%PDF-'):
                raise ValueError
        else:
            data.decode('utf-8-sig')
            if b'\x00' in data:
                raise ValueError
    except (ValueError, OSError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValidationError({'file': '文件内容无效、格式不匹配或图片尺寸过大。'})
    return dict(name=name, size=len(data), content_type=CONTENT_TYPES[extension],
                sha256=hashlib.sha256(data).hexdigest()), data


def store_upload(storage, data):
    # Client filenames never participate in filesystem paths.
    return storage.save(uuid4().hex, ContentFile(data))
