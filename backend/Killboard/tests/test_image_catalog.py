from django.test import SimpleTestCase

from Killboard.image_catalog import image_metadata, image_url


class KillboardImageCatalogTests(SimpleTestCase):
    def test_exact_ship_ids_resolve_to_content_addressed_urls(self):
        for type_id in (10706000201, 10607001409, 10500000601, 10500011101):
            url = image_url(type_id)
            self.assertRegex(url, r"^/images/game-items/[0-9a-f]{64}\.png$")

    def test_unknown_and_malformed_ids_do_not_get_guessed_images(self):
        for type_id in (None, "", "../1", 0, -1, 99999999999):
            self.assertEqual(image_url(type_id), "")
        self.assertIsNone(image_metadata(99999999999))

    def test_special_roles_are_preserved_in_metadata(self):
        metadata = image_metadata(10706000201)
        self.assertEqual(metadata["imageRole"], "item-icon")
        self.assertTrue(metadata["path"].startswith("/images/game-items/"))
