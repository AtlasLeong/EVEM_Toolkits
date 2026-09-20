import copy
import hashlib
import json
import logging
import unicodedata
from datetime import timedelta
from uuid import UUID, uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import DatabaseError, transaction
from django.db.models import Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.cache import patch_vary_headers
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, Throttled, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .activity import (ACTIVITY_DESCRIPTION_LIMIT, CURRENT_ACTIVITIES, READABLE_ACTIVITIES,
                       is_unicode_text, normalized_custom_tags, validated_custom_tags)
from .media import StorageUnavailable, private_storage, sanitized_image, upload_bytes
from .models import Claim, Corporation, DraftRequest, MediaAsset, MediaUploadAttempt, Revision
from .location import normalized_location, validated_location

logger = logging.getLogger(__name__)
TEXT_FIELDS = {'tagline': 80, 'introduction': 5000, 'alliance': 80, 'base_region': 80,
               'active_time': 120, 'requirements': 1500, 'benefits': 1500, 'public_contact': 200,
               'event_title': 80, 'event_time': 120, 'event_location': 120, 'event_description': 800,
               'activity_description': ACTIVITY_DESCRIPTION_LIMIT}
ACTIVITIES = CURRENT_ACTIVITIES
CORP_TYPES = ('pirate', 'sovereignty')
REGION_TAGS = ('highsec', 'lowsec', 'nullsec')
BENEFIT_KEYS = ('ship_reimbursement', 'fleet_training', 'industry_support', 'logistics_support',
                'newbro_mentoring', 'skill_sharing', 'pve_fleet', 'pvp_fleet')
POSTER_BACKGROUNDS = ('expedition-fleet', 'ringed-planet', 'spiral-galaxy', 'orbital-shipyard',
                      'black-hole', 'stellar-nursery', 'frozen-frontier', 'wreckfield')
LEGACY_POSTER_BACKGROUNDS = {
    'deep-space': 'spiral-galaxy', 'ion-storm': 'stellar-nursery', 'tactical-grid': 'orbital-shipyard',
    'jump-rift': 'black-hole', 'sovereignty-border': 'ringed-planet', 'pirate-tide': 'wreckfield',
}
BENEFITS_NOTE_LIMIT = 500
CONTENT_FIELDS = {*TEXT_FIELDS, 'activities', 'custom_activity_tags', 'corp_types', 'region_tags', 'benefit_keys', 'benefits_note',
                  'poster_background', 'base_location', 'recruitment_status', 'logo_asset_id', 'cover_asset_id'}


class Conflict(APIException):
    status_code = 409
    default_detail = '内容状态已变化或提交标识冲突，请刷新后重试。'


def fields(data, required=(), optional=()):
    if not isinstance(data, dict) or set(data) - set(required) - set(optional):
        raise ValidationError({'detail': '包含不支持的字段或不是 JSON 对象。'})
    missing = set(required) - set(data)
    if missing:
        raise ValidationError({key: '此项必填。' for key in missing})


def text(data, key, limit, blank=False):
    value = data.get(key, '')
    if not isinstance(value, str) or len(value) > limit or (not blank and not value.strip()):
        raise ValidationError({key: f'请输入不超过 {limit} 字的有效文本。'})
    return value.strip()


def positive_int(value, name):
    if type(value) is not int or value < 1 or value > 9223372036854775807:
        raise ValidationError({name: '请输入正整数。'})
    return value


def request_uuid(data):
    try:
        if not isinstance(data.get('request_id'), str):
            raise ValueError
        return UUID(data['request_id'])
    except (ValueError, AttributeError):
        raise ValidationError({'request_id': '提交标识无效。'})


def pagination(request):
    raw = request.query_params.get('page', '1')
    if not raw.isascii() or not raw.isdecimal() or len(raw) > 7 or int(raw) < 1:
        raise ValidationError({'page': '页码必须为正整数。'})
    page = int(raw)
    return (page - 1) * 20, page * 20


def paged(request, query, serialize):
    start, end = pagination(request)
    return {'count': query.count(), 'results': [serialize(item) for item in query[start:end]]}


def identity(corporation):
    return dict(id=corporation.pk, name=corporation.name, short_name=corporation.short_name)


def default_content():
    return {**dict.fromkeys(TEXT_FIELDS, ''), 'activities': [], 'custom_activity_tags': [], 'corp_types': [], 'region_tags': [],
            'benefit_keys': [], 'benefits_note': '', 'poster_background': 'expedition-fleet', 'base_location': None,
            'recruitment_status': 'open', 'logo_asset_id': None, 'cover_asset_id': None}


def normalized_list(value, allowed, limit):
    """Return only valid, unique values from stored JSON content.

    Revision JSON is immutable historical data, so a public/private read must
    remain safe even if a future allow-list is narrower than an older payload.
    Input validation rejects duplicates and overflow; this read-side helper
    keeps legacy records readable by dropping unsupported entries and capping
    the resulting list deterministically.
    """
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if item in allowed and item not in result:
            result.append(item)
        if len(result) >= limit:
            break
    return result


def validated_list(data, key, allowed, limit):
    value = data[key]
    if (not isinstance(value, list) or len(value) > limit or
            any(not isinstance(item, str) or item not in allowed for item in value) or
            len(set(value)) != len(value)):
        raise ValidationError({key: f'最多选择 {limit} 项有效选项，且不能重复。'})
    return value


def image_url(corporation_id, asset_id, public=False):
    if not asset_id:
        return None
    return (f'/api/community/corporations/{corporation_id}/media/{asset_id}/' if public
            else f'/api/community/media/{asset_id}/private/')


def revision_data(revision, public=False, corporation=None):
    if revision is None:
        return None
    content = default_content()
    stored = revision.content if isinstance(revision.content, dict) else {}
    content.update({key: value for key, value in stored.items() if key in TEXT_FIELDS or key in ('activities', 'recruitment_status', 'logo_asset_id', 'cover_asset_id')})
    # Determine kind from raw JSON, before read defaults fill in the new field.
    content['activity_content_kind'] = 'overview' if 'activity_description' in stored else 'legacy_event'
    description = stored.get('activity_description', '')
    content['activity_description'] = description.strip()[:ACTIVITY_DESCRIPTION_LIMIT] if is_unicode_text(description) else ''
    content['custom_activity_tags'] = normalized_custom_tags(stored.get('custom_activity_tags'))
    content['activities'] = normalized_list(stored.get('activities'), READABLE_ACTIVITIES, len(READABLE_ACTIVITIES))
    content['corp_types'] = normalized_list(stored.get('corp_types'), CORP_TYPES, len(CORP_TYPES))
    content['region_tags'] = normalized_list(stored.get('region_tags'), REGION_TAGS, len(REGION_TAGS))
    content['benefit_keys'] = normalized_list(stored.get('benefit_keys'), BENEFIT_KEYS, len(BENEFIT_KEYS))
    note = stored.get('benefits_note', '')
    content['benefits_note'] = note.strip()[:BENEFITS_NOTE_LIMIT] if isinstance(note, str) else ''
    background = stored.get('poster_background')
    if isinstance(background, str):
        content['poster_background'] = background if background in POSTER_BACKGROUNDS else LEGACY_POSTER_BACKGROUNDS.get(background, 'expedition-fleet')
    content['base_location'] = normalized_location(stored.get('base_location'))
    if content['base_location'] is not None:
        content['base_region'] = content['base_location']['region_name']
    result = dict(id=revision.pk, **content)
    if not public:
        result.update({key: getattr(revision, key) for key in ('corporation_id', 'status', 'version', 'created_at', 'updated_at', 'submitted_at', 'reviewed_at', 'review_reason')})
        result['corporation'] = identity(corporation or revision.corporation)
        result['logo_url'] = image_url(revision.corporation_id, content['logo_asset_id'])
        result['cover_url'] = image_url(revision.corporation_id, content['cover_asset_id'])
    return result


def public_data(corporation):
    revision = corporation.published_revision
    content = revision_data(revision, True)
    return dict(**identity(corporation), published_at=revision.reviewed_at, revision=content,
                logo_url=image_url(corporation.pk, content['logo_asset_id'], True),
                cover_url=image_url(corporation.pk, content['cover_asset_id'], True))


def claim_data(claim):
    return dict(corporation=identity(claim.corporation), **{key: getattr(claim, key) for key in (
        'id', 'statement', 'contact', 'status', 'created_at', 'reviewed_at', 'review_reason')})


def manage_data(corporation, user):
    return dict(**identity(corporation), is_listed=corporation.is_listed,
                published_revision=revision_data(corporation.published_revision, corporation=corporation), working_revision=revision_data(corporation.working_revision, corporation=corporation),
                can_edit=corporation.owner_id == user.pk, can_review=bool(user.is_staff))


def media_data(asset):
    return dict(**{key: getattr(asset, key) for key in ('id', 'width', 'height', 'size', 'content_type')}, private_url=image_url(asset.corporation_id, asset.pk))


def lock_actor(user):
    get_user_model().objects.using('default').select_for_update().get(pk=user.pk)


def lock_users(user_ids):
    """Acquire every user FK row in one deterministic order before other rows."""
    ordered = sorted({int(user_id) for user_id in user_ids if user_id is not None})
    if ordered:
        list(get_user_model().objects.select_for_update().filter(pk__in=ordered).order_by('pk').values_list('pk', flat=True))


def owned_corporation(user, pk, *, lock=False, staff_read=False):
    query = Corporation.objects.using('default')
    if not (staff_read and user.is_staff):
        query = query.filter(owner_id=user.pk)
    if lock:
        query = query.select_for_update()
    return get_object_or_404(query, pk=pk)


def locked_revision(user, pk):
    corporation_id = get_object_or_404(Revision.objects.only('corporation_id'), pk=pk).corporation_id
    corporation = owned_corporation(user, corporation_id, lock=True)
    revision = get_object_or_404(Revision.objects.select_for_update(), pk=pk, corporation_id=corporation.pk)
    if corporation.working_revision_id != revision.pk:
        raise Conflict()
    return corporation, revision


def check_version(revision, data, status):
    expected = positive_int(data.get('expected_version'), 'expected_version')
    if revision.version != expected or revision.status != status:
        raise Conflict()


def quota(query, limit):
    if query.count() >= limit:
        raise Throttled(detail='操作次数已达上限，请稍后重试。')


def recent():
    return timezone.now() - timedelta(days=1)


class PrivateAPI(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    # Community uses persistent DB quotas under actor locks, not email throttles.
    throttle_classes = []

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        for key in ('pk', 'asset_id'):
            if key in kwargs:
                positive_int(kwargs[key], key)

    def handle_exception(self, exc):
        try:
            return super().handle_exception(exc)
        except Exception as unhandled:
            # Do not leak SQL, uploaded data, exception messages or tracebacks.
            # Returning through DRF also guarantees finalize_response cache headers.
            logger.error('Community request failed in %s (%s)', type(self).__name__, type(unhandled).__name__)
            status = 503 if isinstance(unhandled, (DatabaseError, OSError)) else 500
            response = Response({'detail': '服务暂时不可用，请稍后重试。'}, status=status)
            response.exception = True
            return response

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'private, no-store'
        patch_vary_headers(response, ['Authorization'])
        return response


class PublicAPI(PrivateAPI):
    authentication_classes = []
    permission_classes = [AllowAny]


class StaffAPI(PrivateAPI):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not request.user.is_staff:
            raise PermissionDenied('仅管理员可审核军团内容。')


def listed():
    return Corporation.objects.filter(is_listed=True, published_revision__status='approved').select_related('published_revision')


class CorporationList(PublicAPI):
    def get(self, request):
        query = listed().order_by('-published_revision__reviewed_at', '-pk')
        search = request.query_params.get('q', '').strip()
        if len(search) > 80:
            raise ValidationError({'q': '搜索词不能超过 80 字。'})
        if search:
            query = query.filter(Q(name__icontains=search) | Q(short_name__icontains=search))
        activity = request.query_params.get('activity', '')
        if activity:
            if activity not in READABLE_ACTIVITIES:
                raise ValidationError({'activity': '请选择有效活动。'})
            query = query.filter(published_revision__activity_keys__contains=f'|{activity}|')
        region = request.query_params.get('region', '').strip()
        if len(region) > 80:
            raise ValidationError({'region': '星域名称不能超过 80 字。'})
        if region:
            query = query.filter(published_revision__content__base_region__icontains=region)
        return Response(paged(request, query, public_data))


class CorporationDetail(PublicAPI):
    def get(self, request, pk):
        return Response(public_data(get_object_or_404(listed(), pk=pk)))


class Capabilities(PrivateAPI):
    def get(self, request):
        return Response({'can_review': bool(request.user.is_staff)})


class Mine(PrivateAPI):
    def get(self, request):
        start, end = pagination(request)
        claims = Claim.objects.filter(applicant=request.user).select_related('corporation').order_by('-pk')
        corporations = Corporation.objects.filter(owner=request.user).select_related('working_revision', 'published_revision').order_by('-pk')
        return Response(dict(claims=[claim_data(item) for item in claims[start:end]], corporations=[manage_data(item, request.user) for item in corporations[start:end]], claims_count=claims.count(), corporations_count=corporations.count()))


class Claims(PrivateAPI):
    def post(self, request):
        common = ('request_id', 'statement', 'contact')
        existing = 'corporation_id' in request.data
        fields(request.data, (*common, 'corporation_id') if existing else (*common, 'name', 'short_name'))
        request_id = request_uuid(request.data)
        payload = dict(statement=text(request.data, 'statement', 1000), contact=text(request.data, 'contact', 200))
        if existing:
            payload['corporation_id'] = positive_int(request.data['corporation_id'], 'corporation_id')
        else:
            name = unicodedata.normalize('NFKC', text(request.data, 'name', 80)).strip()
            if not name or len(name) > 80:
                raise ValidationError({'name': '军团名称无效。'})
            payload.update(name=name, short_name=text(request.data, 'short_name', 20, True))
        fingerprint = dict(payload)
        if not existing:
            # Display spelling is preserved, while retries use the same normalized
            # identity as the unique corporation name key.
            fingerprint['name'] = name.casefold()
        payload_hash = hashlib.sha256(json.dumps(fingerprint, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with transaction.atomic(using='default'):
            lock_actor(request.user)
            previous = Claim.objects.filter(applicant=request.user, request_id=request_id).first()
            if previous:
                if previous.payload_hash != payload_hash:
                    raise Conflict()
                return Response(claim_data(previous))
            quota(Claim.objects.filter(applicant=request.user, created_at__gte=recent()), getattr(settings, 'COMMUNITY_CLAIMS_PER_DAY', 5))
            if existing:
                corporation = get_object_or_404(Corporation.objects.select_for_update(), pk=payload['corporation_id'])
            else:
                key = hashlib.sha256(('cn:' + name.casefold()).encode()).hexdigest()
                corporation, _ = Corporation.objects.get_or_create(name_key=key, defaults={'name': name, 'short_name': payload['short_name']})
                corporation = Corporation.objects.select_for_update().get(pk=corporation.pk)
            if corporation.owner_id is not None or Claim.objects.filter(corporation=corporation, applicant=request.user, status='pending').exists():
                raise Conflict()
            claim = Claim.objects.create(corporation=corporation, applicant=request.user, request_id=request_id, payload_hash=payload_hash, statement=payload['statement'], contact=payload['contact'])
        return Response(claim_data(claim), status=201)


class ClaimDetail(PrivateAPI):
    def get(self, request, pk):
        query = Claim.objects.select_related('corporation')
        if not request.user.is_staff:
            query = query.filter(applicant=request.user)
        return Response(claim_data(get_object_or_404(query, pk=pk)))


class Manage(PrivateAPI):
    def get(self, request, pk):
        return Response(manage_data(owned_corporation(request.user, pk, staff_read=True), request.user))


class Draft(PrivateAPI):
    def post(self, request, pk):
        fields(request.data, ('request_id',))
        request_id = request_uuid(request.data)
        with transaction.atomic(using='default'):
            lock_actor(request.user)
            corporation = owned_corporation(request.user, pk, lock=True)
            previous = DraftRequest.objects.filter(author=request.user, request_id=request_id).first()
            if previous:
                if previous.corporation_id != pk:
                    raise Conflict()
                return Response(revision_data(previous.revision))
            quota(DraftRequest.objects.filter(author=request.user, created_at__gte=recent()), getattr(settings, 'COMMUNITY_DRAFTS_PER_DAY', 100))
            current = corporation.working_revision
            if current and current.status == 'pending':
                raise Conflict()
            created = not current or current.status != 'draft'
            if created:
                source = current or corporation.published_revision
                current = Revision.objects.create(corporation=corporation, author=request.user, content=copy.deepcopy(source.content) if source else default_content(), activity_keys=source.activity_keys if source else '')
                corporation.working_revision = current
                corporation.save(update_fields=['working_revision'])
            DraftRequest.objects.create(author=request.user, request_id=request_id, corporation=corporation, revision=current)
        return Response(revision_data(current), status=201 if created else 200)


def updated_content(data, corporation, old):
    result = copy.deepcopy(old)
    if 'activity_description' in data and not is_unicode_text(data['activity_description']):
        raise ValidationError({'activity_description': '请输入有效的 Unicode 文本。'})
    for key, limit in TEXT_FIELDS.items():
        if key in data:
            result[key] = text(data, key, limit, True)
    old_location = normalized_location(old.get('base_location'))
    if 'base_location' in data:
        result['base_location'] = validated_location(data['base_location'])
        if result['base_location'] is not None:
            result['base_region'] = result['base_location']['region_name']
        elif old_location is not None:
            result['base_region'] = ''
    elif old_location is not None:
        # Older clients may still send base_region; never let this derived
        # filter field drift away from the linked location's approved snapshot.
        result['base_region'] = old_location['region_name']
    if 'activities' in data:
        # old is the locked working revision, not a client or public snapshot.
        allowed = READABLE_ACTIVITIES if isinstance(old.get('activities'), list) and 'pvp' in old['activities'] else ACTIVITIES
        result['activities'] = validated_list(data, 'activities', allowed, len(allowed))
    if 'custom_activity_tags' in data:
        result['custom_activity_tags'] = validated_custom_tags(data['custom_activity_tags'])
    if 'corp_types' in data:
        result['corp_types'] = validated_list(data, 'corp_types', CORP_TYPES, len(CORP_TYPES))
    if 'region_tags' in data:
        result['region_tags'] = validated_list(data, 'region_tags', REGION_TAGS, len(REGION_TAGS))
    if 'benefit_keys' in data:
        result['benefit_keys'] = validated_list(data, 'benefit_keys', BENEFIT_KEYS, len(BENEFIT_KEYS))
    if 'benefits_note' in data:
        result['benefits_note'] = text(data, 'benefits_note', BENEFITS_NOTE_LIMIT, True)
    if 'poster_background' in data:
        value = data['poster_background']
        if not isinstance(value, str) or value not in POSTER_BACKGROUNDS:
            raise ValidationError({'poster_background': '请选择有效海报背景。'})
        result['poster_background'] = value
    if 'recruitment_status' in data:
        if data['recruitment_status'] not in ('open', 'closed'):
            raise ValidationError({'recruitment_status': '请选择有效招募状态。'})
        result['recruitment_status'] = data['recruitment_status']
    for key in ('logo_asset_id', 'cover_asset_id'):
        if key in data:
            value = data[key]
            if value is not None:
                positive_int(value, key)
                if not MediaAsset.objects.filter(pk=value, corporation=corporation).exists():
                    raise ValidationError({key: '图片不属于本军团。'})
            result[key] = value
    return result


class RevisionEdit(PrivateAPI):
    def patch(self, request, pk):
        fields(request.data, ('expected_version',), CONTENT_FIELDS)
        with transaction.atomic(using='default'):
            corporation, revision = locked_revision(request.user, pk)
            check_version(revision, request.data, 'draft')
            revision.content = updated_content(request.data, corporation, revision.content)
            revision.activity_keys = ''.join(f'|{item}|' for item in revision.content.get('activities', []))
            revision.version += 1
            revision.save(update_fields=['content', 'activity_keys', 'version', 'updated_at'])
        return Response(revision_data(revision))


class RevisionTransition(PrivateAPI):
    def post(self, request, pk, action):
        fields(request.data, ('expected_version',))
        with transaction.atomic(using='default'):
            _, revision = locked_revision(request.user, pk)
            check_version(revision, request.data, 'draft' if action == 'submit' else 'pending')
            if action == 'submit':
                for key in ('introduction', 'public_contact'):
                    text(revision.content, key, TEXT_FIELDS[key])
                revision.status = 'pending'
                revision.submitted_at = timezone.now()
            else:
                revision.status = 'withdrawn'
            revision.version += 1
            revision.save(update_fields=['status', 'submitted_at', 'version', 'updated_at'])
        return Response(revision_data(revision))


class MediaUpload(PrivateAPI):
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        # Reject repeated multipart keys instead of silently choosing an ambiguous value.
        if set(request.data) != {'request_id', 'file'} or any(len(request.data.getlist(key)) != 1 for key in request.data):
            raise ValidationError({'detail': '请提交一张图片和提交标识。'})
        request_id = request_uuid(request.data)
        owned_corporation(request.user, pk)
        storage = private_storage()
        raw = upload_bytes(request.data['file'])
        original_sha256 = hashlib.sha256(raw).hexdigest()
        # Commit the reservation before CPU-heavy conversion. Failed images and
        # crashed workers count too; another process cannot replay this UUID.
        with transaction.atomic(using='default'):
            lock_actor(request.user)
            corporation = owned_corporation(request.user, pk, lock=True)
            previous = MediaAsset.objects.filter(uploader=request.user, request_id=request_id).first()
            if previous:
                if previous.corporation_id != pk or previous.original_sha256 != original_sha256:
                    raise Conflict()
                return Response(media_data(previous))
            attempted = MediaUploadAttempt.objects.filter(uploader=request.user, request_id=request_id).first()
            if attempted:
                if attempted.corporation_id != pk or attempted.original_sha256 != original_sha256:
                    raise Conflict()
                if attempted.status == 'failed':
                    raise ValidationError({'file': '此图片提交已失败，请重新选择图片并使用新的提交标识。'})
                raise Conflict('此图片提交正在处理，请稍后重试。')
            upload_quota(request.user, corporation)
            quota(MediaUploadAttempt.objects.filter(uploader=request.user, created_at__gte=recent()), getattr(settings, 'COMMUNITY_MEDIA_ATTEMPTS_PER_DAY', 60))
            attempt = MediaUploadAttempt.objects.create(corporation=corporation, uploader=request.user, request_id=request_id, original_sha256=original_sha256)
        stored = None
        try:
            metadata, data = sanitized_image(request.data['file'], raw=raw)
            with transaction.atomic(using='default'):
                lock_actor(request.user)
                corporation = owned_corporation(request.user, pk, lock=True)
                attempt = MediaUploadAttempt.objects.select_for_update().get(pk=attempt.pk)
                if attempt.status != 'processing':
                    raise Conflict()
                # Other completed requests may have consumed capacity while the
                # decoder ran without holding any account/corporation row locks.
                upload_quota(request.user, corporation)
                stored = storage.save(uuid4().hex + '.webp', ContentFile(data))
                asset = MediaAsset.objects.create(corporation=corporation, uploader=request.user, request_id=request_id, storage_name=stored, **metadata)
                attempt.status = 'completed'
                attempt.finished_at = timezone.now()
                attempt.save(update_fields=['status', 'finished_at'])
            return Response(media_data(asset), status=201)
        except Exception as exc:
            if stored:
                try:
                    storage.delete(stored)
                except OSError:
                    logger.error('Community media cleanup failed; reconcile orphan %s', stored)
            try:
                with transaction.atomic(using='default'):
                    lock_actor(request.user)
                    Corporation.objects.select_for_update().get(pk=pk)
                    failed = MediaUploadAttempt.objects.select_for_update().get(pk=attempt.pk)
                    failed.status = 'failed'
                    failed.finished_at = timezone.now()
                    failed.save(update_fields=['status', 'finished_at'])
            except Exception as marking_error:
                logger.error('Community upload failure marker unavailable (%s)', type(marking_error).__name__)
            if isinstance(exc, APIException):
                raise
            logger.error('Community media persistence failed (%s)', type(exc).__name__)
            raise StorageUnavailable() from exc


def upload_quota(user, corporation):
    quota(MediaAsset.objects.filter(uploader=user, created_at__gte=recent()), getattr(settings, 'COMMUNITY_MEDIA_PER_DAY', 30))
    quota(MediaAsset.objects.filter(corporation=corporation), getattr(settings, 'COMMUNITY_MEDIA_PER_CORPORATION', 100))


def serve_asset(asset):
    try:
        handle = private_storage().open(asset.storage_name, 'rb')
    except OSError as exc:
        raise StorageUnavailable() from exc
    response = FileResponse(handle, content_type=asset.content_type)
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = "default-src 'none'; sandbox"
    return response


class PrivateMedia(PrivateAPI):
    def get(self, request, pk):
        asset = get_object_or_404(MediaAsset.objects, pk=pk)
        owned_corporation(request.user, asset.corporation_id, staff_read=True)
        return serve_asset(asset)


class PublicMedia(PublicAPI):
    def get(self, request, pk, asset_id):
        corporation = get_object_or_404(listed(), pk=pk)
        content = corporation.published_revision.content
        content = content if isinstance(content, dict) else {}
        if asset_id not in (content.get('logo_asset_id'), content.get('cover_asset_id')):
            raise NotFound()
        return serve_asset(get_object_or_404(MediaAsset.objects, pk=asset_id, corporation=corporation))


def review_model(kind):
    if kind not in ('claims', 'revisions'):
        raise ValidationError({'kind': '请选择申请或内容审核。'})
    return Claim if kind == 'claims' else Revision


class Reviews(StaffAPI):
    def get(self, request):
        kind = request.query_params.get('kind', 'claims')
        query = review_model(kind).objects.filter(status='pending').select_related('corporation').order_by('pk')
        return Response(paged(request, query, claim_data if kind == 'claims' else revision_data))


class ReviewDetail(StaffAPI):
    def get(self, request, kind, pk):
        query = review_model(kind).objects.select_related('corporation')
        if kind == 'revisions':
            query = query.exclude(status='draft')
        item = get_object_or_404(query, pk=pk)
        return Response(claim_data(item) if kind == 'claims' else revision_data(item))


class Decision(StaffAPI):
    def post(self, request, kind, pk):
        fields(request.data, ('decision', 'reason'))
        decision = request.data['decision']
        if decision not in ('approve', 'reject'):
            raise ValidationError({'decision': '请选择通过或驳回。'})
        reason = text(request.data, 'reason', 1000, decision == 'approve')
        model = review_model(kind)
        preview_fields = ('corporation_id', 'applicant_id') if kind == 'claims' else ('corporation_id',)
        preview = get_object_or_404(model.objects.only(*preview_fields), pk=pk)
        corporation_id = preview.corporation_id
        with transaction.atomic(using='default'):
            lock_users([request.user.pk, getattr(preview, 'applicant_id', None)])
            corporation = Corporation.objects.select_for_update().get(pk=corporation_id)
            item = model.objects.select_for_update().get(pk=pk)
            if item.status != 'pending':
                raise Conflict()
            if kind == 'claims' and decision == 'approve':
                if corporation.owner_id is not None:
                    raise Conflict()
                corporation.owner_id = item.applicant_id
                corporation.save(update_fields=['owner'])
            if kind == 'revisions':
                if corporation.working_revision_id != item.pk:
                    raise Conflict()
                if decision == 'approve':
                    corporation.published_revision = item
                    corporation.save(update_fields=['published_revision'])
                item.version += 1
            item.status = 'approved' if decision == 'approve' else 'rejected'
            item.reviewer = request.user
            item.reviewed_at = timezone.now()
            item.review_reason = reason
            changed = ['status', 'reviewer', 'reviewed_at', 'review_reason']
            if kind == 'revisions':
                changed += ['version', 'updated_at']
            item.save(update_fields=changed)
        return Response(claim_data(item) if kind == 'claims' else revision_data(item))


class Visibility(StaffAPI):
    def post(self, request, pk):
        fields(request.data, ('is_listed', 'reason'))
        if type(request.data['is_listed']) is not bool:
            raise ValidationError({'is_listed': '请输入布尔值。'})
        reason = text(request.data, 'reason', 1000)
        with transaction.atomic(using='default'):
            lock_users([request.user.pk])
            corporation = get_object_or_404(Corporation.objects.select_for_update(), pk=pk)
            corporation.is_listed = request.data['is_listed']
            corporation.moderator = request.user
            corporation.moderated_at = timezone.now()
            corporation.moderation_reason = reason
            corporation.save(update_fields=['is_listed', 'moderator', 'moderated_at', 'moderation_reason'])
        return Response(manage_data(corporation, request.user))
