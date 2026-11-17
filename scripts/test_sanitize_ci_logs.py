import unittest

from sanitize_ci_logs import redact


class LogTests(unittest.TestCase):
    def test_redacts_credential_formats_and_addresses(self):
        values = [
            'user@example.com', 'eyJabc.eyJdef.signature', 'Bearer opaque-value',
            '"accessToken":"opaque-value"', 'password=opaque-value',
            "api_key: 'opaque-value'", 'Cookie: session=opaque-value',
            'https://user:opaque-value@example.org/path',
            '/callback?code=ok&refresh_token=opaque-value',
        ]
        for value in values:
            with self.subTest(value=value):
                output = redact(value)
                self.assertNotIn('opaque-value', output)
                self.assertNotIn('user@example.com', output)
                self.assertNotIn('eyJabc', output)

    def test_keeps_error_context(self):
        line = 'api | ERROR PrismaClientKnownRequestError P2002 at user.service.ts:120\n'
        self.assertEqual(redact(line), line)
