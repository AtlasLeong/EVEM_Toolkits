def round_robin(pool_size, cursor):
    """Return this slot and the next cursor, shared by Market and Killboard."""
    if type(pool_size) is not int or pool_size < 1:
        raise ValueError('Invalid session pool size.')
    if type(cursor) is not int or not 0 <= cursor < pool_size:
        cursor = 0
    return cursor, (cursor + 1) % pool_size
