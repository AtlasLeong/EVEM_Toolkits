"""One-off reviewed feedback configuration. Root only; preserves original backups.

Run only after the recorded database backup. No service restart is performed;
only nginx test/reload, reverting both config files on failure.
"""
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess

backup = Path('/EVEMTK/deploy-backups/20260908-feedback')
env_file = Path('/EVEMTK/EVEM_Toolkits/backend/.env')
nginx_file = Path('/etc/nginx/conf.d/evemtk.conf')
upload_root = Path('/EVEMTK/deploy/shared/feedback-uploads')
if os.geteuid() != 0 or not (backup / 'backup.json').is_file():
    raise RuntimeError('Requires root and the verified feedback database backup')
if upload_root.resolve() != upload_root or upload_root.exists():
    raise RuntimeError('Private upload directory must be new and not symlinked')
env = env_file.read_text(encoding='utf-8-sig')
nginx = nginx_file.read_text()
if any(line.strip().startswith('FEEDBACK_UPLOAD_ROOT=') for line in env.splitlines()):
    raise RuntimeError('Existing feedback storage configuration requires manual review')
needle = '    location /api/ {\n'
if nginx.count(needle) != 1 or '/api/feedback/' in nginx:
    raise RuntimeError('Unexpected nginx layout; refuse to overwrite')
snippet = '''    # Private feedback attachments: 10 MiB file plus multipart overhead.
    location /api/feedback/ {
        client_max_body_size 11m;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
'''

def replace_preserving_metadata(path, text):
    metadata = path.stat()
    temporary = path.with_name(path.name + '.feedback-candidate')
    with temporary.open('x', encoding='utf-8') as output:
        os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        output.write(text)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)

for source, name in [(env_file, 'backend.env.before'), (nginx_file, 'evemtk.conf.before')]:
    target = backup / name
    if target.exists():
        raise RuntimeError('Existing rollback backup; stop before overwriting')
    shutil.copy2(source, target)
    os.chmod(target, 0o600)
nginx_user = pwd.getpwnam('nginx')
upload_root.mkdir(mode=0o700)
os.chown(upload_root, nginx_user.pw_uid, nginx_user.pw_gid)
try:
    replace_preserving_metadata(env_file, env.rstrip() + '\nFEEDBACK_UPLOAD_ROOT=' + str(upload_root) + '\n')
    replace_preserving_metadata(nginx_file, nginx.replace(needle, snippet + needle))
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except Exception:
    replace_preserving_metadata(env_file, env)
    replace_preserving_metadata(nginx_file, nginx)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    raise
print(json.dumps({'private_upload_root': str(upload_root), 'nginx': 'tested and reloaded', 'backend': 'not restarted', 'config_backups': str(backup)}))
