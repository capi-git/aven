#!/usr/bin/env python3
"""Exercise the actual release workflow guards using disposable local fixtures.

No build, real gh call, credentials, Keychain operation, or remote Git access.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / '.github/workflows/release.yml'
WINDOWS_WORKFLOW = ROOT / '.github/workflows/windows-candidate.yml'
VERSION = '1.2.3'
SOURCE_SHA = 'a' * 40


def step_script(name):
    """Extract a named literal run block without adding a YAML dependency."""
    lines = WORKFLOW.read_text().splitlines()
    marker = '- name: ' + name
    start = next(index for index, line in enumerate(lines) if line.strip() == marker)
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if line.strip() == 'run: |':
            indentation = len(line) - len(line.lstrip()) + 2
            script = []
            for nested in lines[index + 1:]:
                if nested.strip() and len(nested) - len(nested.lstrip()) < indentation:
                    break
                script.append(nested[indentation:] if nested.strip() else '')
            return '\n'.join(script) + '\n'
        if line.lstrip().startswith('- name:') or line.lstrip().startswith('- uses:'):
            break
    raise AssertionError('Missing literal run block for ' + name)


class WorkflowFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='aven-release-workflow-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.bin = self.root / 'fixture-bin'
        self.bin.mkdir()
        self.environment = {
            'PATH': str(self.bin) + os.pathsep + os.environ.get('PATH', ''),
            'GITHUB_SHA': SOURCE_SHA,
            'GITHUB_REPOSITORY': 'fixture/never-published',
            'AVEN_EXPECTED_VERSION': '',
            'AVEN_EXPECTED_SOURCE_SHA': '',
            'AVEN_INCLUDE_WINDOWS': 'true',
            'GIT_CONFIG_NOSYSTEM': '1',
            'GIT_CONFIG_GLOBAL': os.devnull,
            'AVEN_TEST_GH_RECORD': str(self.root / 'gh-called.json'),
        }
        (self.root / 'package.json').write_text(json.dumps({'version': VERSION}))
        self.policy = {'teamId': 'L54FM345MU', 'bundleId': 'com.capi.monocode.personal'}
        (self.root / 'scripts').mkdir()
        (self.root / 'scripts/release-signing.json').write_text(json.dumps(self.policy))
        self.release = self.root / 'release' / ('v' + VERSION)
        self.release.mkdir(parents=True)
        (self.release / 'latest.json').write_text(json.dumps({
            'version': VERSION, 'platforms': {'darwin-aarch64': {
                'url': 'https://example.invalid/macos.app.tar.gz', 'signature': 'fixture-only'}}}))
        (self.release / 'signing-verification.json').write_text(json.dumps({
            'status': 'verified', 'mode': 'developer-id', **self.policy,
            'strictSignatureVerification': 'passed'}))
        self.checksums(self.release)

    @staticmethod
    def checksums(folder, crlf=False, omit=()):
        lines = [hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name
                 for path in sorted(folder.iterdir())
                 if path.is_file() and path.name != 'SHA256SUMS' and path.name not in omit]
        (folder / 'SHA256SUMS').write_bytes((('\r\n' if crlf else '\n').join(lines) + ('\r\n' if crlf else '\n')).encode())

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o755)

    def run_step(self, name):
        return subprocess.run(['/bin/bash'], input=step_script(name), cwd=self.root,
                              env=self.environment, text=True, capture_output=True, timeout=30)


class SourceGuardTests(WorkflowFixture):
    def setUp(self):
        super().setUp()
        git = shutil.which('git')
        self.assertIsNotNone(git, 'Git is needed for the local source fixture')
        subprocess.run([git, 'init', '-q', str(self.root)], env=self.environment, check=True)
        subprocess.run([git, 'add', 'package.json'], cwd=self.root, env=self.environment, check=True)
        subprocess.run([git, '-c', 'user.name=Release Fixture', '-c', 'user.email=fixture@example.invalid',
                        'commit', '--no-gpg-sign', '-qm', 'fixture'], cwd=self.root, env=self.environment, check=True)
        self.sha = subprocess.check_output([git, 'rev-parse', 'HEAD'], cwd=self.root,
                                           env=self.environment, text=True).strip()
        self.environment['GITHUB_SHA'] = self.sha

    def test_manual_defaults_and_matching_confirmation_succeed(self):
        for expected in ('', self.sha):
            with self.subTest(expected=expected):
                self.environment['AVEN_EXPECTED_SOURCE_SHA'] = expected
                self.environment['AVEN_EXPECTED_VERSION'] = VERSION if expected else ''
                result = self.run_step('Validate requested release source')
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_changed_version_is_rejected(self):
        self.environment['AVEN_EXPECTED_VERSION'] = '1.2.2'
        result = self.run_step('Validate requested release source')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('version changed since confirmation', result.stderr)

    def test_changed_or_abbreviated_source_is_rejected(self):
        for expected in ('b' * 40, self.sha[:8], 'not-a-commit'):
            with self.subTest(expected=expected):
                self.environment['AVEN_EXPECTED_SOURCE_SHA'] = expected
                result = self.run_step('Validate requested release source')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('source changed since confirmation', result.stderr)

    def test_wrong_workflow_checkout_is_rejected_even_without_optional_inputs(self):
        self.environment['GITHUB_SHA'] = 'b' * 40
        result = self.run_step('Validate requested release source')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('differs from the workflow revision', result.stderr)


class WindowsArtifactTests(WorkflowFixture):
    def setUp(self):
        super().setUp()
        # No Git operation or GitHub client may escape these fixture executables.
        self.executable('git', '#!/bin/sh\n[ "$1" = ls-remote ] || exit 97\nexit 2\n')
        self.executable('gh', '#!' + sys.executable + '\nimport json, os, pathlib, sys\n'
                        'pathlib.Path(os.environ["AVEN_TEST_GH_RECORD"]).write_text(json.dumps(sys.argv[1:]))\n')
        self.executable('node', '#!' + sys.executable + '\nimport json, pathlib\n'
                        'print(json.loads(pathlib.Path("package.json").read_text())["version"])\n')
        if not shutil.which('sha256sum'):
            shasum = shutil.which('shasum')
            self.assertIsNotNone(shasum, 'A system SHA-256 checker is required')
            self.executable('sha256sum', '#!/bin/sh\nexec ' + shlex.quote(shasum) + ' -a 256 "$@"\n')
        self.assertIsNotNone(shutil.which('zip'), 'ZIP is needed to inspect the real packaged artifact')
        # Build the fixture with the producer's actual output directory, so a
        # rename in one workflow cannot silently break its consuming release.
        output = re.search(r'^\s+\$output = "target/releases/(.+)"$',
                           WINDOWS_WORKFLOW.read_text(), re.M)
        self.assertIsNotNone(output, 'Windows package output directory is missing')
        self.windows = self.root / 'windows' / output.group(1).replace('$version', VERSION)

    def create_windows(self, crlf=False):
        self.windows.mkdir(parents=True)
        (self.windows / ('Aven_' + VERSION + '_x64-setup.exe')).write_bytes(b'fixture installer, never executed')
        newline = '\r\n' if crlf else '\n'
        (self.windows / 'README.md').write_bytes(('Windows fixture' + newline + 'Source commit: ' + SOURCE_SHA + newline).encode())
        (self.windows / 'LICENSE').write_text('Fixture license')
        self.checksums(self.windows, crlf=crlf)

    def assert_refused(self, message):
        result = self.run_step('Publish Aven release')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(message, result.stderr + result.stdout)
        self.assertFalse((self.root / 'gh-called.json').exists(), 'Publishing client must not be invoked')

    def test_requested_windows_requires_expected_directory(self):
        self.assert_refused('expected artifact directory is missing')

    def test_missing_manifest_or_readme_is_rejected(self):
        self.create_windows()
        for name in ('SHA256SUMS', 'README.md'):
            with self.subTest(name=name):
                path = self.windows / name
                original = path.read_bytes()
                path.unlink()
                self.assert_refused(name + ' is missing or empty')
                path.write_bytes(original)

    def test_zero_or_multiple_installers_are_rejected(self):
        self.create_windows()
        installer = next(self.windows.glob('*-setup.exe'))
        contents = installer.read_bytes()
        installer.unlink()
        self.checksums(self.windows)
        self.assert_refused('expected exactly one installer')
        installer.write_bytes(contents)
        (self.windows / 'second-setup.exe').write_bytes(contents)
        self.checksums(self.windows)
        self.assert_refused('expected exactly one installer')

    def test_wrong_partial_or_duplicate_source_marker_is_rejected(self):
        self.create_windows()
        for markers in ('Source commit: ' + 'b' * 40,
                        'Source commit: ' + SOURCE_SHA + 'suffix',
                        'Source commit: ' + SOURCE_SHA + '\nSource commit: ' + SOURCE_SHA):
            with self.subTest(markers=markers):
                (self.windows / 'README.md').write_text(markers + '\n')
                self.checksums(self.windows)
                self.assert_refused('source commit does not match')

    def test_installer_must_be_covered_by_checksums_and_match_them(self):
        self.create_windows()
        installer = next(self.windows.glob('*-setup.exe'))
        self.checksums(self.windows, omit=(installer.name,))
        self.assert_refused('checksums must cover every package file')
        self.checksums(self.windows)
        installer.write_bytes(b'changed after packaging')
        self.assert_refused('FAILED')

    def test_valid_windows_package_is_attached_and_zip_is_real(self):
        self.create_windows(crlf=True)
        update_bytes = (self.release / 'latest.json').read_bytes()
        result = self.run_step('Publish Aven release')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        arguments = json.loads((self.root / 'gh-called.json').read_text())
        archive = self.release / ('Aven-' + VERSION + '-windows-x64.zip')
        installer = next(self.windows.glob('*-setup.exe'))
        self.assertIn(str(archive.relative_to(self.root)), arguments)
        self.assertIn(str((self.release / installer.name).relative_to(self.root)), arguments)
        with zipfile.ZipFile(archive) as zipped:
            self.assertEqual(zipped.read(self.windows.name + '/' + installer.name), installer.read_bytes())
        self.assertEqual((self.release / installer.name).read_bytes(), installer.read_bytes())
        self.assertEqual(self.windows.name, 'Aven-' + VERSION + '-windows-x64')
        self.assertEqual((self.release / 'latest.json').read_bytes(), update_bytes)
        notes = arguments[arguments.index('--notes') + 1]
        self.assertIn('Windows x64:', notes)
        self.assertIn('regular release downloads', notes)
        self.assertIn('Windows installer is unsigned', notes)
        self.assertIn('manually', notes)
        self.assertNotIn('test build', notes)
        self.assertNotIn('test downloads', notes)
        self.assertEqual(arguments[arguments.index('--target') + 1], SOURCE_SHA)

    def test_legacy_test_directory_cannot_substitute_for_regular_release(self):
        self.create_windows()
        self.windows.rename(self.windows.with_name(self.windows.name + '-test'))
        self.assert_refused('expected artifact directory is missing')

    def test_windows_upload_and_release_download_use_the_same_regular_artifact(self):
        producer = re.search(r'- name: Upload Windows package\n.*?\n\s+name: ([^\n]+)',
                             WINDOWS_WORKFLOW.read_text(), re.S)
        consumer = re.search(r'- uses: actions/download-artifact@v4\n\s+if: inputs.windows\n\s+with:\n\s+name: ([^\n]+)',
                             WORKFLOW.read_text())
        self.assertIsNotNone(producer)
        self.assertIsNotNone(consumer)
        self.assertEqual(producer.group(1), 'Aven-windows-x64')
        self.assertEqual(producer.group(1), consumer.group(1))

    def test_updater_stays_mac_only_and_matches_the_release_version(self):
        self.environment['AVEN_INCLUDE_WINDOWS'] = 'false'
        for update in (
            {'version': VERSION, 'platforms': {'windows-x86_64': {}}},
            {'version': VERSION, 'platforms': {'darwin-aarch64': {}, 'windows-x86_64': {}}},
            {'version': VERSION, 'platforms': ['darwin-aarch64']},
            {'version': '1.2.2', 'platforms': {'darwin-aarch64': {}}},
        ):
            with self.subTest(update=update):
                (self.release / 'latest.json').write_text(json.dumps(update))
                self.checksums(self.release)
                self.assert_refused('unexpected updater version or platform')

    def test_bad_mac_signing_report_still_blocks_both_platform_downloads(self):
        self.create_windows()
        report = self.release / 'signing-verification.json'
        verified = json.loads(report.read_text())
        for key, value in (('mode', 'ad-hoc'), ('teamId', 'OTHERTEAM'),
                           ('bundleId', 'com.example.other'),
                           ('strictSignatureVerification', 'failed')):
            with self.subTest(key=key):
                report.write_text(json.dumps({**verified, key: value}))
                self.checksums(self.release)
                self.assert_refused('unverified signing identity')

    def test_explicitly_disabled_windows_can_publish_without_its_artifact(self):
        self.environment['AVEN_INCLUDE_WINDOWS'] = 'false'
        result = self.run_step('Publish Aven release')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / 'gh-called.json').is_file())
        self.assertFalse(list(self.release.glob('*windows*')))

    def test_invalid_windows_selection_is_rejected(self):
        self.environment['AVEN_INCLUDE_WINDOWS'] = 'yes'
        self.assert_refused('must be true or false')

    def test_existing_tag_or_failed_tag_lookup_never_invokes_publishing(self):
        self.environment['AVEN_INCLUDE_WINDOWS'] = 'false'
        for status, message in ((0, 'Version tag already exists'),
                                (128, 'Could not verify whether the release tag exists')):
            with self.subTest(git_status=status):
                self.executable('git', '#!/bin/sh\n[ "$1" = ls-remote ] || exit 97\nexit ' + str(status) + '\n')
                self.assert_refused(message)


if __name__ == '__main__':
    unittest.main()
