import hashlib
import json
import logging
from uuid import uuid4

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import DatabaseError, transaction
from django.db.models import Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.cache import patch_vary_headers
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from Community.media import StorageUnavailable, sanitized_image, upload_bytes
from . import services as service, validation as valid
from .media import private_storage
from .models import Asset, ModerationEvent, Post, Revision, UploadAttempt

logger = logging.getLogger(__name__)
EXPECTED = ('expected_revision_id', 'expected_version')


class PublicAPI(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    throttle_classes = []

    def initial(self, request, *args, **kwargs):
        for key in ('pk', 'asset_id'):
            if key in kwargs:
                valid.integer(kwargs[key], key)
        return super().initial(request, *args, **kwargs)

    def handle_exception(self, exc):
        if not isinstance(exc, APIException) and not isinstance(exc, (NotFound,)):
            from django.http import Http404
            from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
            if not isinstance(exc, (Http404, DjangoPermissionDenied)):
                logger.error('Starsea request failed (%s)', type(exc).__name__)
                return Response({'detail': '服务暂时不可用，请稍后重试。'}, status=503 if isinstance(exc, DatabaseError) else 500)
        return super().handle_exception(exc)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        # Even the public media endpoint can serve an owner-only draft. Avoid
        # shared caching for the entire surface, including permission failures.
        response['Cache-Control'] = 'private, no-store'
        patch_vary_headers(response, ['Authorization'])
        return response


class PrivateAPI(PublicAPI):
    permission_classes = [IsAuthenticated]


class StaffAPI(PrivateAPI):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not request.user.is_staff:
            raise PermissionDenied('仅审核管理员可以操作。')


class Posts(PublicAPI):
    def get_permissions(self):
        return [IsAuthenticated()] if self.request.method == 'POST' else [AllowAny()]

    def get(self, request):
        query = valid.query(request, ('page', 'q', 'kind', 'region_id', 'corporation_id'))
        posts = service.visible().select_related('author', 'published_revision').order_by('-published_at', '-pk')
        search = valid.text(query.get('q', ''), 'q', 120)
        if search:
            posts = posts.filter(Q(published_revision__title__icontains=search) | Q(published_revision__content__body__icontains=search))
        kind = query.get('kind', '')
        if kind:
            if kind not in ('battle', 'story', 'announcement'):
                raise ValidationError({'kind': '分类无效。'})
            posts = posts.filter(published_revision__kind=kind)
        if query.get('region_id'):
            posts = posts.filter(published_revision__region_id=valid.query_integer(query['region_id'], 'region_id'))
        if query.get('corporation_id'):
            corporation_id = valid.query_integer(query['corporation_id'], 'corporation_id')
            posts = posts.filter(published_revision__content__corporation_id=corporation_id)
        return Response(service.paged(request, posts, service.entry))

    def post(self, request):
        valid.fields(request.data, ('request_id', 'content'))
        request_id = valid.request_uuid(request.data['request_id'])
        valid.fields(request.data['content'], optional=valid.CONTENT_FIELDS)
        # Retry identity describes the submitted request, not a catalog or
        # corporation whose availability may have changed after first success.
        fingerprint = hashlib.sha256(json.dumps(request.data['content'], ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode('ascii')).hexdigest()
        with transaction.atomic():
            service.lock_actor(request.user)
            previous = Post.objects.filter(author=request.user, request_id=request_id).first()
            if previous:
                if previous.payload_hash != fingerprint:
                    raise service.Conflict()
                return Response(service.entry(previous, private=True))
            service.quota(Post.objects.filter(author=request.user, created_at__gte=service.recent()), getattr(settings, 'STARSEA_POSTS_PER_DAY', 100))
            content = valid.content(request.data['content'])
            post = Post.objects.create(author=request.user, request_id=request_id, payload_hash=fingerprint)
            revision = Revision(post=post, author=request.user)
            service.sync_content(revision, content)
            revision.save()
            post.working_revision = revision
            post.save(update_fields=['working_revision'])
        return Response(service.entry(post, private=True), status=201)


class Detail(PublicAPI):
    def get(self, request, pk):
        valid.query(request, ())
        post = get_object_or_404(service.visible().select_related('author', 'published_revision'), pk=pk)
        return Response(service.entry(post))


class Mine(PrivateAPI):
    def get(self, request):
        valid.query(request, ('page',))
        posts = Post.objects.filter(author=request.user).select_related('author', 'working_revision').order_by('-pk')
        return Response(service.paged(request, posts, lambda post: service.entry(post, private=True)))


class Manage(PrivateAPI):
    def get(self, request, pk):
        valid.query(request, ())
        return Response(service.entry(service.owned(request.user, pk, staff_read=True), private=True))


class Draft(PrivateAPI):
    def post(self, request, pk):
        valid.fields(request.data, EXPECTED)
        with transaction.atomic():
            post, revision = service.locked_working(request.user, pk, request.data)
            if revision.status == 'pending':
                raise service.Conflict('请先撤回待审快照。')
            created = revision.status != 'draft'
            if created:
                service.quota(Revision.objects.filter(post=post, created_at__gte=service.recent()), getattr(settings, 'STARSEA_REVISIONS_PER_POST_PER_DAY', 100))
                revision = service.clone(post, revision)
        return Response(service.entry(post, revision, private=True), status=201 if created else 200)

    def patch(self, request, pk):
        valid.fields(request.data, (*EXPECTED, 'content'))
        with transaction.atomic():
            post, revision = service.locked_working(request.user, pk, request.data)
            if revision.status != 'draft':
                raise service.Conflict()
            service.sync_content(revision, valid.content(request.data['content'], post, revision.content))
            revision.version += 1
            revision.save(update_fields=['content', 'summary', 'kind', 'title', 'region_id', 'version', 'updated_at'])
        return Response(service.entry(post, revision, private=True))


class Transition(PrivateAPI):
    def post(self, request, pk, action):
        valid.fields(request.data, EXPECTED)
        with transaction.atomic():
            post, revision = service.locked_working(request.user, pk, request.data)
            if revision.status != ('draft' if action == 'submit' else 'pending'):
                raise service.Conflict()
            if action == 'submit':
                valid.publishable(revision.content)
                revision.status = 'pending'
                revision.submitted_at = timezone.now()
            else:
                service.quota(Revision.objects.filter(post=post, created_at__gte=service.recent()), getattr(settings, 'STARSEA_REVISIONS_PER_POST_PER_DAY', 100))
                revision.status = 'withdrawn'
            revision.version += 1
            revision.save(update_fields=['status', 'submitted_at', 'version', 'updated_at'])
            if action == 'withdraw':
                revision = service.clone(post, revision)
        return Response(service.entry(post, revision, private=True))


class Capabilities(PrivateAPI):
    def get(self, request):
        valid.query(request, ())
        return Response({'can_review': request.user.is_staff})


class Reviews(StaffAPI):
    def get(self, request):
        valid.query(request, ('page',))
        revisions = Revision.objects.filter(status='pending').select_related('post__author').order_by('submitted_at', 'pk')
        return Response(service.paged(request, revisions, lambda revision: service.entry(revision.post, revision, private=True)))


class ReviewDetail(StaffAPI):
    def get(self, request, pk):
        valid.query(request, ())
        revision = get_object_or_404(Revision.objects.exclude(status='draft').select_related('post__author'), pk=pk)
        return Response(service.entry(revision.post, revision, private=True))


class Decision(StaffAPI):
    def post(self, request, pk):
        valid.fields(request.data, ('decision', 'reason', 'expected_version'))
        decision = request.data['decision']
        if not isinstance(decision, str) or decision not in ('approve', 'reject'):
            raise ValidationError({'decision': '请选择通过或退回。'})
        reason = valid.text(request.data['reason'], 'reason', 1000, decision == 'approve')
        version = valid.integer(request.data['expected_version'], 'expected_version')
        post_id = get_object_or_404(Revision.objects.only('post_id'), pk=pk).post_id
        with transaction.atomic():
            post = Post.objects.select_for_update().get(pk=post_id)
            revision = Revision.objects.select_for_update().get(pk=pk)
            if revision.status != 'pending' or revision.version != version or post.working_revision_id != revision.pk:
                raise service.Conflict()
            if decision == 'approve':
                valid.publishable(revision.content)
                post.published_revision = revision
                post.published_at = timezone.now()
                post.save(update_fields=['published_revision', 'published_at'])
            revision.status = 'approved' if decision == 'approve' else 'rejected'
            revision.reviewer = request.user
            revision.reviewed_at = timezone.now()
            revision.review_reason = reason
            revision.version += 1
            revision.save(update_fields=['status', 'reviewer', 'reviewed_at', 'review_reason', 'version', 'updated_at'])
            ModerationEvent.objects.create(post=post, revision=revision, actor=request.user, action=decision, reason=reason)
        return Response(service.entry(post, revision, private=True))


class Visibility(StaffAPI):
    def post(self, request, pk):
        valid.fields(request.data, ('is_listed', 'reason'))
        if type(request.data['is_listed']) is not bool:
            raise ValidationError({'is_listed': '请输入布尔值。'})
        reason = valid.text(request.data['reason'], 'reason', 1000, False)
        with transaction.atomic():
            post = get_object_or_404(Post.objects.select_for_update(), pk=pk)
            if not post.published_revision_id:
                raise service.Conflict('尚无已通过的公开版本。')
            post.is_listed = request.data['is_listed']
            post.moderator = request.user
            post.moderated_at = timezone.now()
            post.moderation_reason = reason
            post.save(update_fields=['is_listed', 'moderator', 'moderated_at', 'moderation_reason'])
            ModerationEvent.objects.create(post=post, revision_id=post.published_revision_id, actor=request.user, action='unhide' if post.is_listed else 'hide', reason=reason)
        return Response(service.entry(post, private=True))


def media_data(asset):
    return {'id': asset.pk, 'url': f'/api/starsea/media/{asset.pk}/', 'width': asset.width, 'height': asset.height}


def upload_quota(user, post):
    service.quota(Asset.objects.filter(uploader=user, created_at__gte=service.recent()), getattr(settings, 'STARSEA_MEDIA_PER_DAY', 30))
    service.quota(Asset.objects.filter(post=post), getattr(settings, 'STARSEA_MEDIA_PER_POST', 48))


class MediaUpload(PrivateAPI):
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        if set(request.data) != {'request_id', 'file'} or any(len(request.data.getlist(key)) != 1 for key in request.data):
            raise ValidationError({'detail': '请提交一张图片和提交标识。'})
        request_id = valid.request_uuid(request.data['request_id'])
        service.owned(request.user, pk)
        storage = private_storage()
        raw = upload_bytes(request.data['file'])
        digest = hashlib.sha256(raw).hexdigest()
        # Commit an attempt before decoding. Failed files and worker crashes
        # consume quota; the same UUID can never start a concurrent decode.
        with transaction.atomic():
            service.lock_actor(request.user)
            post = service.owned(request.user, pk, lock=True)
            previous = Asset.objects.filter(uploader=request.user, request_id=request_id).first()
            if previous:
                if previous.post_id != pk or previous.original_sha256 != digest:
                    raise service.Conflict()
                return Response(media_data(previous))
            attempted = UploadAttempt.objects.filter(uploader=request.user, request_id=request_id).first()
            if attempted:
                if attempted.post_id != pk or attempted.original_sha256 != digest:
                    raise service.Conflict()
                if attempted.status == 'failed':
                    raise ValidationError({'file': '该图片提交已失败，请重新选择图片并使用新的提交标识。'})
                raise service.Conflict('图片仍在处理中，请稍后重试。')
            upload_quota(request.user, post)
            service.quota(UploadAttempt.objects.filter(uploader=request.user, created_at__gte=service.recent()), getattr(settings, 'STARSEA_MEDIA_ATTEMPTS_PER_DAY', 60))
            attempt = UploadAttempt.objects.create(post=post, uploader=request.user, request_id=request_id, original_sha256=digest)
        stored = None
        try:
            metadata, data = sanitized_image(request.data['file'], raw=raw)
            with transaction.atomic():
                service.lock_actor(request.user)
                post = service.owned(request.user, pk, lock=True)
                attempt = UploadAttempt.objects.select_for_update().get(pk=attempt.pk)
                if attempt.status != 'processing':
                    raise service.Conflict()
                upload_quota(request.user, post)
                stored = storage.save(uuid4().hex + '.webp', ContentFile(data))
                asset = Asset.objects.create(post=post, uploader=request.user, request_id=request_id, storage_name=stored, **metadata)
                attempt.status = 'completed'
                attempt.finished_at = timezone.now()
                attempt.save(update_fields=['status', 'finished_at'])
            return Response(media_data(asset), status=201)
        except Exception as exc:
            if stored:
                try:
                    storage.delete(stored)
                except OSError:
                    logger.error('Starsea media cleanup failed; reconcile orphan %s', stored)
            try:
                with transaction.atomic():
                    service.lock_actor(request.user)
                    Post.objects.select_for_update().get(pk=pk)
                    attempt = UploadAttempt.objects.select_for_update().get(pk=attempt.pk)
                    attempt.status = 'failed'
                    attempt.finished_at = timezone.now()
                    attempt.save(update_fields=['status', 'finished_at'])
            except Exception as marking_error:
                logger.error('Starsea upload failure marker unavailable (%s)', type(marking_error).__name__)
            if isinstance(exc, APIException):
                raise
            logger.error('Starsea upload persistence failed (%s)', type(exc).__name__)
            raise StorageUnavailable() from exc


class Media(PublicAPI):
    def get(self, request, pk):
        valid.query(request, ())
        asset = get_object_or_404(Asset.objects.select_related('post__published_revision'), pk=pk)
        post = asset.post
        published = post.published_revision
        public = post.is_listed and published and published.status == 'approved' and any(image['id'] == asset.pk for image in published.content['images'])
        privileged = request.user.is_authenticated and (request.user.pk == post.author_id or request.user.is_staff)
        if not public and not privileged:
            raise NotFound()
        try:
            handle = private_storage().open(asset.storage_name, 'rb')
        except OSError as exc:
            raise StorageUnavailable() from exc
        response = FileResponse(handle, content_type=asset.content_type)
        response['X-Content-Type-Options'] = 'nosniff'
        response['Content-Security-Policy'] = "default-src 'none'; sandbox"
        return response


class Ships(PublicAPI):
    def get(self, request):
        from .catalog import search_ships
        query = valid.query(request, ('q', 'ship_class', 'page'))
        return Response(search_ships(q=valid.text(query.get('q', ''), 'q', 120),
                                     ship_class=valid.text(query.get('ship_class', ''), 'ship_class', 80),
                                     page=valid.query_integer(query.get('page', '1'), 'page', 10000)))


class Locations(PublicAPI):
    def get(self, request):
        from .catalog import search_locations
        query = valid.query(request, ('kind', 'parent_id', 'q'))
        parent_id = valid.query_integer(query['parent_id'], 'parent_id') if query.get('parent_id') else None
        return Response(search_locations(kind=query.get('kind', 'regions'), parent_id=parent_id, q=valid.text(query.get('q', ''), 'q', 120)))


class Corporations(PublicAPI):
    def get(self, request):
        query = valid.query(request, ('q',))
        search = valid.text(query.get('q', ''), 'q', 120)
        corporations = valid.visible_corporations().filter(name__icontains=search).order_by('name', 'pk')
        return Response({'results': list(corporations.values('id', 'name')[:30])})
