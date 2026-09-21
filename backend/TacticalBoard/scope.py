"""Query-scope helpers for the public star-map data.

The local tactical preview may seed synthetic rows into the same unmanaged
``board_*`` tables as the public star map.  Keep those rows available to the
tactical preview, but exclude their reserved id range from public map and
route queries while the local-demo setting is enabled.
"""

from django.conf import settings


LOCAL_SYNTHETIC_ID_MIN = 99_000_000


def public_board_filter_kwargs(id_field):
    """Return ORM filters for rows that are safe to expose on the public map."""

    if not getattr(settings, "TACTICAL_LOCAL_DEMO", False):
        return {}
    return {f"{id_field}__lt": LOCAL_SYNTHETIC_ID_MIN}


def stargate_cache_key():
    """Keep local filtered gate data separate from production-shaped cache data."""

    if getattr(settings, "TACTICAL_LOCAL_DEMO", False):
        return "stargate_data:local-public-v1"
    return "stargate_data:production-v1"
