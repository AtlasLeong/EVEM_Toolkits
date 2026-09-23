import copy
import re
import unicodedata
from decimal import Decimal
from uuid import UUID

from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import ValidationError

from .models import Asset

MAX_ID = 9223372036854775807
CONTENT_FIELDS = {'kind', 'title', 'body', 'occurred_at', 'location', 'corporation_id', 'images', 'battle'}


def fields(value, required=(), optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise ValidationError({'detail': '请提交字段完整且不含额外字段的 JSON 对象。'})


def integer(value, field, maximum=MAX_ID):
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValidationError({field: '请输入有效正整数。'})
    return value


def text(value, field, limit, blank=True):
    if (not isinstance(value, str) or len(value) > limit
            or any(unicodedata.category(char) == 'Cs' or (unicodedata.category(char) == 'Cc' and char not in '\n\r\t') for char in value)):
        raise ValidationError({field: f'请输入不超过 {limit} 字的有效文本。'})
    value = value.strip()
    if not blank and not value:
        raise ValidationError({field: '此项不能为空。'})
    return value


def request_uuid(value):
    if not isinstance(value, str) or len(value) > 36:
        raise ValidationError({'request_id': '请输入有效 UUID。'})
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        raise ValidationError({'request_id': '请输入有效 UUID。'})


def query(request, allowed):
    if set(request.query_params) - set(allowed) or any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
        raise ValidationError({'detail': '查询参数无效或重复。'})
    return request.query_params


def query_integer(value, field, maximum=MAX_ID):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,19}', value):
        raise ValidationError({field: '请输入有效正整数。'})
    return integer(int(value), field, maximum)


def default_content():
    return {'kind': 'story', 'title': '', 'body': '', 'occurred_at': None, 'location': None,
            'corporation_id': None, 'images': [], 'battle': None}


def visible_corporations():
    from Community.models import Corporation
    return Corporation.objects.filter(is_listed=True, published_revision__status='approved')


def normalized_battle(value):
    if value is None:
        return None
    fields(value, ('sides',))
    if not isinstance(value['sides'], list) or len(value['sides']) != 2:
        raise ValidationError({'battle': '战报必须包含双方。'})
    sides = []
    for side in value['sides']:
        fields(side, ('name', 'isk_loss', 'losses'))
        name = text(side['name'], 'name', 80)
        isk = side['isk_loss']
        if isk is not None:
            if not isinstance(isk, str) or not re.fullmatch(r'[0-9]{1,16}(?:\.[0-9]{1,2})?', isk) or Decimal(isk) > Decimal('1000000000000000'):
                raise ValidationError({'isk_loss': 'ISK 必须为空或不超过 10^15、最多两位小数的非负十进制字符串。'})
            isk = format(Decimal(isk), '.2f')
        if not isinstance(side['losses'], list) or len(side['losses']) > 100:
            raise ValidationError({'losses': '每方最多 100 行。'})
        losses = []
        for row in side['losses']:
            fields(row, ('ship_id', 'ship_name', 'ship_class', 'quantity'))
            quantity = integer(row['quantity'], 'quantity', 100000)
            name_value = text(row['ship_name'], 'ship_name', 120)
            class_value = text(row['ship_class'], 'ship_class', 80)
            if row['ship_id'] is None:
                losses.append({'ship_id': None, 'ship_name': name_value or '未知型号', 'ship_class': class_value or '未知舰种', 'quantity': quantity, 'source_version': None, 'is_custom': True})
            else:
                from .catalog import resolve_ship
                ship = resolve_ship(integer(row['ship_id'], 'ship_id'))
                losses.append({'ship_id': ship['id'], 'ship_name': ship['name'], 'ship_class': ship['ship_class'], 'quantity': quantity, 'source_version': ship['source_version'], 'is_custom': False})
        sides.append({'name': name, 'isk_loss': isk, 'losses': losses})
    return {'sides': sides}


def content(data, post=None, old=None):
    fields(data, optional=CONTENT_FIELDS)
    result = copy.deepcopy(old if old is not None else default_content())
    for key, limit in (('title', 120), ('body', 20000)):
        if key in data:
            result[key] = text(data[key], key, limit)
    if 'kind' in data:
        if not isinstance(data['kind'], str) or data['kind'] not in ('battle', 'story', 'announcement'):
            raise ValidationError({'kind': '请选择战报、趣闻或活动。'})
        result['kind'] = data['kind']
    if 'occurred_at' in data:
        value = data['occurred_at']
        if value is not None:
            value = text(value, 'occurred_at', 64, False)
            try:
                parsed = parse_datetime(value)
            except ValueError:
                parsed = None
            if parsed is None:
                raise ValidationError({'occurred_at': '请输入有效 ISO 时间。'})
            value = parsed.isoformat()
        result['occurred_at'] = value
    if 'location' in data:
        from .catalog import resolve_location
        result['location'] = resolve_location(data['location'])
    if 'corporation_id' in data:
        value = data['corporation_id']
        if value is not None and not visible_corporations().filter(pk=integer(value, 'corporation_id')).exists():
            raise ValidationError({'corporation_id': '只能关联公开军团。'})
        result['corporation_id'] = value
    if 'images' in data:
        images = data['images']
        if not isinstance(images, list) or len(images) > 12:
            raise ValidationError({'images': '最多 12 张图片。'})
        result['images'] = []
        for item in images:
            fields(item, ('id', 'caption'))
            asset_id = integer(item['id'], 'id')
            if post is None or not Asset.objects.filter(post=post, pk=asset_id).exists() or any(image['id'] == asset_id for image in result['images']):
                raise ValidationError({'images': '图片重复或不属于本帖。'})
            result['images'].append({'id': asset_id, 'caption': text(item['caption'], 'caption', 240)})
    if 'battle' in data:
        result['battle'] = normalized_battle(data['battle'])
    if result['kind'] != 'battle':
        result['battle'] = None
    return result


def summary(content):
    sides = []
    for side in (content.get('battle') or {}).get('sides', []):
        by_class = {}
        for row in side['losses']:
            by_class[row['ship_class']] = by_class.get(row['ship_class'], 0) + row['quantity']
        sides.append({'name': side['name'], 'total_ships': sum(by_class.values()),
                      'by_class': [{'name': key, 'quantity': quantity} for key, quantity in sorted(by_class.items())],
                      'isk_loss': side['isk_loss']})
    return {'sides': sides}


def publishable(content):
    text(content['title'], 'title', 120, False)
    if content['kind'] == 'battle':
        battle = content.get('battle')
        if not battle or not any(side['losses'] for side in battle['sides']):
            raise ValidationError({'battle': '战报至少需要一行损失。'})
        for side in battle['sides']:
            text(side['name'], 'name', 80, False)
    elif not content['body'] and not content['images']:
        raise ValidationError({'body': '请输入正文或添加图片。'})
    if content['corporation_id'] is not None and not visible_corporations().filter(pk=content['corporation_id']).exists():
        raise ValidationError({'corporation_id': '关联军团已不可公开，请重新选择。'})
