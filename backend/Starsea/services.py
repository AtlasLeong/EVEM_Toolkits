import copy
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, Throttled

from . import validation
from .models import Post, Revision


class Conflict(APIException):
    status_code = 409
    default_detail = '内容已变化，请刷新后重试。'


def lock_actor(user):
    get_user_model().objects.select_for_update().get(pk=user.pk)


def recent():
    return timezone.now() - timedelta(days=1)


def quota(queryset, maximum):
    if queryset.count() >= maximum:
        raise Throttled(detail='操作过于频繁或容量已满，请稍后再试。')


def owned(user, pk, lock=False, staff_read=False):
    query = Post.objects
    if lock:
        query = query.select_for_update()
    if not (staff_read and user.is_staff):
        query = query.filter(author=user)
    return get_object_or_404(query, pk=pk)


def locked_working(user, pk, data):
    # Every transition takes the parent row first. Never lock a revision before
    # its parent: approval, withdrawal and edits must share this lock order.
    post = owned(user, pk, lock=True)
    revision = Revision.objects.select_for_update().get(pk=post.working_revision_id)
    expected_id = validation.integer(data['expected_revision_id'], 'expected_revision_id')
    expected_version = validation.integer(data['expected_version'], 'expected_version')
    if revision.pk != expected_id or revision.version != expected_version:
        raise Conflict()
    return post, revision


def sync_content(revision, content):
    revision.content = content
    revision.summary = validation.summary(content)
    revision.kind = content['kind']
    revision.title = content['title']
    revision.region_id = (content.get('location') or {}).get('region_id')


def clone(post, source):
    revision = Revision(post=post, author=post.author)
    sync_content(revision, copy.deepcopy(source.content))
    revision.save()
    post.working_revision = revision
    post.save(update_fields=['working_revision'])
    return revision


def visible():
    return Post.objects.filter(is_listed=True, published_revision__status='approved')


def entry(post, revision=None, private=False):
    revision = revision or (post.working_revision if private else post.published_revision)
    data = {'id': revision.pk, 'version': revision.version, 'status': revision.status,
            'content': revision.content, 'updated_at': revision.updated_at}
    if private:
        data['review_reason'] = revision.review_reason
    corporation_id = revision.content.get('corporation_id')
    if hasattr(post, '_starsea_corporations'):
        corporation = post._starsea_corporations.get(corporation_id)
    else:
        corporation = validation.visible_corporations().filter(pk=corporation_id).values('id', 'name').first() if corporation_id else None
    result = {'id': post.pk, 'author_name': post.author.first_name.strip() or post.author.get_username(), 'created_at': post.created_at,
              'published_at': post.published_at, 'is_listed': post.is_listed, 'revision': data,
              'summary': revision.summary, 'corporation': corporation}
    if private:
        result['published_revision_id'] = post.published_revision_id
    return result


def paged(request, queryset, serialize):
    page = validation.query_integer(request.query_params.get('page', '1'), 'page', 10000)
    start = (page - 1) * 20
    count = queryset.count()
    items = list(queryset[start:start + 20])
    corporation_ids = set()
    for item in items:
        if isinstance(item, Revision):
            revisions = [item]
        else:
            # Avoid loading whichever revision is not selected by the caller.
            revisions = [item._state.fields_cache[key] for key in ('working_revision', 'published_revision') if key in item._state.fields_cache]
        corporation_ids.update(revision.content['corporation_id'] for revision in revisions if revision and revision.content.get('corporation_id'))
    corporations = {item['id']: item for item in validation.visible_corporations().filter(pk__in=corporation_ids).values('id', 'name')} if corporation_ids else {}
    for item in items:
        post = item.post if isinstance(item, Revision) else item
        post._starsea_corporations = corporations
    return {'count': count, 'results': [serialize(item) for item in items]}
