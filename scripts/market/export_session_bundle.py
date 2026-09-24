"""One-shot, local export of an authorized Windows collector session."""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import stat
import sys

import msgpack


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'backend'))

from Market.session_bundle import encode_session  # noqa: E402


FILE_MAGIC = b'EVEMDP1\0'
MAX_SOURCE_SIZE = 4 * 1024 * 1024
_RESERVED_WINDOWS_NAMES = (
    {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'}
    | {f'{prefix}{number}' for prefix in ('COM', 'LPT') for number in '123456789¹²³'}
)


class ExportError(Exception):
    """Safe failure that contains no source path or authentication material."""


class _DataBlob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]


class _SidAndAttributes(ctypes.Structure):
    _fields_ = [('Sid', ctypes.c_void_p), ('Attributes', wintypes.DWORD)]


class _TokenUser(ctypes.Structure):
    _fields_ = [('User', _SidAndAttributes)]


class _SecurityAttributes(ctypes.Structure):
    _fields_ = [
        ('nLength', wintypes.DWORD),
        ('lpSecurityDescriptor', ctypes.c_void_p),
        ('bInheritHandle', wintypes.BOOL),
    ]


def _unprotect(ciphertext: bytes) -> bytes:
    """Decrypt with the current Windows account, never writing plaintext."""
    if os.name != 'nt':
        raise ExportError()
    crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(_DataBlob), ctypes.c_void_p, ctypes.POINTER(_DataBlob),
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_DataBlob),
    ]
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    source = ctypes.create_string_buffer(ciphertext)
    input_blob = _DataBlob(len(ciphertext), ctypes.cast(source, ctypes.POINTER(ctypes.c_ubyte)))
    output_blob = _DataBlob()
    if not crypt32.CryptUnprotectData(
        ctypes.byref(input_blob), None, None, None, None, 1, ctypes.byref(output_blob),
    ):
        raise ExportError()
    try:
        if output_blob.cbData > MAX_SOURCE_SIZE:
            raise ExportError()
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(output_blob.pbData, ctypes.c_void_p))


def decode_collector_source(source: Path) -> bytes:
    """Validate the collector payload and return portable JSON in memory."""
    try:
        if not source.is_absolute():
            raise ExportError()
        info = source.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_SOURCE_SIZE:
            raise ExportError()
        with source.open('rb') as stream:
            opened = os.fstat(stream.fileno())
            if (not stat.S_ISREG(opened.st_mode)
                    or not info.st_ino or not opened.st_ino
                    or (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino)):
                raise ExportError()
            encrypted = stream.read(MAX_SOURCE_SIZE + 1)
        if len(encrypted) > MAX_SOURCE_SIZE or not encrypted.startswith(FILE_MAGIC):
            raise ExportError()
        plaintext = _unprotect(encrypted[len(FILE_MAGIC):])
        bundle = msgpack.unpackb(plaintext, raw=False, strict_map_key=False)
        return encode_session(bundle).encode('utf-8')
    except Exception:
        raise ExportError() from None


def _local_drive_path(path: Path) -> bool:
    drive = path.drive
    return (path.is_absolute() and len(drive) == 2 and drive[0].isalpha()
            and drive[1] == ':')


def _ordinary_filename(name: str) -> bool:
    if (not name or name[-1] in ' .'
            or any(ord(character) < 32 or character in '<>:"|?*' for character in name)):
        return False
    return name.split('.', 1)[0].upper() not in _RESERVED_WINDOWS_NAMES


def _local_acl_volume(path: Path) -> bool:
    """Reject network and non-ACL volumes before a plaintext file exists."""
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


def _current_user_sid() -> str:
    """Get the exact Windows account SID rather than a localized user name."""
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
        raise ExportError()
    try:
        size = wintypes.DWORD()
        advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
        if size.value < ctypes.sizeof(_TokenUser):
            raise ExportError()
        data = ctypes.create_string_buffer(size.value)
        if not advapi32.GetTokenInformation(token, 1, data, size, ctypes.byref(size)):
            raise ExportError()
        sid = ctypes.cast(data, ctypes.POINTER(_TokenUser)).contents.User.Sid
        sid_text = ctypes.c_wchar_p()
        if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(sid_text)):
            raise ExportError()
        try:
            return sid_text.value
        finally:
            kernel32.LocalFree(ctypes.cast(sid_text, ctypes.c_void_p))
    finally:
        kernel32.CloseHandle(token)


def _create_owner_only_file(destination: Path, content: bytes) -> None:
    """Create exactly once, with a protected DACL in force before first write."""
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
        raise ExportError()
    created = False
    try:
        attributes = _SecurityAttributes(ctypes.sizeof(_SecurityAttributes), descriptor, False)
        handle = kernel32.CreateFileW(
            str(destination), 0x40000000, 0, ctypes.byref(attributes),
            1, 0x80, None,  # GENERIC_WRITE, CREATE_NEW, FILE_ATTRIBUTE_NORMAL
        )
        if handle == ctypes.c_void_p(-1).value:
            raise ExportError()
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
        raise ExportError() from None
    finally:
        kernel32.LocalFree(descriptor)


def export_session(source: Path, destination: Path) -> None:
    """Export one owner-authorized source to a new local private JSON file."""
    try:
        if (os.name != 'nt' or not _local_drive_path(source)
                or not _local_drive_path(destination) or not _ordinary_filename(destination.name)):
            raise ExportError()
        parent = destination.parent.resolve(strict=True)
        if not parent.is_dir() or parent == REPOSITORY_ROOT or REPOSITORY_ROOT in parent.parents:
            raise ExportError()
        if not _local_acl_volume(source.parent) or not _local_acl_volume(parent):
            raise ExportError()
        content = decode_collector_source(source)
        _create_owner_only_file(parent / destination.name, content)
    except Exception:
        raise ExportError() from None


class _QuietArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise ExportError() from None


def main(argv: list[str] | None = None) -> int:
    parser = _QuietArgumentParser(
        description='Export a Windows collector session for private Linux Market import.',
    )
    parser.add_argument('--source', required=True, type=Path, help='Absolute path to your DPAPI session')
    parser.add_argument('--output', required=True, type=Path, help='New private portable JSON path')
    try:
        options = parser.parse_args(argv)
        export_session(options.source, options.output)
    except Exception:
        print('Market session export failed.', file=sys.stderr)
        return 1
    print('Market session exported.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
