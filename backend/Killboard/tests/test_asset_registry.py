from django.test import SimpleTestCase


class AssetRegistryTests(SimpleTestCase):
    def test_compatibility_provenance_uses_shared_client_evidence(self):
        from Killboard.asset_registry import item_provenance, item_record
        self.assertEqual(item_record(10000000000)['name'], '太空舱')
        evidence = item_provenance(10000000000)
        self.assertIn('THX', evidence['source']['extraction_method'])
        self.assertTrue(evidence['asset']['logical_path'].startswith('gui_v1/'))
        self.assertEqual(len(evidence['asset']['png_sha256']), 64)
