from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from Authentication.throttle import DailyThrottle, MinuteThrottle
from PlanetaryResource.views import PlResourcePriceList


class PlanetaryThrottleTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    def test_email_throttle_skips_list_payloads(self):
        request = self.factory.post(
            '/api/planetresourceprice',
            [{'resource_name': '光泽合金', 'resource_price': 1500}],
            format='json',
        )

        self.assertIsNone(DailyThrottle().get_cache_key(request, None))
        self.assertIsNone(MinuteThrottle().get_cache_key(request, None))


class PlanetaryPriceSaveTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.user = SimpleNamespace(id=1, username='atlas123', is_authenticated=True)

    @patch('PlanetaryResource.views.UserPrePrice.objects.update_or_create')
    def test_price_save_accepts_wrapped_price_list(self, update_or_create_mock):
        payload = {
            'prePriceElement': [
                {
                    'resource_name': '光泽合金',
                    'resource_type': '船菜',
                    'resource_price': 1500,
                }
            ]
        }
        request = self.factory.post('/api/planetresourceprice', payload, format='json')
        force_authenticate(request, user=self.user)

        response = PlResourcePriceList.as_view()(request)

        self.assertEqual(response.status_code, 200)
        update_or_create_mock.assert_called_once()
        kwargs = update_or_create_mock.call_args.kwargs
        self.assertEqual(kwargs['user_id'], 1)
        self.assertEqual(kwargs['defaults']['user_name'], 'atlas123')
        self.assertEqual(kwargs['defaults']['pre_price_element'], payload['prePriceElement'])
        self.assertIsNotNone(kwargs['defaults']['last_update'])
