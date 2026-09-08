from datetime import timedelta
from uuid import UUID

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Sum
from django.http import FileResponse
from django.utils import timezone
from django.utils.cache import patch_vary_headers
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, Throttled, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import FeedbackAttachment, FeedbackComment, FeedbackTicket
from .attachments import (MAX_TICKET_BYTES, UploadUnavailable, attachment_data,
                          private_storage, store_upload, validated_upload)


class RequestConflict(APIException):
    status_code = 409
    default_detail = '该提交标识已用于其他内容，请刷新后重试。'


def validate_fields(data, required, optional=()):
    if not isinstance(data, dict):
        raise ValidationError({'detail': '请提交有效的 JSON 对象。'})
    if set(data) - set(required) - set(optional):
        raise ValidationError({'detail': '包含不支持的字段。'})
    missing = set(required) - set(data)
    if missing:
        raise ValidationError({name: '此项必填。' for name in missing})


def text_field(data, name, limit, blank=False):
    value = data.get(name, '')
    if not isinstance(value, str):
        raise ValidationError({name: '请输入文本。'})
    if len(value) > limit:
        raise ValidationError({name: f'最多输入 {limit} 个字符。'})
    value = value.strip()
    if not blank and not value:
        raise ValidationError({name: '此项不能为空。'})
    return value


def choice_field(data, name, choices):
    value = data.get(name)
    if not isinstance(value, str) or value not in dict(choices):
        raise ValidationError({name: '请选择有效选项。'})
    return value


def request_uuid(data):
    value = data.get('request_id')
    try:
        if not isinstance(value, str):
            raise ValueError
        return UUID(value)
    except (ValueError, AttributeError):
        raise ValidationError({'request_id': '提交标识无效，请刷新后重试。'})


def ticket_data(ticket, detail=False):
    data = {name: getattr(ticket, name) for name in (
        'id', 'type', 'module', 'title', 'description', 'contact', 'status', 'created_at', 'updated_at')}
    data['author_name'] = ticket.author.get_username()
    data['reply_count'] = ticket.reply_count if hasattr(ticket, 'reply_count') else ticket.comments.count()
    if detail:
        data['attachments'] = [attachment_data(item) for item in ticket.attachments.all()]
        data['comments'] = [dict(id=comment.pk, body=comment.body,
                                 author_name=comment.author.get_username(), is_staff=comment.is_staff,
                                 created_at=comment.created_at)
                            for comment in ticket.comments.select_related('author').all()]
    return data


def owned_ticket(user, pk, lock=False):
    queryset = FeedbackTicket.objects.using('default')
    if not user.is_staff:
        queryset = queryset.filter(author=user)
    if lock:
        queryset = queryset.select_for_update()
    try:
        return queryset.get(pk=pk)
    except FeedbackTicket.DoesNotExist:
        raise NotFound('反馈不存在或无权访问。')


def lock_author(user):
    # Serialize submissions across workers; persistent counts are not a process-local cache.
    get_user_model().objects.using('default').select_for_update().get(pk=user.pk)


class FeedbackAPI(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'private, no-store'
        patch_vary_headers(response, ['Authorization'])
        return response


class FeedbackList(FeedbackAPI):
    def get(self, request):
        scope = request.query_params.get('scope', 'mine')
        if scope not in ('mine', 'all'):
            raise ValidationError({'scope': '请选择有效范围。'})
        if scope == 'all' and not request.user.is_staff:
            raise PermissionDenied('仅管理员可查看全部反馈。')
        queryset = FeedbackTicket.objects.using('default').select_related('author').annotate(reply_count=Count('comments'))
        if scope == 'mine':
            queryset = queryset.filter(author=request.user)
        for name, choices in [('type', FeedbackTicket.TYPES), ('module', FeedbackTicket.MODULES),
                              ('status', FeedbackTicket.STATUSES)]:
            if request.query_params.get(name):
                queryset = queryset.filter(**{name: choice_field(request.query_params, name, choices)})
        page_text = request.query_params.get('page', '1')
        if not page_text.isascii() or not page_text.isdecimal() or len(page_text) > 9 or int(page_text) < 1:
            raise ValidationError({'page': '页码必须为正整数。'})
        page = int(page_text)
        count = queryset.count()
        return Response({'count': count, 'results': [ticket_data(ticket) for ticket in queryset[(page - 1) * 20:page * 20]],
                         'can_manage': bool(request.user.is_staff)})

    def post(self, request):
        validate_fields(request.data, ('request_id', 'type', 'module', 'title', 'description'), ('contact',))
        request_id = request_uuid(request.data)
        values = dict(type=choice_field(request.data, 'type', FeedbackTicket.TYPES),
                      module=choice_field(request.data, 'module', FeedbackTicket.MODULES),
                      title=text_field(request.data, 'title', 120),
                      description=text_field(request.data, 'description', 5000),
                      contact=text_field(request.data, 'contact', 200, blank=True))
        with transaction.atomic(using='default'):
            lock_author(request.user)
            previous = FeedbackTicket.objects.filter(author=request.user, request_id=request_id).first()
            if previous:
                if any(getattr(previous, name) != value for name, value in values.items()):
                    raise RequestConflict()
                return Response(ticket_data(previous, detail=True))
            if FeedbackTicket.objects.filter(author=request.user, created_at__gte=timezone.now() - timedelta(days=1)).count() >= 20:
                raise Throttled(detail='24 小时内最多提交 20 条反馈，请稍后再试。')
            ticket = FeedbackTicket.objects.create(author=request.user, request_id=request_id, **values)
            return Response(ticket_data(ticket, detail=True), status=201)


class FeedbackDetail(FeedbackAPI):
    def get(self, request, pk):
        return Response(ticket_data(owned_ticket(request.user, pk), detail=True))

    def patch(self, request, pk):
        with transaction.atomic(using='default'):
            ticket = owned_ticket(request.user, pk, lock=True)
            if not request.user.is_staff:
                raise PermissionDenied('仅管理员可更新处理状态。')
            validate_fields(request.data, ('status',))
            ticket.status = choice_field(request.data, 'status', FeedbackTicket.STATUSES)
            ticket.save(update_fields=['status', 'updated_at'])
            return Response(ticket_data(ticket, detail=True))


class FeedbackComments(FeedbackAPI):
    def post(self, request, pk):
        # Check ownership before parsing content to avoid exposing whether a private ID exists.
        owned_ticket(request.user, pk)
        validate_fields(request.data, ('request_id', 'body'))
        request_id = request_uuid(request.data)
        body = text_field(request.data, 'body', 3000)
        with transaction.atomic(using='default'):
            lock_author(request.user)
            ticket = owned_ticket(request.user, pk, lock=True)
            previous = FeedbackComment.objects.filter(author=request.user, request_id=request_id).first()
            if previous:
                if previous.ticket_id != ticket.pk or previous.body != body:
                    raise RequestConflict()
                return Response(ticket_data(ticket, detail=True))
            if ticket.comments.count() >= 100:
                raise ValidationError({'detail': '本条反馈已达到 100 条回复上限，请新建反馈继续沟通。'})
            if FeedbackComment.objects.filter(author=request.user, created_at__gte=timezone.now() - timedelta(hours=1)).count() >= 60:
                raise Throttled(detail='1 小时内最多回复 60 次，请稍后再试。')
            FeedbackComment.objects.create(ticket=ticket, author=request.user, request_id=request_id,
                                           body=body, is_staff=bool(request.user.is_staff))
            ticket.save(update_fields=['updated_at'])
            return Response(ticket_data(ticket, detail=True), status=201)


class FeedbackAttachments(FeedbackAPI):
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        owned_ticket(request.user, pk)
        validate_fields(request.data, ('request_id', 'file'))
        if len(request.FILES.getlist('file')) != 1 or len(request.data.getlist('request_id')) != 1:
            raise ValidationError({'detail': '每次仅能上传一个文件。'})
        request_id = request_uuid(request.data)
        values, data = validated_upload(request.FILES.get('file'))
        storage = private_storage()
        stored_name = None
        try:
            with transaction.atomic(using='default'):
                lock_author(request.user)
                ticket = owned_ticket(request.user, pk, lock=True)
                previous = FeedbackAttachment.objects.filter(author=request.user, request_id=request_id).first()
                if previous:
                    if previous.ticket_id != ticket.pk or any(getattr(previous, key) != value for key, value in values.items()):
                        raise RequestConflict()
                    return Response(attachment_data(previous))
                totals = ticket.attachments.aggregate(count=Count('id'), size=Sum('size'))
                if totals['count'] >= 20 or (totals['size'] or 0) + values['size'] > MAX_TICKET_BYTES:
                    raise ValidationError({'detail': '每条反馈最多 20 个附件，总大小不能超过 50 MiB。'})
                if FeedbackAttachment.objects.filter(author=request.user, created_at__gte=timezone.now() - timedelta(hours=1)).count() >= 60:
                    raise Throttled(detail='1 小时内最多上传 60 个附件，请稍后再试。')
                stored_name = store_upload(storage, data)
                attachment = FeedbackAttachment.objects.create(ticket=ticket, author=request.user,
                                                                request_id=request_id, storage_name=stored_name, **values)
                ticket.save(update_fields=['updated_at'])
            return Response(attachment_data(attachment), status=201)
        except APIException:
            raise
        except Exception:
            # Compensate storage on failed writes/commit; never expose paths or submitted data.
            if stored_name:
                try:
                    storage.delete(stored_name)
                except OSError:
                    pass
            raise UploadUnavailable()


class FeedbackAttachmentDownload(FeedbackAPI):
    def get(self, request, pk, attachment_id):
        ticket = owned_ticket(request.user, pk)
        try:
            attachment = ticket.attachments.get(pk=attachment_id)
        except FeedbackAttachment.DoesNotExist:
            raise NotFound('附件不存在或无权访问。')
        try:
            stream = private_storage().open(attachment.storage_name, 'rb')
        except OSError:
            raise UploadUnavailable()
        response = FileResponse(stream, as_attachment=True, filename=attachment.name, content_type=attachment.content_type)
        response['X-Content-Type-Options'] = 'nosniff'
        response['Cache-Control'] = 'private, no-store'
        response['Content-Security-Policy'] = "default-src 'none'; sandbox"
        return response
