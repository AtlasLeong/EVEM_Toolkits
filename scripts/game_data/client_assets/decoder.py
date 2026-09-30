"""Load the externally supplied, pinned WPK decoder, not its application/GUI.

The upstream source is not redistributed: the pinned revision has no licence.
Original local probe: output/client-ship-assets/tool-probe-20260929/probe.py.
"""
from contextlib import contextmanager
import hashlib
import logging
from pathlib import Path
import sys
import types

UPSTREAM_COMMIT = '5b85425c7d5bb880d4a8775a82ef45dd6edac975'
UPSTREAM_URL = ('https://github.com/liubairun/NeoXtractor-IDXWPK/blob/'
                + UPSTREAM_COMMIT + '/core/wpk/decryption.py')
DECODER_SHA256 = '54e92c24ca00d0880ff027192974edb7026dac1d5e04207adebd48aaaadd063c'


@contextmanager
def logging_shim():
    """Provide only the reviewed logging import, restoring global modules after."""
    previous = {name: sys.modules.get(name) for name in ('core', 'core.logger')}
    logger = types.ModuleType('core.logger')
    logger.get_logger = lambda: logging.getLogger('game-data-decoder')
    sys.modules['core'] = types.ModuleType('core')
    sys.modules['core.logger'] = logger
    try:
        yield
    finally:
        for name, module in previous.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


def load_decoder(decoder_file):
    """Check bytes before import; refuse AES fallback and any different revision."""
    path = Path(decoder_file).resolve()
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != DECODER_SHA256:
        raise ValueError('decoder SHA-256 mismatch; review and pin a new source explicitly')
    module = types.ModuleType('reviewed_wpk_decoder')
    module.__file__ = str(path)
    with logging_shim():
        # Compile exactly the hashed bytes. Import loaders may execute an
        # unpinned .pyc cache even when source bytes have been checked.
        exec(compile(raw, str(path), 'exec'), module.__dict__)
    if not module._HAS_AES:
        raise RuntimeError('AES dependency missing: refusing upstream silent fallback')
    return module
