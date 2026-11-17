import copy
import unittest

from artifacts import COMPONENTS, expected_labels, image_digest, repository, validate_v2


def bundle():
    return {"schemaVersion": 2, "version": "1.8.1", "revision": "a" * 40,
            "images": {name: repository(name) + "@sha256:" + "b" * 64 for name in COMPONENTS},
            "components": {name: {"version": "1.8.0", "revision": "c" * 40, "inputs": "d" * 64} for name in COMPONENTS}}


class ArtifactTests(unittest.TestCase):
    def test_unchanged_component_keeps_its_exact_own_identity(self):
        value = bundle()
        self.assertEqual(validate_v2(value), value)
        self.assertEqual(expected_labels(value, "api")["org.opencontainers.image.revision"], "c" * 40)
        self.assertEqual(image_digest(value, "migrator"), "sha256:" + "b" * 64)

    def test_missing_foreign_mutable_or_unbound_metadata_is_rejected(self):
        for field, replacement in [("image", "ghcr.io/other/api@sha256:" + "b" * 64),
                                   ("image", "openathlete-api:e2e"), ("inputs", ""),
                                   ("revision", "main"), ("version", "1.9.0")]:
            value = copy.deepcopy(bundle())
            if field == "image":
                value["images"]["api"] = replacement
            else:
                value["components"]["api"][field] = replacement
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_v2(value)
        value = bundle()
        del value["images"]["migrator"]
        with self.assertRaises(ValueError):
            validate_v2(value)
