"""Local, digest-checked resource access; no client code or network execution."""
from __future__ import annotations

import hashlib
import io
import math
from pathlib import Path
import re
import struct

from PIL import Image

MAX_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 4096 * 4096


def unwrap_layers(data, max_bytes=MAX_BYTES):
    """Decode only reviewed wrappers, with output bounds before allocation."""
    import zlib
    import zstandard
    for _ in range(8):
        if len(data) > max_bytes:
            raise ValueError('decompression size limit exceeded')
        if data.startswith(b'ENON'):
            data = data[4:]
        elif data.startswith(b'DTSZ\x28\xb5\x2f\xfd'):
            size = zstandard.frame_content_size(data[4:])
            if not 0 <= size <= max_bytes:
                raise ValueError('zstd size limit exceeded')
            data = zstandard.ZstdDecompressor().decompress(data[4:], max_output_size=max_bytes)
            if len(data) != size:
                raise ValueError('zstd declared size mismatch')
        elif data[:2] in (b'\x78\x01', b'\x78\x9c', b'\x78\xda'):
            d = zlib.decompressobj()
            decoded = d.decompress(data, max_bytes + 1)
            if len(decoded) > max_bytes or d.unconsumed_tail:
                raise ValueError('zlib size limit exceeded')
            if not d.eof or d.unused_data:
                raise ValueError('incomplete or trailing zlib stream')
            data = decoded
        else:
            return data
    raise ValueError('too many resource wrapper layers')


def verify_resource(data, digest, expected_size=None):
    if len(data) > MAX_BYTES:
        raise ValueError('resource exceeds bounded size')
    if expected_size is not None and len(data) != expected_size:
        raise ValueError(f'resource size mismatch: {len(data)} != {expected_size}')
    if hashlib.md5(data).hexdigest() != digest:
        raise ValueError('resource digest mismatch')
    return data


class ResourceStore:
    def __init__(self, root, *, apk_root=None, decoder_file=None):
        self.root = Path(root).resolve()
        self.entries = {}
        current = self.root
        base = Path(apk_root).resolve() if apk_root else self.root / 'runtime/apk_extract/assets/res'
        self.locations = [current]
        if base.is_dir():
            self.locations.append(base)
        elif apk_root is not None:
            raise FileNotFoundError(f'Explicit APK resource root is missing: {base}')
        self.decoder_file = Path(decoder_file).resolve() if decoder_file else self.root / 'tool-probe-20260929/decryption.py'
        for location in self.locations:
            path = location / 'inroot.idx'
            raw = path.read_bytes()
            if raw[:4] != b'SKPW':
                raise ValueError('invalid IDX magic')
            n = struct.unpack_from('<I', raw, 12)[0]
            # Both reviewed snapshots carry a four-byte trailer after records.
            if len(raw) not in (32 + 36 * n, 36 + 36 * n):
                raise ValueError('invalid IDX record size')
            for i in range(n):
                record = raw[32 + 36*i:68 + 36*i]
                digest = record[:16].hex()
                package, offset, size = struct.unpack_from('<III', record, 20)
                header = struct.unpack_from('<H', record, 32)[0]
                if header != 48:
                    continue
                if package in (255, 511):
                    file = location / 'inroot' / digest
                elif package <= 6:
                    file = location / f'inroot{package}.wpk'
                    if location == current and package >= 2 and not file.is_file():
                        file = current / 'raw-packages' / file.name
                else:
                    continue  # Do not truncate full slot/package identifier.
                self.entries.setdefault(digest, []).append((file, offset, size, header))
        self.decoder = None

    def read(self, digest, expected_size=None):
        if not re.fullmatch('[0-9a-f]{32}', digest):
            raise ValueError('invalid digest')
        failures = []
        for file, offset, size, header in self.entries.get(digest, []):
            if not file.is_file():
                continue
            try:
                if size > MAX_BYTES:
                    raise ValueError('wrapped resource too large')
                with file.open('rb') as f:
                    f.seek(offset)
                    blob = f.read(size + header)
                if len(blob) != size + header or blob[:4] != b'1DPW':
                    raise ValueError('resource header/bounds invalid')
                if blob[8:24].hex() != digest:
                    raise ValueError('resource header digest mismatch')
                if struct.unpack_from('<I', blob, 32)[0] != size or struct.unpack_from('<H', blob, 36)[0] != header:
                    raise ValueError('resource declared size/header mismatch')
                if self.decoder is None:
                    from .decoder import load_decoder
                    self.decoder = load_decoder(self.decoder_file)
                if blob[header:header+4] != b'AC\x01\x00':
                    raise ValueError('unsupported resource wrapper')
                result = self.decoder.decode_payload_stage1(blob[header:])
                if result is None:
                    raise ValueError('unsupported stage-1 resource')
                data, _ = result
                data = unwrap_layers(data)
                verify_resource(data, digest, expected_size)
                return data, str(file)
            except (ValueError, OSError, AssertionError) as exc:
                failures.append(str(exc))
        if failures:
            raise ValueError('; '.join(failures))
        raise FileNotFoundError(f'No local resource for {digest}')


def decode_texture(data):
    """Decode a strict single-face KTX ASTC texture or a Pillow image."""
    if not data.startswith(b'\xabKTX 11\xbb\r\n\x1a\n'):
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_PIXELS:
                raise ValueError('image exceeds pixel bounds')
            image.load()
            return image.convert('RGBA')
    if len(data) < 68:
        raise ValueError('truncated KTX header')
    endian, gl_type, type_size, gl_format, internal, base, w, h, depth, arrays, faces, mips, metadata = struct.unpack_from('<13I', data, 12)
    if endian != 0x04030201 or gl_type or gl_format or type_size != 1:
        raise ValueError('unsupported KTX layout')
    if not (0 < w <= 4096 and 0 < h <= 4096 and w*h <= MAX_PIXELS):
        raise ValueError('invalid KTX dimensions')
    if depth or arrays or faces != 1 or not 1 <= mips <= 13:
        raise ValueError('unsupported array/cubemap/mip KTX layout')
    astc_blocks = [(4,4), (5,4), (5,5), (6,5), (6,6), (8,5), (8,6), (8,8), (10,5), (10,6), (10,8), (10,10), (12,10), (12,12)]
    code = internal - (0x93D0 if internal >= 0x93D0 else 0x93B0)
    if not 0 <= code < len(astc_blocks):
        raise ValueError(f'unsupported KTX compression {internal:#x}')
    bw, bh = astc_blocks[code]
    pos = 64 + metadata
    first = None
    for level in range(mips):
        if pos + 4 > len(data):
            raise ValueError('truncated mip size')
        size = struct.unpack_from('<I', data, pos)[0]
        pos += 4
        expected = math.ceil(max(1,w >> level)/bw) * math.ceil(max(1,h >> level)/bh) * 16
        if size != expected or pos + size > len(data):
            raise ValueError('KTX mip length mismatch')
        if level == 0:
            first = data[pos:pos+size]
        pos += size + (-size % 4)
    if pos != len(data):
        raise ValueError('unexpected KTX trailing data')
    import texture2ddecoder
    pixels = texture2ddecoder.decode_astc(first, w, h, bw, bh)
    if len(pixels) != w*h*4:
        raise ValueError('decoded pixel length mismatch')
    return Image.frombytes('RGBA', (w,h), pixels, 'raw', 'BGRA')
