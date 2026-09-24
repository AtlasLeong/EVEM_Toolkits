"""Windows-only encrypted escrow for an explicitly named Market MySQL backup."""

import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime
import hashlib
import os
from pathlib import Path
import queue
import re
import shlex
import stat
import subprocess
import sys
import threading
import time


MAX_BACKUP_BYTES = 64 * 1024 * 1024
REMOTE_DUMP_RE = re.compile(
    r'/EVEMTK/deploy-backups/market-pre-([0-9]{8})-([0-9]{6})/'
    r'default-before-market\.sql\Z'
)
SHA256_RE = re.compile(r'[0-9a-f]{64}\Z')
REMOTE_TARGET = 'root@8.134.144.49'
MAX_ENCRYPTED_BYTES = MAX_BACKUP_BYTES + 1024 * 1024
SSH_TRANSFER_TIMEOUT_SECONDS = 300
SSH_READER_JOIN_TIMEOUT_SECONDS = 2
FILE_MAGIC = b'EVEMDB1\0'
_RESERVED_WINDOWS_NAMES = (
    {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'}
    | {f'{prefix}{number}' for prefix in ('COM', 'LPT') for number in '123456789¹²³'}
)


class _DataBlob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]


class _SidAndAttributes(ctypes.Structure):
    _fields_ = [('Sid', ctypes.c_void_p), ('Attributes', wintypes.DWORD)]


class _TokenUser(ctypes.Structure):
    _fields_ = [('User', _SidAndAttributes)]


class _SecurityAttributes(ctypes.Structure):
    _fields_ = [
        ('nLength', wintypes.DWORD), ('lpSecurityDescriptor', ctypes.c_void_p),
        ('bInheritHandle', wintypes.BOOL),
    ]


class TransferError(RuntimeError):
    """Safe-to-display transfer refusal with no dump or credential content."""


def validate_remote_dump(remote_dump):
    if not isinstance(remote_dump, str):
        raise TransferError('Remote dump path is outside the explicit backup allowlist.')
    match = REMOTE_DUMP_RE.fullmatch(remote_dump)
    if not match:
        raise TransferError('Remote dump path is outside the explicit backup allowlist.')
    try:
        datetime.strptime(''.join(match.groups()), '%Y%m%d%H%M%S')
    except ValueError:
        raise TransferError('Remote backup timestamp is invalid.') from None
    return remote_dump


def validate_expected(expected_size, expected_sha256):
    if type(expected_size) is not int or not 0 < expected_size <= MAX_BACKUP_BYTES:
        raise TransferError('Expected backup size is missing or outside the 64 MiB limit.')
    if not isinstance(expected_sha256, str) or not SHA256_RE.fullmatch(expected_sha256):
        raise TransferError('Expected backup SHA-256 must be 64 lowercase hex characters.')
    return expected_size, expected_sha256


def validate_identity_file(identity_file, *, user_profile=None):
    """Require the approved local profile key without opening its contents."""
    if os.name != 'nt':
        raise TransferError('A local Windows private key is required.')
    try:
        identity = Path(identity_file)
        profile = _known_folder(0x28) if user_profile is None else Path(user_profile)
        expected = profile / '.ssh' / 'evem_cloud_admin'
        info = identity.lstat()
        if (not _local_drive_path(identity) or identity != expected
                or identity.is_symlink() or expected.parent.is_symlink()
                or not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= 1024 * 1024
                or not _local_acl_volume(identity.parent)):
            raise TransferError('SSH identity is not the approved local profile key.')
        if identity.resolve(strict=True) != expected.resolve(strict=True):
            raise TransferError('SSH identity path is not trusted.')
        return identity
    except Exception:
        raise TransferError('SSH identity is not the approved local profile key.') from None


def _system_ssh_executable():
    """Locate trusted Windows OpenSSH without consulting PATH or the working directory."""
    if os.name != 'nt':
        raise TransferError('Windows system OpenSSH is required.')
    try:
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.GetSystemDirectoryW.argtypes = [wintypes.LPWSTR, wintypes.UINT]
        kernel32.GetSystemDirectoryW.restype = wintypes.UINT
        directory = ctypes.create_unicode_buffer(32768)
        length = kernel32.GetSystemDirectoryW(directory, len(directory))
        if not 0 < length < len(directory):
            raise TransferError('Windows system OpenSSH could not be verified.')
        system_directory = Path(directory.value)
        executable = system_directory / 'OpenSSH' / 'ssh.exe'
        info = executable.lstat()
        if (not _local_drive_path(executable)
                or system_directory.name.lower() != 'system32'
                or executable.is_symlink()
                or executable.resolve(strict=True) != executable
                or not stat.S_ISREG(info.st_mode)):
            raise TransferError('Windows system OpenSSH could not be verified.')
        return executable
    except Exception:
        raise TransferError('Windows system OpenSSH could not be verified.') from None


def fetch_backup(remote_dump, expected_size, expected_sha256, identity_file, *,
                 popen=subprocess.Popen):
    """Read a bounded, host-key-authenticated SSH stream only into memory."""
    validate_remote_dump(remote_dump)
    validate_expected(expected_size, expected_sha256)
    identity = validate_identity_file(identity_file)
    ssh_executable = _system_ssh_executable()
    command = f'exec cat -- {shlex.quote(remote_dump)}'
    args = [
        str(ssh_executable), '-F', 'none', '-T', '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=yes',
        '-o', 'IdentitiesOnly=yes', '-i', str(identity),
        '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no',
        '-o', 'ConnectTimeout=15', REMOTE_TARGET, command,
    ]
    # Windows OpenSSH uses ProgramData for its system configuration/known-host
    # lookup. Keep this narrow while still excluding provider and DB secrets.
    allowed = {'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'PROGRAMDATA', 'HOME', 'SSH_AUTH_SOCK'}
    child_env = {key: value for key, value in os.environ.items() if key in allowed}
    process = None
    reader_thread = None
    stopped = threading.Event()
    events = queue.Queue(maxsize=2)
    read_failed = object()
    succeeded = False
    deadline = time.monotonic() + SSH_TRANSFER_TIMEOUT_SECONDS
    try:
        process = popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, env=child_env)

        def reader():
            try:
                while not stopped.is_set():
                    chunk = process.stdout.read(1024 * 1024)
                    while not stopped.is_set():
                        try:
                            events.put(chunk, timeout=0.1)
                            break
                        except queue.Full:
                            pass
                    if not chunk:
                        return
            except Exception:
                while not stopped.is_set():
                    try:
                        events.put(read_failed, timeout=0.1)
                        return
                    except queue.Full:
                        pass

        reader_thread = threading.Thread(target=reader, daemon=True,
                                         name='market-backup-ssh-reader')
        reader_thread.start()
        digest = hashlib.sha256()
        chunks = []
        total = 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TransferError('Authenticated SSH backup transfer timed out.')
            try:
                chunk = events.get(timeout=remaining)
            except queue.Empty:
                raise TransferError('Authenticated SSH backup transfer timed out.') from None
            if chunk is read_failed:
                raise TransferError('Authenticated SSH backup stream failed.')
            if not chunk:
                break
            total += len(chunk)
            if total > expected_size or total > MAX_BACKUP_BYTES:
                raise TransferError('SSH backup exceeded the expected size or hard limit.')
            digest.update(chunk)
            chunks.append(chunk)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TransferError('Authenticated SSH backup transfer timed out.')
        if process.wait(timeout=remaining) != 0:
            raise TransferError('Authenticated SSH backup transfer failed.')
        if total != expected_size or digest.hexdigest() != expected_sha256:
            raise TransferError('SSH backup size or SHA-256 did not match the expected values.')
        succeeded = True
        return b''.join(chunks)
    except Exception:
        raise TransferError('Authenticated SSH backup transfer or checksum failed.') from None
    finally:
        stopped.set()
        if process is not None:
            if not succeeded:
                try:
                    process.kill()
                except Exception:
                    pass
                try:
                    process.wait(timeout=2)
                except Exception:
                    pass
            reader_alive = False
            if reader_thread is not None:
                reader_thread.join(timeout=SSH_READER_JOIN_TIMEOUT_SECONDS)
                reader_alive = reader_thread.is_alive()
            if not reader_alive:
                # BufferedReader.close may wait on the lock held by a stuck read.
                # A live reader is daemonized; never block the CLI on its close.
                try:
                    process.stdout.close()
                except Exception:
                    pass


def _windows_dpapi(data, *, decrypt):
    if os.name != 'nt' or not isinstance(data, bytes) or not data:
        raise TransferError('Windows CurrentUser DPAPI is required.')
    if len(data) > (MAX_ENCRYPTED_BYTES if decrypt else MAX_BACKUP_BYTES):
        raise TransferError('DPAPI input exceeds the backup size limit.')
    try:
        crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p
        if decrypt:
            crypt32.CryptUnprotectData.argtypes = [
                ctypes.POINTER(_DataBlob), ctypes.c_void_p, ctypes.POINTER(_DataBlob),
                ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
                ctypes.POINTER(_DataBlob),
            ]
            operation = crypt32.CryptUnprotectData
        else:
            crypt32.CryptProtectData.argtypes = [
                ctypes.POINTER(_DataBlob), wintypes.LPCWSTR, ctypes.POINTER(_DataBlob),
                ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
                ctypes.POINTER(_DataBlob),
            ]
            operation = crypt32.CryptProtectData
        operation.restype = wintypes.BOOL
        source = ctypes.create_string_buffer(data)
        input_blob = _DataBlob(len(data), ctypes.cast(source, ctypes.POINTER(ctypes.c_ubyte)))
        output_blob = _DataBlob()
        description = None if decrypt else 'EVEM Market MySQL backup escrow'
        if not operation(ctypes.byref(input_blob), description, None, None, None, 1,
                         ctypes.byref(output_blob)):
            raise TransferError('Windows CurrentUser DPAPI operation failed.')
        try:
            limit = MAX_BACKUP_BYTES if decrypt else MAX_ENCRYPTED_BYTES
            if not 0 < output_blob.cbData <= limit:
                raise TransferError('DPAPI output exceeds the backup size limit.')
            return ctypes.string_at(output_blob.pbData, output_blob.cbData)
        finally:
            kernel32.LocalFree(ctypes.cast(output_blob.pbData, ctypes.c_void_p))
    except Exception:
        raise TransferError('Windows CurrentUser DPAPI operation failed.') from None


def protect_current_user(plaintext):
    return _windows_dpapi(plaintext, decrypt=False)


def unprotect_current_user(ciphertext):
    return _windows_dpapi(ciphertext, decrypt=True)


def _known_folder(csidl):
    """Resolve the signed-in user's profile or LocalAppData without environment overrides."""
    if os.name != 'nt':
        raise TransferError('Windows local profile is required.')
    shell32 = ctypes.WinDLL('shell32', use_last_error=True)
    shell32.SHGetFolderPathW.argtypes = [
        wintypes.HWND, ctypes.c_int, wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
    ]
    shell32.SHGetFolderPathW.restype = ctypes.c_long
    folder = ctypes.create_unicode_buffer(32768)
    if shell32.SHGetFolderPathW(None, csidl, None, 0, folder) != 0:
        raise TransferError('Windows local profile could not be verified.')
    return Path(folder.value)


def _local_drive_path(path):
    drive = path.drive
    return path.is_absolute() and len(drive) == 2 and drive[0].isalpha() and drive[1] == ':'


def _ordinary_filename(name):
    if (not name or name[-1] in ' .'
            or any(ord(character) < 32 or character in '<>:"|?*' for character in name)):
        return False
    return name.split('.', 1)[0].upper() not in _RESERVED_WINDOWS_NAMES


def _local_acl_volume(path):
    """Require a fixed local volume that persists NTFS-style ACLs."""
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.GetVolumePathNameW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
    kernel32.GetVolumePathNameW.restype = wintypes.BOOL
    kernel32.GetDriveTypeW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetDriveTypeW.restype = wintypes.UINT
    kernel32.GetVolumeInformationW.argtypes = [
        wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(wintypes.DWORD), wintypes.LPWSTR, wintypes.DWORD,
    ]
    kernel32.GetVolumeInformationW.restype = wintypes.BOOL
    mount = ctypes.create_unicode_buffer(32768)
    if not kernel32.GetVolumePathNameW(str(path), mount, len(mount)):
        return False
    if kernel32.GetDriveTypeW(mount.value) != 3:  # DRIVE_FIXED
        return False
    flags = wintypes.DWORD()
    if not kernel32.GetVolumeInformationW(
        mount.value, None, 0, None, None, ctypes.byref(flags), None, 0,
    ):
        return False
    return bool(flags.value & 0x00000008)  # FILE_PERSISTENT_ACLS


def validate_destination(output):
    """Accept only a fresh .dpapi file beneath this user's LocalAppData."""
    if os.name != 'nt':
        raise TransferError('Windows CurrentUser DPAPI is required.')
    try:
        destination = Path(output)
        if (not _local_drive_path(destination) or not _ordinary_filename(destination.name)
                or destination.suffix.lower() != '.dpapi'):
            raise TransferError('Encrypted output must be a new local .dpapi file.')
        root = _known_folder(0x1c).resolve(strict=True)  # CSIDL_LOCAL_APPDATA
        profile = _known_folder(0x28).resolve(strict=True)  # CSIDL_PROFILE
        if not _local_drive_path(root) or profile not in root.parents:
            raise TransferError('Current user private directory could not be verified.')
        original_parent = destination.parent
        parent = original_parent.resolve(strict=True)
        if (not original_parent.is_dir()
                or not (original_parent == root or root in original_parent.parents)
                or not (parent == root or root in parent.parents)
                or not _local_acl_volume(parent)
                or destination.exists() or destination.is_symlink()):
            raise TransferError('Encrypted output must be new inside private LocalAppData.')
        return parent / destination.name
    except Exception:
        raise TransferError('Encrypted output must be new inside private LocalAppData.') from None


def _current_user_sid():
    """Get the exact Windows account SID, independent of account-name localization."""
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    advapi32.OpenProcessToken.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetTokenInformation.restype = wintypes.BOOL
    advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_wchar_p)]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        raise TransferError('Windows user identity could not be verified.')
    try:
        size = wintypes.DWORD()
        advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
        if size.value < ctypes.sizeof(_TokenUser):
            raise TransferError('Windows user identity could not be verified.')
        data = ctypes.create_string_buffer(size.value)
        if not advapi32.GetTokenInformation(token, 1, data, size, ctypes.byref(size)):
            raise TransferError('Windows user identity could not be verified.')
        sid = ctypes.cast(data, ctypes.POINTER(_TokenUser)).contents.User.Sid
        sid_text = ctypes.c_wchar_p()
        if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(sid_text)):
            raise TransferError('Windows user identity could not be verified.')
        try:
            return sid_text.value
        finally:
            kernel32.LocalFree(ctypes.cast(sid_text, ctypes.c_void_p))
    finally:
        kernel32.CloseHandle(token)


def _create_owner_only_file(destination, content):
    """Use CREATE_NEW with a protected owner-only DACL before the first byte."""
    import msvcrt

    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
        ctypes.POINTER(_SecurityAttributes), wintypes.DWORD, wintypes.DWORD,
        wintypes.HANDLE,
    ]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    sid = _current_user_sid()
    descriptor = ctypes.c_void_p()
    sddl = f'O:{sid}D:P(A;;FA;;;{sid})'
    if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
        sddl, 1, ctypes.byref(descriptor), None,
    ):
        raise TransferError('Owner-only encrypted file could not be created.')
    created = False
    try:
        attributes = _SecurityAttributes(ctypes.sizeof(_SecurityAttributes), descriptor, False)
        handle = kernel32.CreateFileW(
            str(destination), 0x40000000, 0, ctypes.byref(attributes),
            1, 0x80, None,  # GENERIC_WRITE, CREATE_NEW, FILE_ATTRIBUTE_NORMAL
        )
        if handle == ctypes.c_void_p(-1).value:
            raise TransferError('Owner-only encrypted file could not be created.')
        created = True
        try:
            fd = msvcrt.open_osfhandle(handle, os.O_WRONLY | os.O_BINARY)
        except Exception:
            kernel32.CloseHandle(handle)
            raise
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        if created:
            try:
                destination.unlink()
            except OSError:
                pass
        raise TransferError('Owner-only encrypted file could not be created.') from None
    finally:
        kernel32.LocalFree(descriptor)


def transfer_backup(remote_dump, expected_size, expected_sha256, identity_file, output, *,
                    popen=subprocess.Popen):
    """Fetch, DPAPI-encrypt, create privately, and verify encrypted readback."""
    validate_remote_dump(remote_dump)
    validate_expected(expected_size, expected_sha256)
    validate_identity_file(identity_file)
    destination = validate_destination(output)
    plaintext = fetch_backup(remote_dump, expected_size, expected_sha256, identity_file,
                             popen=popen)
    ciphertext = protect_current_user(plaintext)
    content = FILE_MAGIC + ciphertext
    if len(content) > MAX_ENCRYPTED_BYTES:
        raise TransferError('Encrypted backup exceeds the size limit.')
    _create_owner_only_file(destination, content)
    try:
        with destination.open('rb') as stream:
            readback = stream.read(MAX_ENCRYPTED_BYTES + 1)
        if (len(readback) > MAX_ENCRYPTED_BYTES or not readback.startswith(FILE_MAGIC)
                or readback != content):
            raise TransferError('Encrypted file readback did not match.')
        recovered = unprotect_current_user(readback[len(FILE_MAGIC):])
        if (len(recovered) != expected_size
                or hashlib.sha256(recovered).hexdigest() != expected_sha256):
            raise TransferError('Encrypted backup readback checksum did not match.')
    except Exception:
        try:
            destination.unlink()
        except OSError:
            pass
        raise TransferError('Encrypted backup readback verification failed.') from None


class _QuietArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise TransferError('Invalid encrypted backup transfer arguments.') from None


def main(argv=None):
    parser = _QuietArgumentParser(description='Encrypt one explicitly identified backup locally.')
    parser.add_argument('--remote-dump', required=True)
    parser.add_argument('--expected-size', required=True, type=int)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--identity-file', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    try:
        options = parser.parse_args(argv)
        transfer_backup(options.remote_dump, options.expected_size,
                        options.expected_sha256, options.identity_file, options.output)
    except Exception:
        print('Encrypted backup transfer failed.', file=sys.stderr)
        return 1
    print('Encrypted backup saved and verified. Recovery requires the same Windows user profile.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
