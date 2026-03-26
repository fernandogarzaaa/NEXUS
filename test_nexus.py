import unittest
from run_kpmg_nexus import DLPScanner

class TestDLPScanner(unittest.TestCase):
    def setUp(self):
        self.scanner = DLPScanner()

    def test_redaction(self):
        raw = "My email is test@example.com and card is 4532-1234-5678-9012"
        is_sensitive, flags, redacted = self.scanner.scan_and_redact(raw)
        self.assertTrue(is_sensitive)
        self.assertIn("EMAIL", flags)
        self.assertIn("CREDIT_CARD", flags)
        self.assertNotIn("test@example.com", redacted)
        self.assertNotIn("4532-1234-5678-9012", redacted)

    def test_no_pii(self):
        raw = "Hello world, this is a clean string."
        is_sensitive, flags, redacted = self.scanner.scan_and_redact(raw)
        self.assertFalse(is_sensitive)
        self.assertEqual(raw, redacted)

if __name__ == "__main__":
    unittest.main()
