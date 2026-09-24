#!/usr/bin/env python3
"""Verify updater executable identity and relative aliases without signing."""
import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location('aven_update_packager', Path(__file__).with_name('package-update.py'))
packager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packager)


class UpdateIdentityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='aven-update-identity-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.app = self.root / 'Aven.app'
        self.macos = self.app / 'Contents/MacOS'
        self.macos.mkdir(parents=True)
        (self.macos / 'aven').write_bytes(b'fixture executable; never executed')
        (self.macos / 'monocode').symlink_to('aven')
        self.info = {'CFBundleExecutable': 'aven'}

    def test_updater_archive_keeps_legacy_alias_as_a_relative_symlink(self):
        packager.verify_executable_identity(self.app, self.info)
        archive = self.root / 'Aven.app.tar.gz'
        with tarfile.open(archive, 'w:gz', dereference=False) as tar:
            tar.add(self.app, arcname='Aven.app')
        with tarfile.open(archive) as tar:
            alias = tar.getmember('Aven.app/Contents/MacOS/monocode')
            self.assertTrue(alias.issym())
            self.assertEqual(alias.linkname, 'aven')
            self.assertTrue(tar.getmember('Aven.app/Contents/MacOS/aven').isfile())

    def test_rejects_old_main_executable_and_missing_or_escaping_alias(self):
        with self.assertRaisesRegex(SystemExit, 'Expected the Aven executable'):
            packager.verify_executable_identity(self.app, {'CFBundleExecutable': 'monocode'})
        alias = self.macos / 'monocode'
        alias.unlink()
        with self.assertRaisesRegex(SystemExit, 'relative monocode compatibility alias'):
            packager.verify_executable_identity(self.app, self.info)
        outside = self.root / 'unrelated-executable'
        outside.write_text('preserved')
        alias.symlink_to(outside)
        with self.assertRaisesRegex(SystemExit, 'relative monocode compatibility alias'):
            packager.verify_executable_identity(self.app, self.info)
        self.assertEqual(outside.read_text(), 'preserved')


if __name__ == '__main__':
    unittest.main()
