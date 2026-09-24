#!/usr/bin/env python3
"""Version a disposable fixture to verify the renamed Rust release package."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent


class VersionBumpTests(unittest.TestCase):
    def test_version_bump_updates_aven_without_changing_compatibility_identity(self):
        with tempfile.TemporaryDirectory(prefix='aven-version-test-') as folder:
            fixture = Path(folder)
            for relative in ('scripts/bump-version.mjs', 'package.json', 'package-lock.json',
                             'Cargo.toml', 'Cargo.lock', 'src-tauri/tauri.conf.json'):
                target = fixture / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, target)
            version = '99.88.77'
            subprocess.run(['node', str(fixture / 'scripts/bump-version.mjs'), version],
                           cwd=fixture, check=True, capture_output=True, text=True)
            self.assertEqual(json.loads((fixture / 'package.json').read_text())['version'], version)
            lock = json.loads((fixture / 'package-lock.json').read_text())
            self.assertEqual(lock['version'], version)
            self.assertEqual(lock['packages']['']['version'], version)
            config = json.loads((fixture / 'src-tauri/tauri.conf.json').read_text())
            self.assertEqual(config['version'], version)
            self.assertEqual(config['mainBinaryName'], 'aven')
            self.assertEqual(config['identifier'], 'com.capi.monocode.personal')
            self.assertRegex((fixture / 'Cargo.toml').read_text(),
                             r'(?m)^version = "' + re.escape(version) + '"$')
            self.assertRegex((fixture / 'Cargo.lock').read_text(),
                             r'name = "aven"\nversion = "' + re.escape(version) + '"')


if __name__ == '__main__':
    unittest.main()
