import unittest
from scraper import catalog


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.areas, self.rules = catalog.load_config()
        self.listing = {'omrade': 'Kungshamra', 'typ': '1 rum & kök', 'yta': 18,
                        'adress': 'Kungshamra 75 B / 1001', 'hyra': '7\u00a0200', 'vaning': '3'}

    def enrich(self, **changes):
        return catalog.enrich({**self.listing, **changes}, self.areas, self.rules)

    def test_price_and_floor_do_not_split_type(self):
        self.assertEqual(self.enrich()['archetypeId'], self.enrich(hyra='8 000', vaning='4')['archetypeId'])
        self.assertEqual(self.enrich()['rentNum'], 7200)

    def test_geography_and_named_type(self):
        result = self.enrich()
        self.assertEqual(result['district'], 'Bergshamra')
        self.assertEqual(result['municipality'], 'Solna')
        self.assertTrue(result['curated'])
        self.assertNotEqual(result['archetypeId'], self.enrich(yta=23, typ='1 rum & pentry')['archetypeId'])

    def test_limited_contracts_are_separate(self):
        normal = self.enrich()
        limited = self.enrich(publiceringstexter='<p>Du kan bo max 4 år. Avstående från besittningsskydd.</p>')
        self.assertNotEqual(normal['archetypeId'], limited['archetypeId'])
        self.assertEqual(limited['contractType'], 'limited')
        self.assertIn('bo max 4 år', limited['contractNote'])
        self.assertNotIn('<p>', limited['contractNote'])

    def test_floor_names_and_missing_floor(self):
        self.assertEqual(catalog.floor('Bottenvåning'), (0, 'ground'))
        self.assertEqual(catalog.floor('Sutterängvåning'), (-1, 'basement'))
        self.assertEqual(catalog.floor('4'), (4, 'number'))
        self.assertEqual(catalog.floor(0), (0, 'ground'))
        self.assertEqual(catalog.floor(None), (None, 'unknown'))

    def test_manual_rules_can_group_sizes_or_limit_buildings(self):
        rule = {'id': 'custom', 'area': 'Kungshamra', 'sizes': [18, 19], 'addresses': ['Kungshamra 75 B'], 'name': 'Testtyp'}
        a = catalog.enrich(self.listing, self.areas, [rule])
        b = catalog.enrich({**self.listing, 'yta': 19}, self.areas, [rule])
        c = catalog.enrich({**self.listing, 'adress': 'Kungshamra 77 / 1001'}, self.areas, [rule])
        self.assertEqual(a['archetypeId'], b['archetypeId'])
        self.assertNotEqual(a['archetypeId'], c['archetypeId'])

    def test_unknown_areas_and_types_stay_in_catalog(self):
        result = self.enrich(omrade='Nytt område', typ='Ny typ', vaning=None)
        self.assertEqual(result['district'], 'Nytt område')
        self.assertFalse(result['curated'])
        self.assertEqual(result['archetypeName'], 'Ny typ')
