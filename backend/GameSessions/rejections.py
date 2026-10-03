"""Recognize only captured structured rejection shapes, never remote prose."""
import msgpack


def request_too_often(error):
    return error == ['UserError', 'RequestTooOften', None]


def structured_rejection(value):
    if isinstance(value, dict) and isinstance(value.get('error'), dict):
        code = value['error'].get('code')
        if code in ('unauthorized', 'rate_limited'):
            return code
    if isinstance(value, msgpack.ExtType) and value.code == 10:
        try:
            nested = msgpack.unpackb(value.data, raw=False, strict_map_key=False)
            if isinstance(nested, dict) and isinstance(nested.get('error'), dict):
                code = nested['error'].get('code')
                if code in ('unauthorized', 'rate_limited'):
                    return code
            if isinstance(nested, msgpack.ExtType) and nested.code == 16:
                error = msgpack.unpackb(nested.data, raw=False, strict_map_key=False,
                                        max_array_len=4, max_str_len=64, max_bin_len=64,
                                        max_map_len=4, max_ext_len=64)
                if request_too_often(error):
                    return 'rate_limited'
        except (ValueError, TypeError, msgpack.UnpackException):
            return None
    return None
