"""Import a bounded workbook range into a private Killboard account manifest.

The manifest is an operator input, never a web/release artifact. Values are
kept in memory only long enough to write the owner-private file. This module
never prints email addresses, passwords or the resulting path.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import tempfile
import re
import zipfile
import xml.etree.ElementTree as ET

try:
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:  # pragma: no cover - deployment must provide this dependency
    try:
        from Crypto.Cipher import AES as _CryptoAES
    except ImportError:  # pragma: no cover - deployment must provide this dependency
        _CryptoAES = None
    AESGCM = None
    InvalidTag = ValueError


NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/package/2006/relationships",
}
MAX_WORKBOOK_BYTES = 50 * 1024 * 1024
MAX_WORKBOOK_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_XML_PART_BYTES = 25 * 1024 * 1024
MAX_POOL_SIZE = 201


class AccountPoolError(ValueError):
    """The workbook or private output is invalid."""


_AAD = b"evem-killboard-account-pool-v1"


def _read_xml(archive: zipfile.ZipFile, name: str) -> ET.Element:
    """Bound both declared and actual XML bytes before materializing a tree."""
    if archive.getinfo(name).file_size > MAX_XML_PART_BYTES:
        raise AccountPoolError("workbook XML part exceeds the supported uncompressed size")
    with archive.open(name) as part:
        data = part.read(MAX_XML_PART_BYTES + 1)
    if len(data) > MAX_XML_PART_BYTES:
        raise AccountPoolError("workbook XML part exceeds the supported uncompressed size")
    return ET.fromstring(data)


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = _read_xml(archive, "xl/sharedStrings.xml")
    return [
        "".join(text.text or "" for text in item.iter(f"{{{NS['m']}}}t"))
        for item in root.findall("m:si", NS)
    ]


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    if cell.attrib.get("t") == "inlineStr":
        inline = cell.find("m:is", NS)
        return "" if inline is None else "".join(
            text.text or "" for text in inline.iter(f"{{{NS['m']}}}t")
        )
    value = cell.find("m:v", NS)
    if value is None or value.text is None:
        return ""
    if cell.attrib.get("t") == "s":
        try:
            index = int(value.text)
        except ValueError:
            raise AccountPoolError("workbook shared string is invalid") from None
        if not 0 <= index < len(shared):
            raise AccountPoolError("workbook shared string is invalid")
        return shared[index]
    return value.text


def read_accounts(workbook: str | Path, *, first_row: int = 200, last_row: int = 400) -> list[dict[str, str | int]]:
    """Read exactly the selected inclusive row range without exposing values."""
    source = Path(workbook)
    if not source.is_absolute() or not source.is_file():
        raise AccountPoolError("workbook path is unavailable")
    if first_row < 1 or last_row < first_row or last_row - first_row + 1 > MAX_POOL_SIZE:
        raise AccountPoolError("account row range is outside the supported bound")
    if source.stat().st_size > MAX_WORKBOOK_BYTES:
        raise AccountPoolError("workbook exceeds the supported size")

    try:
        with zipfile.ZipFile(source) as archive:
            # Compressed file size alone does not bound XML/shared-string
            # memory use. Include unused members in the aggregate limit.
            if sum(part.file_size for part in archive.infolist()) > MAX_WORKBOOK_UNCOMPRESSED_BYTES:
                raise AccountPoolError("workbook exceeds the supported uncompressed size")
            shared = _shared_strings(archive)
            workbook_root = _read_xml(archive, "xl/workbook.xml")
            relationships = _read_xml(archive, "xl/_rels/workbook.xml.rels")
            relation = {
                item.attrib["Id"]: item.attrib["Target"]
                for item in relationships.findall("p:Relationship", NS)
            }
            sheets = workbook_root.find("m:sheets", NS)
            if sheets is None or len(sheets) != 1:
                raise AccountPoolError("workbook must contain exactly one sheet")
            sheet = sheets[0]
            rel_id = sheet.attrib.get(f"{{{NS['r']}}}id")
            target = relation.get(rel_id or "")
            if not target:
                raise AccountPoolError("workbook sheet relationship is missing")
            # A package-root path is standard XLSX, not a filesystem path.
            target = target.lstrip("/")
            if not target.startswith("xl/"):
                target = f"xl/{target}"
            root = _read_xml(archive, target)
            rows = root.findall(".//m:sheetData/m:row", NS)
            found: list[dict[str, str | int]] = []
            seen: set[str] = set()
            seen_rows: set[int] = set()
            for row in rows:
                number = int(row.attrib.get("r", "0"))
                if not first_row <= number <= last_row:
                    continue
                if number in seen_rows:
                    raise AccountPoolError("duplicate account row in selected range")
                seen_rows.add(number)
                cells = {}
                for cell in row.findall("m:c", NS):
                    coordinate = cell.attrib.get("r", "")
                    column = re.match(r"[A-Za-z]+", coordinate)
                    if column:
                        cells[column.group(0).upper()] = _cell_value(cell, shared).strip()
                email, password = cells.get("B", ""), cells.get("C", "")
                if not email or not password or "@" not in email or len(email) > 254 or len(password) > 256:
                    raise AccountPoolError(f"row {number} does not contain a usable account")
                email_key = email.casefold()
                if email_key in seen:
                    raise AccountPoolError("duplicate account email in selected range")
                seen.add(email_key)
                found.append({"row": number, "email": email, "password": password})
            if seen_rows != set(range(first_row, last_row + 1)):
                raise AccountPoolError("selected account range contains missing rows")
            return found
    except (OSError, KeyError, ET.ParseError, zipfile.BadZipFile) as exc:
        raise AccountPoolError("workbook cannot be read") from exc


def _check_private_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "posix":
        os.chmod(path.parent, stat.S_IRWXU)


def write_manifest(accounts: list[dict[str, str | int]], output: str | Path, *, key: str | None = None) -> Path:
    """Write an owner-private encrypted-at-rest manifest.

    The deployment supplies a platform secret. Without ``key`` the command
    refuses to write, preventing accidental plaintext credential files.
    """
    if not key:
        raise AccountPoolError("a deployment encryption key is required")
    if AESGCM is None and _CryptoAES is None:
        raise AccountPoolError("an AES-GCM crypto provider is required for private credential encryption")
    destination = Path(output)
    if not destination.is_absolute() or destination.exists() and destination.is_symlink():
        raise AccountPoolError("manifest path must be an absolute regular path")
    _check_private_parent(destination)
    payload = json.dumps({"version": 1, "accounts": accounts}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    key_bytes = hashlib.sha256(key.encode("utf-8")).digest()
    nonce = secrets.token_bytes(12)
    if AESGCM is not None:
        ciphertext = AESGCM(key_bytes).encrypt(nonce, payload, _AAD)
    else:
        cipher = _CryptoAES.new(key_bytes, _CryptoAES.MODE_GCM, nonce=nonce)
        cipher.update(_AAD)
        ciphertext, tag = cipher.encrypt_and_digest(payload)
        ciphertext += tag
    document = json.dumps({"version": 1, "algorithm": "AES-256-GCM", "nonce": base64.b64encode(nonce).decode("ascii"), "payload": base64.b64encode(ciphertext).decode("ascii")}, separators=(",", ":")).encode("ascii")
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".killboard-account-pool-", dir=str(destination.parent))
        with os.fdopen(fd, "wb") as stream_file:
            if os.name == "posix":
                os.fchmod(stream_file.fileno(), stat.S_IRUSR | stat.S_IWUSR)
            stream_file.write(document)
            stream_file.flush()
            os.fsync(stream_file.fileno())
        os.replace(temporary, destination)
        temporary = None
        if os.name == "posix":
            os.chmod(destination, stat.S_IRUSR | stat.S_IWUSR)
        return destination
    finally:
        if temporary:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def read_manifest(path: str | Path, *, key: str | None = None) -> list[dict[str, str | int]]:
    """Decrypt and validate an account manifest without logging credentials."""
    if not key:
        raise AccountPoolError("a deployment encryption key is required")
    source = Path(path)
    if not source.is_absolute() or not source.is_file() or source.is_symlink():
        raise AccountPoolError("manifest path must be an absolute regular path")
    try:
        document = json.loads(source.read_text(encoding='ascii'))
        if document.get('version') != 1 or document.get('algorithm') != 'AES-256-GCM':
            raise AccountPoolError("unsupported account manifest")
        nonce = base64.b64decode(document['nonce'], validate=True)
        ciphertext = base64.b64decode(document['payload'], validate=True)
        if len(nonce) != 12 or len(ciphertext) < 16:
            raise AccountPoolError("account manifest is malformed")
        key_bytes = hashlib.sha256(key.encode('utf-8')).digest()
        if AESGCM is not None:
            payload = AESGCM(key_bytes).decrypt(nonce, ciphertext, _AAD)
        elif _CryptoAES is not None:
            if len(ciphertext) < 16:
                raise AccountPoolError("account manifest is malformed")
            cipher = _CryptoAES.new(key_bytes, _CryptoAES.MODE_GCM, nonce=nonce)
            cipher.update(_AAD)
            payload = cipher.decrypt_and_verify(ciphertext[:-16], ciphertext[-16:])
        else:  # pragma: no cover - guarded by write_manifest
            raise AccountPoolError("an AES-GCM crypto provider is required")
        body = json.loads(payload.decode('utf-8'))
        accounts = body.get('accounts') if body.get('version') == 1 else None
        if not isinstance(accounts, list) or not accounts or len(accounts) > MAX_POOL_SIZE:
            raise AccountPoolError("account manifest has an invalid account list")
        for account in accounts:
            if not isinstance(account, dict) or not isinstance(account.get('email'), str) or not isinstance(account.get('password'), str):
                raise AccountPoolError("account manifest contains an invalid account")
        return accounts
    except AccountPoolError:
        raise
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, json.JSONDecodeError, InvalidTag):
        raise AccountPoolError("account manifest cannot be decrypted") from None


def main() -> int:
    parser = argparse.ArgumentParser(description="Import rows 200–400 into a private Killboard account pool.")
    parser.add_argument("workbook")
    parser.add_argument("output")
    parser.add_argument("--first-row", type=int, default=200)
    parser.add_argument("--last-row", type=int, default=400)
    args = parser.parse_args()
    accounts = read_accounts(args.workbook, first_row=args.first_row, last_row=args.last_row)
    key = os.environ.get("KILLBOARD_ACCOUNT_POOL_KEY") or getpass.getpass("Killboard account pool key: ")
    write_manifest(accounts, args.output, key=key)
    print(f"Imported {len(accounts)} accounts into the private pool.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
