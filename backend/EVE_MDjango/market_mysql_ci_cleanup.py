"""Cleanup helpers restricted to the disposable MySQL CI schema."""

from Market.models import PriceSnapshot


def require_ci_schema(database):
    if database.vendor != 'mysql' or database.settings_dict['NAME'] != 'market_ci':
        raise RuntimeError('Refusing to clean up outside the isolated Market MySQL CI schema.')
    with database.cursor() as cursor:
        cursor.execute('SELECT DATABASE()')
        if cursor.fetchone()[0] != 'market_ci':
            raise RuntimeError('Current MySQL schema is not the isolated Market CI schema.')


def clear_price_snapshots(database):
    """Bypass snapshot immutability only for the verified, disposable CI schema."""
    require_ci_schema(database)
    table = database.ops.quote_name(PriceSnapshot._meta.db_table)
    with database.cursor() as cursor:
        cursor.execute(f'DELETE FROM {table}')
