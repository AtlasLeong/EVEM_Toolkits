"""Public metadata for the market range used by the collector."""


_MARKET_SCOPE = {
    'key': 'jita_h4',
    'protocol_scope': 8,
    'label': '吉他海四',
    'description': '吉他 IV - 月 4 · 加达里海军装配厂',
}


def market_scope_payload():
    """Return a copy so API callers cannot mutate the shared definition."""
    return _MARKET_SCOPE.copy()
