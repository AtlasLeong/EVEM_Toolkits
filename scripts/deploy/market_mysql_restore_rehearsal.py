"""Restore a verified MySQL backup only into an isolated QA schema.

This intentionally does not run Django migrations or the Market seed command.
The operator uses the separately guarded QA settings for those later steps.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from typing import NamedTuple


QA_SCHEMA_RE = re.compile(r'evem_market_qa_[0-9a-f]{12}\Z')
SHA256_RE = re.compile(r'[0-9a-f]{64}\Z')
UUID_RE = re.compile(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\Z')
DUMP_NAME = 'default-before-market.sql'
SOURCE_DATABASE = 'eve_echoes'


class RehearsalError(RuntimeError):
    """A safe-to-display failure, never containing credentials or dump content."""


class VerifiedBackup(NamedTuple):
    dump_path: Path
    manifest: dict
    qa_schema: str


def validate_qa_schema(schema, source_database):
    if not isinstance(schema, str) or not QA_SCHEMA_RE.fullmatch(schema):
        raise RehearsalError('QA schema must be a fresh evem_market_qa_ name with 12 lowercase hex characters.')
    if schema.casefold() == str(source_database).casefold():
        raise RehearsalError('QA schema may not match the source database.')
    return schema


def private_backup_parent(mode, owner_uid, current_uid):
    """Only the invoking OS user may inspect or replace sibling backup files."""
    return stat.S_ISDIR(mode) and owner_uid == current_uid and mode & 0o077 == 0


def _tokens(path):
    """Lex executable dump text, including MySQL version comments, without row values."""
    state = 'normal'
    return_state = 'normal'
    quote = None
    escaped = False
    identifier = bytearray()
    with Path(path).open('rb') as source:
        for line in source:
            i = 0
            while i < len(line):
                c = line[i]
                two = line[i:i + 2]
                if state == 'comment':
                    if two == b'*/':
                        state = 'normal'
                        i += 2
                    else:
                        i += 1
                    continue
                if state == 'string':
                    if escaped:
                        escaped = False
                    elif c == 92:  # MySQL backslash escape within a string.
                        escaped = True
                    elif c == quote:
                        if i + 1 < len(line) and line[i + 1] == quote:
                            i += 2
                            continue
                        state = return_state
                    i += 1
                    continue
                if state == 'identifier':
                    if c == 96:
                        if i + 1 < len(line) and line[i + 1] == 96:
                            identifier.append(96)
                            i += 2
                            continue
                        yield ('identifier', bytes(identifier).decode('latin1').casefold())
                        identifier.clear()
                        state = return_state
                    else:
                        identifier.append(c)
                    i += 1
                    continue
                if state == 'conditional' and two == b'*/':
                    state = 'normal'
                    i += 2
                    continue
                if two == b'/*':
                    if line[i:i + 3] == b'/*!':
                        state = 'conditional'
                        i += 3
                        while i < len(line) and 48 <= line[i] <= 57:
                            i += 1
                    else:
                        state = 'comment'
                        i += 2
                    continue
                if c == 35 or (two == b'--' and (i + 2 == len(line) or line[i + 2] in b' \t\r\n')):
                    break
                if c in (39, 34):
                    return_state = state
                    state = 'string'
                    quote = c
                    i += 1
                    continue
                if c == 96:
                    return_state = state
                    state = 'identifier'
                    i += 1
                    continue
                if c == 92:
                    raise RehearsalError('Dump contains a MySQL client escape command outside a value.')
                if 65 <= c <= 90 or 97 <= c <= 122 or c == 95:
                    start = i
                    i += 1
                    while i < len(line) and (65 <= line[i] <= 90 or 97 <= line[i] <= 122
                                             or 48 <= line[i] <= 57 or line[i] in (95, 36)):
                        i += 1
                    yield ('identifier', line[start:i].decode('ascii').casefold())
                    continue
                if c == 46:
                    yield ('dot', '.')
                i += 1
    if state != 'normal':
        raise RehearsalError('Dump ends inside an SQL string, identifier, or comment.')


def inspect_dump(path, source_database):
    previous = None
    source_name = str(source_database).casefold()
    forbidden_commands = {'use', 'source', 'system', 'connect', 'tee', 'pager', 'prompt'}
    for token in _tokens(path):
        if token[0] == 'identifier':
            word = token[1]
            if word in forbidden_commands:
                raise RehearsalError('Dump contains a database switch or client command.')
            if previous and previous[0] == 'identifier' and previous[1] in {'create', 'alter', 'drop'} \
                    and word in {'database', 'schema', 'user'}:
                raise RehearsalError('Dump contains database-level or user-management SQL.')
            if previous and previous[0] == 'identifier' and previous[1] == 'set' \
                    and word in {'global', 'persist', 'persist_only'}:
                raise RehearsalError('Dump contains server-global SQL.')
        elif token[0] == 'dot' and previous == ('identifier', source_name):
            raise RehearsalError('Dump references the source schema by qualified name.')
        previous = token


def verify_backup(manifest_path, qa_schema=None):
    manifest_path = Path(manifest_path)
    parent = manifest_path.parent
    if (not parent.is_absolute() or parent.is_symlink() or not parent.is_dir()
            or manifest_path.name != 'backup.json'):
        raise RehearsalError('Backup manifest parent must be a real private directory.')
    if os.name == 'posix':
        try:
            resolved_parent = parent.resolve(strict=True)
            metadata = parent.stat()
        except OSError:
            raise RehearsalError('Backup manifest parent could not be inspected.') from None
        if resolved_parent != parent:
            raise RehearsalError('Backup manifest path must not traverse symlinks.')
        if not private_backup_parent(metadata.st_mode, metadata.st_uid, os.geteuid()):
            raise RehearsalError('Backup manifest parent must be owned by this user and private.')
    if not manifest_path.is_absolute() or manifest_path.is_symlink() or not manifest_path.is_file():
        raise RehearsalError('Backup manifest must be an existing regular file at an absolute path.')
    try:
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise RehearsalError('Backup manifest is unreadable or invalid.') from None
    if not isinstance(manifest, dict) or manifest.get('database') != SOURCE_DATABASE:
        raise RehearsalError('Backup manifest must identify the expected source database.')
    if qa_schema is not None:
        validate_qa_schema(qa_schema, manifest['database'])
    path_value = manifest.get('file')
    if not isinstance(path_value, str):
        raise RehearsalError('Backup manifest does not identify a dump file.')
    dump_path = Path(path_value)
    if (not dump_path.is_absolute() or dump_path.name != DUMP_NAME
            or dump_path.parent != manifest_path.parent or dump_path.is_symlink()
            or not dump_path.is_file()):
        raise RehearsalError('Backup dump must be the regular file beside its manifest.')
    size = manifest.get('size')
    digest_value = manifest.get('sha256')
    if (type(size) is not int or size <= 0 or not isinstance(digest_value, str)
            or not SHA256_RE.fullmatch(digest_value)):
        raise RehearsalError('Backup manifest size or SHA-256 is invalid.')
    expected_counts = manifest.get('table_counts')
    if expected_counts is not None and (
        not isinstance(expected_counts, dict) or not expected_counts
        or len(expected_counts) > 10000
        or any(not isinstance(name, str) or not name or len(name) > 64
               or type(count) is not int or count < 0
               for name, count in expected_counts.items())
    ):
        raise RehearsalError('Backup manifest table counts are invalid.')
    try:
        metadata = dump_path.stat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != size:
            raise RehearsalError('Backup dump size differs from its manifest.')
        if os.name == 'posix':
            for private_file in (manifest_path, dump_path):
                if private_file.stat().st_mode & 0o077:
                    raise RehearsalError('Backup manifest and dump must be owner-private.')
        digest = hashlib.sha256()
        with dump_path.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
            source.seek(max(0, size - 4096))
            last_lines = source.read().splitlines()
        if digest.hexdigest() != digest_value:
            raise RehearsalError('Backup dump SHA-256 differs from its manifest.')
        if not last_lines or not last_lines[-1].startswith(b'-- Dump completed on '):
            raise RehearsalError('Backup dump has no completion footer.')
        inspect_dump(dump_path, manifest['database'])
    except OSError:
        raise RehearsalError('Backup dump could not be inspected.') from None
    return VerifiedBackup(dump_path, manifest, qa_schema)


def verify_only(manifest_path, backend_dir):
    """Inspect backup and staged assets without QA credentials or a DB connection."""
    backup = verify_backup(manifest_path)
    candidate = inspect_candidate(backend_dir)
    return {'size': backup.manifest['size'], 'sha256': backup.manifest['sha256'],
            'catalog_rows': candidate['catalog_rows']}


def _option_value(value):
    if not isinstance(value, str) or not value or any(char in value for char in '\r\n\x00'):
        raise RehearsalError('MySQL rehearsal credentials are incomplete or invalid.')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def _mysql_output(runner, options_path, child_env, *, stage, sql=None, schema=None, dump=None):
    args = [
        'mysql', f'--defaults-file={options_path}', '--protocol=TCP', '--batch', '--raw',
        '--silent', '--skip-column-names', '--binary-mode', '--local-infile=0',
        '--default-character-set=utf8mb4', '--skip-reconnect',
    ]
    if schema is not None:
        args.append(f'--database={schema}')
    if sql is not None:
        args.append(f'--execute={sql}')
    try:
        result = runner(args, stdin=dump, stdout=subprocess.DEVNULL if dump else subprocess.PIPE,
                        stderr=subprocess.PIPE, check=False, env=child_env)
    except (OSError, subprocess.SubprocessError):
        raise RehearsalError(f'MySQL {stage} failed; the QA schema is never dropped automatically.') from None
    if result.returncode:
        error = re.search(rb'\bERROR\s+([0-9]{3,5})\b', getattr(result, 'stderr', b'') or b'')
        code = f' (error {error.group(1).decode("ascii")})' if error else ''
        raise RehearsalError(
            f'MySQL {stage} failed{code}; the QA schema is never dropped automatically.')
    if dump is not None:
        return ''
    try:
        return result.stdout.decode('utf-8')
    except (AttributeError, UnicodeError):
        raise RehearsalError(f'MySQL {stage} returned invalid output.') from None


def _identity(output, expected_schema):
    fields = output.strip().split('\t')
    if (len(fields) != 4 or not fields[1] or not fields[2]
            or fields[0] != expected_schema or fields[3] != 'NONE'):
        raise RehearsalError('MySQL connection identity did not match the isolated QA target.')
    return fields[1], fields[2]


def _require_exact_qa_grants(output, schema):
    # MySQL database grants treat unescaped underscores as single-character
    # wildcards, even when the database pattern is inside backticks.
    required_scope = '`' + schema.replace('_', '\\_') + '`.*'
    qa_create_grant = False
    for grant in output.splitlines():
        match = re.match(r'\AGRANT (.+?) ON (.+?) TO (.+)\Z', grant, re.IGNORECASE)
        if not match or ' WITH GRANT OPTION' in grant.upper():
            raise RehearsalError('MySQL account has grants outside the exact QA schema.')
        privileges, scope, _account = match.groups()
        if scope == '*.*' and privileges.upper() == 'USAGE':
            continue
        if scope != required_scope:
            raise RehearsalError('MySQL account has grants outside the exact QA schema.')
        if 'ALL PRIVILEGES' in privileges.upper() or 'CREATE' in privileges.upper().split(', '):
            qa_create_grant = True
    if not qa_create_grant:
        raise RehearsalError('MySQL account needs CREATE only on the exact QA schema.')


def _single_number(output, stage):
    value = output.strip()
    if not re.fullmatch(r'[0-9]+', value):
        raise RehearsalError(f'MySQL {stage} returned an invalid count.')
    return int(value)


def inspect_candidate(backend_dir):
    """Check packaged Market assets without importing website settings or Django."""
    backend = Path(backend_dir)
    if not backend.is_absolute() or backend.is_symlink() or not backend.is_dir():
        raise RehearsalError('Candidate backend must be an existing absolute directory.')
    required = (
        backend / 'manage.py',
        backend / 'EVE_MDjango' / 'market_rehearsal_settings.py',
        backend / 'Market' / 'management' / 'commands' / 'market_seed_catalog.py',
        backend / 'Market' / 'data' / 'market_catalog.json',
    )
    if any(path.is_symlink() or not path.is_file() for path in required):
        raise RehearsalError('Candidate backend lacks guarded Market migration or seed assets.')
    migrations_dir = backend / 'Market' / 'migrations'
    if migrations_dir.is_symlink() or not migrations_dir.is_dir():
        raise RehearsalError('Candidate backend lacks Market migrations.')
    migrations = sorted(path.stem for path in migrations_dir.glob('[0-9][0-9][0-9][0-9]_*.py')
                        if path.is_file() and not path.is_symlink())
    if not migrations or not migrations[0].startswith('0001_'):
        raise RehearsalError('Candidate backend has no initial Market migration.')
    try:
        catalog = json.loads(required[-1].read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise RehearsalError('Candidate Market seed catalog is unreadable or invalid.') from None
    if not isinstance(catalog, list) or not 0 < len(catalog) <= 10000:
        raise RehearsalError('Candidate Market seed catalog has invalid row count.')
    identifiers = set()
    for row in catalog:
        name = row.get('item_name') if isinstance(row, dict) else None
        category = row.get('market_group_name_3rd', '') if isinstance(row, dict) else None
        if (not isinstance(row, dict) or type(row.get('item_id')) is not int
                or not 1 <= row['item_id'] <= 2**63 - 1
                or row['item_id'] in identifiers or not isinstance(name, str)
                or not 0 < len(name.strip()) <= 255
                or not isinstance(category, str) or len(category) > 120):
            raise RehearsalError('Candidate Market seed catalog has an invalid item.')
        identifiers.add(row['item_id'])
    return {'guarded_settings_present': True, 'migration_files': migrations,
            'seed_command_present': True, 'catalog_rows': len(catalog)}


def rehearse(manifest_path, qa_schema, *, backend_dir=None, environ=None,
             runner=subprocess.run):
    """Restore into a new QA-only schema; leave it intact even on partial failure."""
    settings = os.environ if environ is None else environ
    if settings.get('EVEM_REHEARSAL_ENABLE') != '1':
        raise RehearsalError('Set EVEM_REHEARSAL_ENABLE=1 for an explicit QA rehearsal.')
    if settings.get('EVEM_REHEARSAL_DB_NAME') != qa_schema:
        raise RehearsalError('EVEM_REHEARSAL_DB_NAME must match the explicit QA schema.')
    user = settings.get('EVEM_REHEARSAL_DB_USER')
    password = settings.get('EVEM_REHEARSAL_DB_PASSWORD')
    expected_server = settings.get('EVEM_REHEARSAL_EXPECTED_SERVER_UUID')
    if user != qa_schema or not isinstance(password, str) or len(password) < 24:
        raise RehearsalError('Use a dedicated QA account named for the schema and a long password.')
    if not isinstance(expected_server, str) or not UUID_RE.fullmatch(expected_server):
        raise RehearsalError('The expected MySQL server UUID must be explicitly supplied.')
    user_option = _option_value(user)
    password_option = _option_value(password)
    candidate = inspect_candidate(backend_dir) if backend_dir is not None else None
    backup = verify_backup(manifest_path, qa_schema)
    credentials_fd = None
    credentials_path = None
    try:
        credentials_fd, name = tempfile.mkstemp(prefix='mysql-qa-', suffix='.cnf',
                                                 dir=backup.dump_path.parent)
        credentials_path = Path(name)
        if hasattr(os, 'fchmod'):
            os.fchmod(credentials_fd, 0o600)
        with os.fdopen(credentials_fd, 'w', encoding='utf-8') as options:
            credentials_fd = None
            options.write('[client]\n')
            options.write('host="127.0.0.1"\nport=3306\n')
            options.write(f'user={user_option}\npassword={password_option}\n')
            options.flush()
            os.fsync(options.fileno())
        login_path = Path(str(credentials_path) + '.no-login-path')
        if login_path.exists():
            raise RehearsalError('An unexpected MySQL login-path file exists.')
        allowed_child_keys = {'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'}
        child_env = {key: value for key, value in os.environ.items() if key in allowed_child_keys}
        child_env['MYSQL_TEST_LOGIN_FILE'] = str(login_path)
        before = _mysql_output(runner, credentials_path, child_env, stage='identity check',
                               sql='SELECT DATABASE(), CURRENT_USER(), @@server_uuid, CURRENT_ROLE()')
        identity = _identity(before, 'NULL')
        if identity[0] != f'{qa_schema}@127.0.0.1':
            raise RehearsalError('MySQL connected as an account other than the dedicated QA user.')
        if identity[1] != expected_server:
            raise RehearsalError('MySQL server identity differs from the provisioned QA target.')
        grants = _mysql_output(runner, credentials_path, child_env, stage='grant check',
                               sql='SHOW GRANTS')
        _require_exact_qa_grants(grants, qa_schema)
        exists = _mysql_output(
            runner, credentials_path, child_env, stage='schema check',
            sql=("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '"
                 + qa_schema + "'"),
        )
        if _single_number(exists, 'schema check') != 0:
            raise RehearsalError('QA schema already exists; no existing schema is reused.')
        _mysql_output(runner, credentials_path, child_env, stage='schema creation',
                      sql=f'CREATE DATABASE `{qa_schema}` CHARACTER SET utf8mb4')
        after = _mysql_output(runner, credentials_path, child_env, stage='switched identity check',
                              sql='SELECT DATABASE(), CURRENT_USER(), @@server_uuid, CURRENT_ROLE()',
                              schema=qa_schema)
        if _identity(after, qa_schema) != identity:
            raise RehearsalError('MySQL server or account changed after selecting the QA schema.')
        # Recheck the dump before piping it to the client; no schema is removed
        # if either this check or the import fails.
        verify_backup(manifest_path, qa_schema)
        with backup.dump_path.open('rb') as source:
            _mysql_output(runner, credentials_path, child_env, stage='dump import',
                          schema=qa_schema, dump=source)
        table_output = _mysql_output(
            runner, credentials_path, child_env, stage='table inventory', schema=qa_schema,
            sql=("SELECT TABLE_NAME FROM information_schema.TABLES "
                 "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' "
                 "ORDER BY TABLE_NAME"),
        )
        tables = table_output.splitlines()
        if not tables or len(tables) != len(set(tables)):
            raise RehearsalError('QA restore has no valid table inventory.')
        counts = {}
        for table in tables:
            if not table or len(table) > 64 or any(char in table for char in '\r\n\x00'):
                raise RehearsalError('QA restore has an invalid table identifier.')
            quoted = '`' + table.replace('`', '``') + '`'
            output = _mysql_output(runner, credentials_path, child_env, stage='table count',
                                   sql=f'SELECT DATABASE(), COUNT(*) FROM {quoted}',
                                   schema=qa_schema)
            parts = output.strip().split('\t')
            if len(parts) != 2 or parts[0] != qa_schema:
                raise RehearsalError('Table count connection left the QA schema.')
            counts[table] = _single_number(parts[1], 'table count')
        expected = backup.manifest.get('table_counts')
        if expected is not None and expected != counts:
            raise RehearsalError('QA table counts differ from backup manifest; QA schema is retained.')
        return {'schema': qa_schema, 'source_database': backup.manifest['database'],
                'table_counts': counts, 'source_counts_compared': expected is not None,
                'qa_schema_retained': True, 'candidate_assets': candidate}
    except OSError:
        raise RehearsalError('QA rehearsal could not create or read a private local file.') from None
    finally:
        if credentials_fd is not None:
            os.close(credentials_fd)
        if credentials_path is not None:
            credentials_path.unlink(missing_ok=True)


def main(argv=None, *, environ=None, runner=subprocess.run):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True,
                        help='Absolute path to the private backup.json manifest')
    parser.add_argument('--qa-schema',
                        help='Fresh evem_market_qa_ followed by 12 lowercase hex characters')
    parser.add_argument('--verify-only', action='store_true',
                        help='Scan backup and staged Market assets; never connect to MySQL')
    parser.add_argument('--backend-dir', type=Path,
                        help='Optional staged backend directory to inspect Market assets')
    args = parser.parse_args(argv)
    if args.verify_only:
        if args.qa_schema or args.backend_dir is None:
            parser.error('--verify-only requires --backend-dir and no --qa-schema')
    elif not args.qa_schema:
        parser.error('--qa-schema is required for a restore rehearsal')
    try:
        if args.verify_only:
            result = verify_only(args.manifest, args.backend_dir)
        else:
            result = rehearse(args.manifest, args.qa_schema, backend_dir=args.backend_dir,
                              environ=environ, runner=runner)
    except RehearsalError as exc:
        print(f'Restore rehearsal refused: {exc}', file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
