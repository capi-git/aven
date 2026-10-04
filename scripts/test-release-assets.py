#!/usr/bin/env python3
"""Unit tests for the release feed merge and stable download names.

Uses disposable fixtures only; no signing key, build, or network access.
"""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'scripts/release-assets.py'
spec = importlib.util.spec_from_file_location('release_assets', SCRIPT)
release_assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_assets)

VERSION = '1.2.3'
INSTALLER = 'Aven_1.2.3_x64-setup.exe'
URL_BASE = 'https://github.com/capi-git/aven/releases/download/v1.2.3'
MAC = {'signature': 'mac-fixture', 'url': URL_BASE + '/Aven-1.2.3-macos-arm64.app.tar.gz'}


def signature(name, comment=None):
    trusted = comment if comment is not None else 'timestamp:1700000000\tfile:' + name
    text = ('untrusted comment: signature from tauri secret key\nRUQfixture\n'
            'trusted comment: ' + trusted + '\nfixture\n')
    return base64.b64encode(text.encode()).decode()


class ReleaseFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='aven-release-assets-test-')
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.manifest = {'version': VERSION, 'notes': 'Fixture', 'pub_date': '2026-01-01T00:00:00Z',
                         'platforms': {'darwin-aarch64': dict(MAC)}}
        (self.folder / 'latest.json').write_text(json.dumps(self.manifest, indent=2) + '\n')
        (self.folder / ('Aven-' + VERSION + '-macos-arm64.zip')).write_bytes(b'mac fixture')
        (self.folder / INSTALLER).write_bytes(b'MZ installer fixture')
        (self.folder / (INSTALLER + '.sig')).write_text(signature(INSTALLER) + '\n')
        self.write_sums()

    def write_sums(self):
        lines = [hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name
                 for path in sorted(self.folder.iterdir()) if path.name != 'SHA256SUMS']
        (self.folder / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')

    def sums(self):
        entries = {}
        for line in (self.folder / 'SHA256SUMS').read_text().splitlines():
            digest, name = line.split('  ', 1)
            self.assertNotIn(name, entries)
            entries[name] = digest
        return entries

    def assert_sums_match(self):
        for name, digest in self.sums().items():
            self.assertEqual(hashlib.sha256((self.folder / name).read_bytes()).hexdigest(), digest, name)

    def refused(self, message, call):
        with self.assertRaises(SystemExit) as raised:
            call()
        self.assertIn(message, str(raised.exception))


class WindowsFeedTests(ReleaseFixture):
    def add(self, **overrides):
        options = {'version': VERSION, 'installer': INSTALLER, 'url_base': URL_BASE, **overrides}
        release_assets.add_windows_update(self.folder, options['version'], options['installer'], options['url_base'])

    def test_adds_both_updater_platform_keys_for_the_same_installer(self):
        self.add()
        manifest = json.loads((self.folder / 'latest.json').read_text())
        entry = {'signature': signature(INSTALLER), 'url': URL_BASE + '/' + INSTALLER}
        self.assertEqual(manifest['platforms'], {
            'darwin-aarch64': MAC,
            'windows-x86_64-nsis': entry,
            'windows-x86_64': entry,
        })
        for key in ('version', 'notes', 'pub_date'):
            self.assertEqual(manifest[key], self.manifest[key])
        self.assert_sums_match()
        self.assertEqual(list(self.sums()).count('latest.json'), 1)

    def test_refuses_a_feed_that_is_not_exactly_this_macos_release(self):
        for manifest in (
            {**self.manifest, 'version': '1.2.2'},
            {**self.manifest, 'platforms': {}},
            {**self.manifest, 'platforms': ['darwin-aarch64']},
            {**self.manifest, 'platforms': {'darwin-aarch64': MAC, 'windows-x86_64': MAC}},
        ):
            with self.subTest(manifest=manifest):
                (self.folder / 'latest.json').write_text(json.dumps(manifest))
                self.refused('latest.json must describe only this macOS release', self.add)

    def test_refuses_missing_foreign_or_malformed_signatures(self):
        sig = self.folder / (INSTALLER + '.sig')
        sig.unlink()
        self.refused('signature is missing', self.add)
        for text, message in (
            ('not base64!', 'not a Tauri signature'),
            (signature('Aven_1.2.2_x64-setup.exe'), 'does not belong'),
            (signature(INSTALLER, 'timestamp:1\tfile:other/' + INSTALLER), 'does not belong'),
            (signature(INSTALLER, 'timestamp:1\tfile:' + INSTALLER + '.old'), 'does not belong'),
        ):
            with self.subTest(text=text):
                sig.write_text(text)
                self.refused(message, self.add)
        self.assertEqual(json.loads((self.folder / 'latest.json').read_text()), self.manifest)

    def test_refuses_unexpected_installer_version_name_or_url(self):
        self.refused('unexpected Windows installer name', lambda: self.add(installer='Aven_1.2.2_x64-setup.exe'))
        self.refused('unexpected Windows installer name', lambda: self.add(installer='../' + INSTALLER))
        self.refused('unexpected Windows installer name', lambda: self.add(installer='Aven_1.2.3_arm64-setup.exe'))
        self.refused('https without a trailing slash', lambda: self.add(url_base='http://example.invalid'))
        self.refused('https without a trailing slash', lambda: self.add(url_base=URL_BASE + '/'))
        (self.folder / INSTALLER).unlink()
        self.refused('installer is not in the release directory', self.add)


class StableAliasTests(ReleaseFixture):
    def test_copies_main_downloads_to_stable_names_with_checksums(self):
        release_assets.add_stable_aliases(self.folder, VERSION, INSTALLER)
        for alias, source in (('Aven-macos-arm64.zip', 'Aven-1.2.3-macos-arm64.zip'),
                              ('Aven-windows-x64-setup.exe', INSTALLER)):
            with self.subTest(alias=alias):
                path = self.folder / alias
                self.assertFalse(path.is_symlink())
                self.assertEqual(path.read_bytes(), (self.folder / source).read_bytes())
                self.assertEqual(self.sums()[alias], self.sums()[source])
        self.assert_sums_match()

    def test_macos_only_release_gets_only_the_macos_name(self):
        release_assets.add_stable_aliases(self.folder, VERSION)
        self.assertTrue((self.folder / 'Aven-macos-arm64.zip').is_file())
        self.assertFalse((self.folder / 'Aven-windows-x64-setup.exe').exists())
        self.assertNotIn('Aven-windows-x64-setup.exe', self.sums())
        self.assert_sums_match()

    def test_stable_names_do_not_change_versioned_assets(self):
        before = {path.name: path.read_bytes() for path in self.folder.iterdir() if path.name != 'SHA256SUMS'}
        release_assets.add_stable_aliases(self.folder, VERSION, INSTALLER)
        for name, contents in before.items():
            self.assertEqual((self.folder / name).read_bytes(), contents, name)

    def test_refuses_missing_sources_or_an_existing_alias(self):
        (self.folder / 'Aven-macos-arm64.zip').write_bytes(b'stale')
        self.refused('already exists', lambda: release_assets.add_stable_aliases(self.folder, VERSION))
        (self.folder / 'Aven-macos-arm64.zip').unlink()
        self.refused('missing download', lambda: release_assets.add_stable_aliases(self.folder, VERSION, 'Aven_1.2.3_x64-missing.exe'))
        (self.folder / 'Aven-1.2.3-macos-arm64.zip').unlink()
        self.refused('missing download', lambda: release_assets.add_stable_aliases(self.folder, VERSION))

    def test_command_line_runs_both_steps(self):
        for arguments in (
            ['add-windows-update', '--release-dir', str(self.folder), '--version', VERSION,
             '--installer', INSTALLER, '--url-base', URL_BASE],
            ['add-stable-aliases', '--release-dir', str(self.folder), '--version', VERSION,
             '--windows-installer', INSTALLER],
        ):
            result = subprocess.run([sys.executable, '-B', str(SCRIPT), *arguments],
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('windows-x86_64', json.loads((self.folder / 'latest.json').read_text())['platforms'])
        self.assert_sums_match()


class ChecksumTests(ReleaseFixture):
    def test_refresh_replaces_only_named_entries_and_rejects_bad_lines(self):
        before = self.sums()
        (self.folder / 'latest.json').write_text('{}\n')
        release_assets.refresh_checksums(self.folder, ['latest.json'])
        after = self.sums()
        self.assertNotEqual(after['latest.json'], before['latest.json'])
        self.assertEqual({k: v for k, v in after.items() if k != 'latest.json'},
                         {k: v for k, v in before.items() if k != 'latest.json'})
        (self.folder / 'SHA256SUMS').write_text('nonsense\n')
        self.refused('invalid release checksum entry',
                     lambda: release_assets.refresh_checksums(self.folder, ['latest.json']))


if __name__ == '__main__':
    unittest.main()
