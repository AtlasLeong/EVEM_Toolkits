from django.test import SimpleTestCase

from .A_Star import Galaxy, a_star


class TacticalBoardPathTests(SimpleTestCase):
    def setUp(self):
        self.start = Galaxy(1, "起点", 0, 0, 0, 0.6)
        self.gateway = Galaxy(2, "门链点", 9.461e15 * 20, 0, 0, 0.6)
        self.goal = Galaxy(3, "终点", 9.461e15 * 23, 0, 0, 0.6)
        self.galaxies = [self.start, self.gateway, self.goal]
        self.stargates = {
            1: {2},
            2: {1},
        }

    def test_dict_road_enabled_allows_gate_then_induction(self):
        path = a_star(
            self.start,
            self.goal,
            5,
            self.galaxies,
            True,
            self.stargates,
        )

        self.assertIsNotNone(path)
        self.assertEqual([item[0].zh_name for item in path], ["起点", "门链点", "终点"])
        self.assertEqual(path[1][1], "土路")
        self.assertEqual(path[2][1], "安全诱导")

    def test_dict_road_disabled_blocks_gate_only_route(self):
        path = a_star(
            self.start,
            self.goal,
            5,
            self.galaxies,
            False,
            self.stargates,
        )

        self.assertIsNone(path)
