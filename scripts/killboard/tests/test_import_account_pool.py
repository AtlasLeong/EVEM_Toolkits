import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

from scripts.killboard import import_account_pool as account_pool
from scripts.killboard.import_account_pool import AccountPoolError, read_accounts, read_manifest, write_manifest


def workbook(path: Path, rows: list[tuple[int, str, str]], *, inline_strings=False,
             absolute_relationship=False, xml_padding=0, extra_parts=None) -> None:
    shared = []
    for _, email, password in rows:
        shared.extend((email, password))
    shared_xml = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + ''.join(f'<si><t>{value}</t></si>' for value in shared) + '</sst>'
    row_xml = []
    for row, email, password in rows:
        if inline_strings:
            # Include rich-text runs, as well as the plain inline string form.
            row_xml.append(f'<row r="{row}"><c r="B{row}" t="inlineStr"><is><t>{email}</t></is></c>'
                           f'<c r="C{row}" t="inlineStr"><is><r><t>{password[:1]}</t></r><r><t>{password[1:]}</t></r></is></c></row>')
        else:
            first = shared.index(email)
            second = shared.index(password)
            row_xml.append(f'<row r="{row}"><c r="B{row}" t="s"><v>{first}</v></c><c r="C{row}" t="s"><v>{second}</v></c></row>')
    sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + ' ' * xml_padding + '<sheetData>' + ''.join(row_xml) + '</sheetData></worksheet>'
    wb = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    target = '/xl/worksheets/sheet1.xml' if absolute_relationship else 'worksheets/sheet1.xml'
    rel = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="{target}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>'
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        if not inline_strings:
            archive.writestr('xl/sharedStrings.xml', shared_xml)
        archive.writestr('xl/worksheets/sheet1.xml', sheet)
        archive.writestr('xl/workbook.xml', wb)
        archive.writestr('xl/_rels/workbook.xml.rels', rel)
        for name, value in (extra_parts or {}).items():
            archive.writestr(name, value)


class AccountPoolTests(unittest.TestCase):
    def test_reads_exact_rows_without_requiring_header(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'accounts.xlsx'
            workbook(source, [(200, 'one@example.test', 'a'), (201, 'two@example.test', 'b')])
            self.assertEqual(read_accounts(source, first_row=200, last_row=201), [
                {'row': 200, 'email': 'one@example.test', 'password': 'a'},
                {'row': 201, 'email': 'two@example.test', 'password': 'b'},
            ])

    def test_missing_row_and_duplicate_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'accounts.xlsx'
            workbook(source, [(200, 'one@example.test', 'a')])
            with self.assertRaises(AccountPoolError):
                read_accounts(source, first_row=200, last_row=201)
            workbook(source, [(200, 'one@example.test', 'a'), (201, 'ONE@example.test', 'b')])
            with self.assertRaises(AccountPoolError):
                read_accounts(source, first_row=200, last_row=201)

    def test_duplicate_row_cannot_replace_a_missing_selected_row(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'duplicate-row.xlsx'
            workbook(source, [(200, 'one@example.test', 'a'), (200, 'two@example.test', 'b')])
            with self.assertRaisesRegex(AccountPoolError, 'duplicate account row'):
                read_accounts(source, first_row=200, last_row=201)

    def test_default_range_contains_every_row_200_through_400_only(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'default-range.xlsx'
            accounts = [(row, f'synthetic-{row}@example.test', f'synthetic-{row}') for row in range(200, 401)]
            workbook(source, [(199, 'before@example.test', 'before'), *reversed(accounts),
                              (401, 'after@example.test', 'after')])
            result = read_accounts(source)
            self.assertEqual(len(result), 201)
            self.assertEqual({account['row'] for account in result}, set(range(200, 401)))

    def test_shared_string_indexes_must_be_in_bounds_and_nonnegative(self):
        namespace = '{' + account_pool.NS['m'] + '}'
        for index in ('-1', '-2', '2', 'invalid', '1.0'):
            with self.subTest(index=index):
                cell = account_pool.ET.Element(namespace + 'c', {'t': 's'})
                account_pool.ET.SubElement(cell, namespace + 'v').text = index
                with self.assertRaisesRegex(AccountPoolError, 'shared string is invalid'):
                    account_pool._cell_value(cell, ['first-synthetic-value', 'last-synthetic-value'])

    def test_inline_plain_and_rich_strings_are_read_without_shared_strings(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'inline-accounts.xlsx'
            workbook(source, [(200, 'synthetic@example.test', 'synthetic-secret')], inline_strings=True)
            self.assertEqual(read_accounts(source, first_row=200, last_row=200), [
                {'row': 200, 'email': 'synthetic@example.test', 'password': 'synthetic-secret'},
            ])

    def test_package_absolute_sheet_relationship_is_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'absolute-sheet.xlsx'
            workbook(source, [(200, 'synthetic@example.test', 'synthetic-secret')],
                     absolute_relationship=True)
            self.assertEqual(len(read_accounts(source, first_row=200, last_row=200)), 1)

    def test_total_uncompressed_size_is_bounded_before_xml_parsing(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'compressed-accounts.xlsx'
            workbook(source, [(200, 'synthetic@example.test', 'synthetic-secret')],
                     extra_parts={'xl/unused.bin': b'0' * 16384})
            self.assertLess(source.stat().st_size, 8192)
            with patch.object(account_pool, 'MAX_WORKBOOK_UNCOMPRESSED_BYTES', 8192, create=True):
                with patch.object(account_pool.ET, 'fromstring', wraps=account_pool.ET.fromstring) as parse_xml:
                    with self.assertRaisesRegex(AccountPoolError, 'uncompressed'):
                        read_accounts(source, first_row=200, last_row=200)
                    parse_xml.assert_not_called()

    def test_one_xml_part_cannot_exceed_its_uncompressed_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'oversized-sheet.xlsx'
            workbook(source, [(200, 'synthetic@example.test', 'synthetic-secret')], xml_padding=2048)
            with patch.object(account_pool, 'MAX_XML_PART_BYTES', 1024, create=True):
                with self.assertRaisesRegex(AccountPoolError, 'XML part'):
                    read_accounts(source, first_row=200, last_row=200)

    def test_uncompressed_size_limits_are_inclusive(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'exact-size.xlsx'
            workbook(source, [(200, 'synthetic@example.test', 'synthetic-secret')])
            with zipfile.ZipFile(source) as archive:
                total_bytes = sum(part.file_size for part in archive.infolist())
                largest_xml = max(part.file_size for part in archive.infolist())
            with patch.object(account_pool, 'MAX_WORKBOOK_UNCOMPRESSED_BYTES', total_bytes, create=True), \
                    patch.object(account_pool, 'MAX_XML_PART_BYTES', largest_xml, create=True):
                self.assertEqual(len(read_accounts(source, first_row=200, last_row=200)), 1)

    def test_actual_xml_bytes_are_bounded_even_when_declared_size_is_small(self):
        archive = SimpleNamespace(
            getinfo=lambda name: SimpleNamespace(file_size=1),
            open=lambda name: io.BytesIO(b'<worksheet>' + b' ' * 2048 + b'</worksheet>'),
        )
        with patch.object(account_pool, 'MAX_XML_PART_BYTES', 1024):
            with patch.object(account_pool.ET, 'fromstring', wraps=account_pool.ET.fromstring) as parse_xml:
                with self.assertRaisesRegex(AccountPoolError, 'XML part'):
                    account_pool._read_xml(archive, 'xl/worksheets/sheet1.xml')
                parse_xml.assert_not_called()

    def test_manifest_requires_key_and_does_not_include_plaintext(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'pool.json'
            accounts = [{'row': 200, 'email': 'one@example.test', 'password': 'a'}]
            with self.assertRaises(AccountPoolError):
                write_manifest(accounts, target)
            write_manifest(accounts, target, key='test-key')
            document = json.loads(target.read_text())
            self.assertEqual(document['algorithm'], 'AES-256-GCM')
            self.assertNotIn('one@example.test', target.read_text())
            self.assertNotIn('password', target.read_text())
            self.assertEqual(read_manifest(target, key='test-key'), accounts)
            with self.assertRaises(AccountPoolError):
                read_manifest(target, key='wrong-key')


if __name__ == '__main__':
    unittest.main()
