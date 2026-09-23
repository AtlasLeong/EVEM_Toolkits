"""Activity vocabulary and strict-write / tolerant-read custom tag rules."""
import unicodedata

from rest_framework.exceptions import ValidationError


ACTIVITY_LABELS = {
    'sovereignty_production': '主权生产',
    'pirate_combat': '海盗作战',
    'pve': '异常与任务',
    'industry': '工业制造',
    'exploration': '星海探索',
    'mining': '采矿生产',
    'training': '新人培养',
}
CURRENT_ACTIVITIES = tuple(ACTIVITY_LABELS)
READABLE_ACTIVITIES = (*CURRENT_ACTIVITIES, 'pvp')
ACTIVITY_DESCRIPTION_LIMIT = 1500
CUSTOM_TAG_LIMIT = 5
CUSTOM_TAG_LENGTH = 12


def comparison_key(value):
    return unicodedata.normalize('NFKC', value).casefold()


RESERVED_TAG_KEYS = {
    comparison_key(label) for label in (*ACTIVITY_LABELS.values(), '舰队作战', '舰队作战（旧标签）')
}


def is_unicode_text(value):
    # Escaped lone surrogates are accepted by JSON's decoder but cannot be
    # UTF-8 rendered. Reject before committing; tolerate them on legacy reads.
    return isinstance(value, str) and not any('\ud800' <= char <= '\udfff' for char in value)


def clean_tag(value):
    """Return display spelling, or None for an invalid individual stored tag."""
    if not is_unicode_text(value):
        return None
    # Check before stripping so a newline/tab cannot be hidden at either end.
    if any(unicodedata.category(char) in ('Cc', 'Cf', 'Zl', 'Zp') for char in value):
        return None
    display = value.strip()
    if not display or len(display) > CUSTOM_TAG_LENGTH:
        return None
    if comparison_key(display) in RESERVED_TAG_KEYS:
        return None
    return display


def validated_custom_tags(value):
    error = {'custom_activity_tags': '最多填写 5 个不同标签，每个 1–12 字；不能包含控制字符、换行或与内置标签同名。'}
    if not isinstance(value, list) or len(value) > CUSTOM_TAG_LIMIT:
        raise ValidationError(error)
    result, seen = [], set()
    for item in value:
        display = clean_tag(item)
        if display is None:
            raise ValidationError(error)
        key = comparison_key(display)
        if key in seen:
            raise ValidationError(error)
        seen.add(key)
        result.append(display)
    return result


def normalized_custom_tags(value):
    """Skip malformed historical items without changing the stored snapshot."""
    if not isinstance(value, list):
        return []
    result, seen = [], set()
    for item in value:
        display = clean_tag(item)
        if display is None:
            continue
        key = comparison_key(display)
        if key not in seen:
            seen.add(key)
            result.append(display)
        if len(result) == CUSTOM_TAG_LIMIT:
            break
    return result
