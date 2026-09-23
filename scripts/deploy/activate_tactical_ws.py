"""One-time, root-only tactical WebSocket sidecar activation on the known host.

Use only after the verified application release is live. This script backs up
every changed server config and restores it on a failed preflight/activation.
It never edits application data or changes the WSGI backend's dependencies.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
from datetime import datetime, timezone


NGINX = Path('/etc/nginx/conf.d/evemtk.conf')
UNIT = Path('/etc/systemd/system/evem-tactical-asgi.service')
PUBLISHER = Path('/usr/local/lib/evem-deploy/release.py')
SUDOERS = Path('/etc/sudoers.d/evem-deploy')
CONFIG = Path('/EVEMTK/deploy/config.json')
STATE = Path('/EVEMTK/deploy/state.json')
BACKEND = Path('/EVEMTK/deploy/current/backend')
RUNTIME = Path('/EVEMTK/deploy/shared/tactical-python')
BACKUP_ROOT = Path('/root')
SUDO_RULE = 'evem-deploy ALL=(root) NOPASSWD: /bin/systemctl restart evem-tactical-asgi.service\n'
INTERRUPT_SIGNALS = (signal.SIGINT, signal.SIGTERM) + ((signal.SIGHUP,) if hasattr(signal, 'SIGHUP') else ())


def run(*command, **kwargs):
    subprocess.run(command, check=True, **kwargs)


def replace_file(path, contents):
    old = path.stat() if path.exists() else None
    fd, temporary = tempfile.mkstemp(prefix='.tactical-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as target:
            target.write(contents)
        if old:
            os.chmod(temporary, old.st_mode)
            os.chown(temporary, old.st_uid, old.st_gid)
        else:
            os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def probe_loopback():
    import base64
    import http.client
    connection = http.client.HTTPConnection('127.0.0.1', 8001, timeout=5)
    try:
        connection.request('GET', '/ws/tactical/0/', headers={
            'Origin': 'https://evemtk.com', 'Connection': 'Upgrade',
            'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': base64.b64encode(os.urandom(16)).decode('ascii'),
        })
        response = connection.getresponse()
        if response.status != 101:
            raise RuntimeError('ASGI loopback upgrade did not return 101')
    finally:
        connection.close()


def activate(bundle, expected_sha):
    if os.geteuid() != 0:
        raise RuntimeError('root is required')
    if not re.fullmatch(r'[0-9a-f]{40}', expected_sha):
        raise RuntimeError('invalid expected release SHA')
    required = (NGINX, PUBLISHER, SUDOERS, CONFIG, STATE, BACKEND / 'requirements-tactical-runtime.txt')
    if not all(path.is_file() for path in required):
        raise RuntimeError('expected production files are missing')
    if (BACKEND / '.release-sha').read_text().strip() != expected_sha:
        raise RuntimeError('current backend is not the verified target release')
    nginx = NGINX.read_text()
    anchor = '    location /api/ {'
    if nginx.count(anchor) != 1 or 'location ^~ /ws/tactical/' in nginx or UNIT.exists():
        raise RuntimeError('unexpected Nginx/service layout; inspect manually')
    config = json.loads(CONFIG.read_text())
    if config.get('tactical_ws') is not None or config.get('origin') != 'https://evemtk.com':
        raise RuntimeError('unexpected release configuration')
    if SUDO_RULE.strip() in SUDOERS.read_text():
        raise RuntimeError('tactical sudo rule already exists')
    for name in ('evem-tactical-asgi.service.example', 'tactical-nginx-location.example.conf', 'release.py'):
        if not (bundle / name).is_file():
            raise RuntimeError('incomplete activation bundle')
    run(str(BACKEND / '.venv/bin/python'), '-m', 'py_compile', str(bundle / 'release.py'))

    if not RUNTIME.exists():
        staged = Path(tempfile.mkdtemp(prefix='tactical-python-', dir=RUNTIME.parent))
        run(str(BACKEND / '.venv/bin/python'), '-m', 'pip', 'install', '--disable-pip-version-check',
            '--no-deps', '--target', str(staged), '-r', str(BACKEND / 'requirements-tactical-runtime.txt'))
        environment = {**os.environ, 'PYTHONPATH': str(staged)}
        run(str(BACKEND / '.venv/bin/python'), '-c',
            'import django, channels, uvicorn, websockets, asgiref, click, h11; '
            'import EVE_MDjango.tactical_asgi', cwd=BACKEND, env=environment)
        # mkdtemp is root-only (0700). The nginx service must be able to
        # traverse this isolated dependency tree after it is promoted.
        os.chmod(staged, 0o755)
        staged.rename(RUNTIME)
    else:
        environment = {**os.environ, 'PYTHONPATH': str(RUNTIME)}
        run(str(BACKEND / '.venv/bin/python'), '-c',
            'import django, channels, uvicorn, websockets, asgiref, click, h11; '
            'import EVE_MDjango.tactical_asgi', cwd=BACKEND, env=environment)
    run('runuser', '-u', 'nginx', '--', 'env', 'PYTHONPATH=' + str(RUNTIME),
        str(BACKEND / '.venv/bin/python'), '-c',
        'import django, channels, uvicorn, websockets, asgiref, click, h11; '
        'import EVE_MDjango.tactical_asgi', cwd=BACKEND)

    backup = BACKUP_ROOT / ('evem-tactical-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    original = {path: path.read_bytes() for path in (NGINX, PUBLISHER, SUDOERS, CONFIG)}
    for path in original:
        shutil.copy2(path, backup / path.name)
    try:
        replace_file(UNIT, (bundle / 'evem-tactical-asgi.service.example').read_bytes())
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', '--now', 'evem-tactical-asgi.service')
        run('systemctl', 'is-active', '--quiet', 'evem-tactical-asgi.service')
        for attempt in range(5):
            try:
                probe_loopback()
                break
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(1)

        replace_file(NGINX, nginx.replace(anchor, (bundle / 'tactical-nginx-location.example.conf').read_text() + anchor).encode())
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')

        replace_file(SUDOERS, (SUDOERS.read_text().rstrip() + '\n' + SUDO_RULE).encode())
        run('visudo', '-cf', str(SUDOERS))
        replace_file(PUBLISHER, (bundle / 'release.py').read_bytes())
        config['tactical_ws'] = True
        replace_file(CONFIG, (json.dumps(config, indent=2, ensure_ascii=False) + '\n').encode())
        run(str(BACKEND / '.venv/bin/python'), '-c',
            "import sys; sys.path.insert(0, '/usr/local/lib/evem-deploy'); "
            "import json, release; "
            "release.health(json.load(open('/EVEMTK/deploy/config.json')), "
            "json.load(open('/EVEMTK/deploy/state.json')))")
    except BaseException:
        # A Ctrl-C or SIGTERM during cutover must restore the exact old
        # publisher/config, too. Ignore a second signal only while restoring.
        previous_handlers = {signum: signal.signal(signum, signal.SIG_IGN) for signum in INTERRUPT_SIGNALS}
        try:
            for path, data in original.items():
                replace_file(path, data)
            run('nginx', '-t')
            run('systemctl', 'reload', 'nginx')
            run('systemctl', 'disable', '--now', 'evem-tactical-asgi.service')
            UNIT.unlink(missing_ok=True)
            run('systemctl', 'daemon-reload')
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
        raise
    print('Tactical WebSocket active; config backups: ' + str(backup))


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise RuntimeError('tactical activation interrupted; rolling back')

    for signum in INTERRUPT_SIGNALS:
        signal.signal(signum, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--expected-sha', required=True)
    args = parser.parse_args()
    activate(args.bundle.resolve(), args.expected_sha)
