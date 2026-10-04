#!/usr/bin/env python3
"""Exercise the actual release workflow guards using disposable local fixtures.

No build, real gh call, credentials, Keychain operation, or remote Git access.
"""
import base64
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
INSTALLER = 'Aven_' + VERSION + '_x64-setup.exe'


def fixture_signature(name):
    """A Tauri-shaped updater signature for `name`; never cryptographically valid."""
    text = ('untrusted comment: signature from tauri secret key\nRUQfixture\n'
            'trusted comment: timestamp:1700000000\tfile:' + name + '\nfixture\n')
    return base64.b64encode(text.encode()).decode()


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


def step_block(name):
    """Return a step's YAML lines, from its name to the next step."""
    lines = WORKFLOW.read_text().splitlines()
    start = next(index for index, line in enumerate(lines) if line.strip() == '- name: ' + name)
    indentation = len(lines[start]) - len(lines[start].lstrip())
    block = [lines[start]]
    for line in lines[start + 1:]:
        if line.strip() and len(line) - len(line.lstrip()) <= indentation:
            break
        block.append(line)
    return '\n'.join(block)


NOTARY_SECRETS = ('APPLE_API_KEY_P8_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID')
NOTARIZED = {'notarized': True, 'status': 'accepted', 'submissionId': '11111111-2222-3333-4444-555555555555',
             'stapled': True, 'stapleValidation': 'passed', 'gatekeeper': 'accepted',
             'gatekeeperSource': 'Notarized Developer ID', 'credential': 'app-store-connect-api-key'}
SKIPPED = {'notarized': False, 'status': 'skipped', 'reason': 'No notarization credentials were supplied.'}


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
        shutil.copy(ROOT / 'scripts/release-assets.py', self.root / 'scripts/release-assets.py')
        self.release = self.root / 'release' / ('v' + VERSION)
        self.release.mkdir(parents=True)
        (self.release / ('Aven-' + VERSION + '-macos-arm64.zip')).write_bytes(b'fixture mac app, never opened')
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
        (self.windows / INSTALLER).write_bytes(b'fixture installer, never executed')
        (self.windows / (INSTALLER + '.sig')).write_text(fixture_signature(INSTALLER))
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

    def published_files(self, arguments):
        return {Path(argument).name for argument in arguments
                if argument.startswith(str(self.release.relative_to(self.root)) + '/')}

    def release_checksums(self):
        entries = {}
        for line in (self.release / 'SHA256SUMS').read_text().splitlines():
            digest, name = line.split('  ', 1)
            self.assertNotIn(name, entries, 'duplicate release checksum entry')
            entries[name] = digest
        return entries

    def test_valid_windows_package_is_attached_and_zip_is_real(self):
        self.create_windows(crlf=True)
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
        notes = arguments[arguments.index('--notes') + 1]
        self.assertIn('Windows x64:', notes)
        self.assertIn('regular release downloads', notes)
        self.assertIn('no Authenticode signature', notes)
        self.assertIn('updates signed by Aven', notes)
        self.assertNotIn('manually', notes)
        self.assertNotIn('test build', notes)
        self.assertNotIn('test downloads', notes)
        self.assertEqual(arguments[arguments.index('--target') + 1], SOURCE_SHA)

    def test_windows_update_joins_the_same_feed_with_its_download_and_signature(self):
        self.create_windows()
        mac_update = json.loads((self.release / 'latest.json').read_text())['platforms']['darwin-aarch64']
        result = self.run_step('Publish Aven release')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        update = json.loads((self.release / 'latest.json').read_text())
        self.assertEqual(update['version'], VERSION)
        self.assertEqual(update['platforms']['darwin-aarch64'], mac_update)
        expected = {
            'url': 'https://github.com/fixture/never-published/releases/download/v' + VERSION + '/' + INSTALLER,
            'signature': fixture_signature(INSTALLER),
        }
        self.assertEqual(update['platforms']['windows-x86_64'], expected)
        self.assertEqual(update['platforms']['windows-x86_64-nsis'], expected)
        self.assertEqual(set(update['platforms']),
                         {'darwin-aarch64', 'windows-x86_64', 'windows-x86_64-nsis'})
        arguments = json.loads((self.root / 'gh-called.json').read_text())
        files = self.published_files(arguments)
        self.assertIn(INSTALLER, files)
        self.assertIn(INSTALLER + '.sig', files)
        self.assertEqual((self.release / (INSTALLER + '.sig')).read_text(), fixture_signature(INSTALLER))
        # Every published file is listed once, and the rewritten feed's entry
        # is the final content rather than the macOS job's original hash.
        checksums = self.release_checksums()
        self.assertEqual(set(checksums), files - {'SHA256SUMS'})
        self.assertEqual(checksums['latest.json'],
                         hashlib.sha256((self.release / 'latest.json').read_bytes()).hexdigest())

    def test_stable_download_names_are_exact_copies_with_checksums(self):
        self.create_windows()
        result = self.run_step('Publish Aven release')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        files = self.published_files(json.loads((self.root / 'gh-called.json').read_text()))
        for alias, source in (('Aven-macos-arm64.zip', 'Aven-' + VERSION + '-macos-arm64.zip'),
                              ('Aven-windows-x64-setup.exe', INSTALLER)):
            with self.subTest(alias=alias):
                self.assertIn(alias, files)
                self.assertIn(source, files)
                self.assertEqual((self.release / alias).read_bytes(), (self.release / source).read_bytes())
                self.assertFalse((self.release / alias).is_symlink())
                self.assertEqual(self.release_checksums()[alias], self.release_checksums()[source])

    def test_requested_windows_requires_its_updater_signature(self):
        self.create_windows()
        signature = self.windows / (INSTALLER + '.sig')
        signature.unlink()
        self.checksums(self.windows)
        self.assert_refused('expected one updater signature for the installer')
        signature.write_text(fixture_signature('Aven_1.2.2_x64-setup.exe'))
        self.checksums(self.windows)
        self.assert_refused('does not belong to ' + INSTALLER)

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

    def test_incoming_macos_feed_must_be_mac_only_and_match_the_release_version(self):
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
        update_bytes = (self.release / 'latest.json').read_bytes()
        result = self.run_step('Publish Aven release')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / 'gh-called.json').is_file())
        self.assertFalse(list(self.release.glob('*windows*')))
        # A macOS-only release keeps a valid macOS-only feed and the stable
        # macOS name; the Windows stable name is simply absent.
        self.assertEqual((self.release / 'latest.json').read_bytes(), update_bytes)
        files = self.published_files(json.loads((self.root / 'gh-called.json').read_text()))
        self.assertIn('Aven-macos-arm64.zip', files)
        self.assertNotIn('Aven-windows-x64-setup.exe', files)
        self.assertEqual(set(self.release_checksums()), files - {'SHA256SUMS'})

    def set_notarization(self, notarization):
        report = self.release / 'signing-verification.json'
        report.write_text(json.dumps({**json.loads(report.read_text()), 'notarization': notarization}))
        self.checksums(self.release)

    def published_notes(self):
        self.environment['AVEN_INCLUDE_WINDOWS'] = 'false'
        result = self.run_step('Publish Aven release')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        arguments = json.loads((self.root / 'gh-called.json').read_text())
        return arguments[arguments.index('--notes') + 1], result.stderr

    def test_notarized_build_is_described_as_notarized(self):
        self.set_notarization(NOTARIZED)
        notes, log = self.published_notes()
        self.assertIn('notarized by Apple', notes)
        self.assertIn('opens normally', notes)
        self.assertNotIn('not Apple-notarized', notes)
        self.assertNotIn('Privacy & Security', notes)
        self.assertNotIn('::warning', log)

    def test_unnotarized_build_can_publish_but_says_so(self):
        for notarization in (SKIPPED, 'not checked', None):
            with self.subTest(notarization=notarization):
                (self.root / 'gh-called.json').unlink(missing_ok=True)
                # Each run publishes from a fresh folder in CI; drop the stable
                # copy the previous subtest's publish added to this one.
                (self.release / 'Aven-macos-arm64.zip').unlink(missing_ok=True)
                self.set_notarization(notarization)
                notes, log = self.published_notes()
                self.assertIn('Developer ID signed', notes)
                self.assertIn('not Apple-notarized', notes)
                self.assertIn('Privacy & Security', notes)
                self.assertNotIn('notarized by Apple', notes)
                self.assertIn('::warning title=Not notarized::', log)

    def test_incomplete_notarization_record_blocks_publishing(self):
        self.environment['AVEN_INCLUDE_WINDOWS'] = 'false'
        for key, value in (('stapled', False), ('gatekeeper', 'rejected'), ('submissionId', '')):
            with self.subTest(key=key):
                self.set_notarization({**NOTARIZED, key: value})
                self.assert_refused('incomplete notarization record')

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


class MacosNotarizationTests(WorkflowFixture):
    def setUp(self):
        super().setUp()
        self.calls = self.root / 'calls.log'
        self.environment['AVEN_TEST_CALLS'] = str(self.calls)
        self.environment['RUNNER_TEMP'] = str(self.root / 'runner-temp')
        (self.root / 'runner-temp').mkdir()
        record = '#!' + sys.executable + '\nimport os, sys\nopen(os.environ["AVEN_TEST_CALLS"], "a").write(" ".join(sys.argv) + "\\n")\n'
        self.executable('xcrun', record + 'sys.exit(int(os.environ.get("AVEN_TEST_STAPLER_STATUS", "0")))\n')
        self.executable('node', '#!' + sys.executable + '\nimport json, pathlib\n'
                        'print(json.loads(pathlib.Path("package.json").read_text())["version"])\n')
        if not shutil.which('shasum'):
            self.executable('shasum', '#!/bin/sh\nshift 2\nexec sha256sum "$@"\n')
        (self.root / 'scripts/release-signing.py').write_text(record.split('\n', 1)[1])
        (self.root / 'scripts/ci-signing-keychain.py').write_text(record.split('\n', 1)[1])
        (self.root / 'scripts/package-update.py').write_text(record.split('\n', 1)[1] + (
            'from pathlib import Path\nout = Path(sys.argv[sys.argv.index("--out") + 1])\n'
            'for name in ("Aven-1.2.3-macos-arm64.app.tar.gz", "Aven-1.2.3-macos-arm64.app.tar.gz.sig", "latest.json"):\n'
            '    (out / name).write_text("fixture")\n'))
        shutil.copy(ROOT / 'scripts/notarize-release.py', self.root / 'scripts/notarize-release.py')
        self.candidate = self.root / 'target/releases' / ('v' + VERSION)
        self.candidate.mkdir(parents=True)
        (self.release / 'latest.json').unlink()
        for path in self.release.iterdir():
            shutil.copy(path, self.candidate / path.name)

    def write_report(self, notarization):
        report = self.candidate / 'signing-verification.json'
        report.write_text(json.dumps({**json.loads(report.read_text()), 'notarization': notarization}))
        self.checksums(self.candidate)

    def logged(self):
        return self.calls.read_text().splitlines() if self.calls.exists() else []

    def test_notary_secrets_reach_only_the_build_step_which_runs_before_update_signing(self):
        build = step_block('Test, build, notarize, and package candidate')
        for name in NOTARY_SECRETS:
            self.assertIn(name + ': ${{ secrets.' + name + ' }}', build)
        self.assertIn('run: ./scripts/build-release.sh', build)
        self.assertNotIn('TAURI_SIGNING', build)
        workflow = WORKFLOW.read_text()
        for name in NOTARY_SECRETS:
            self.assertEqual(workflow.count('secrets.' + name), 1, name + ' must not reach other steps')
        self.assertLess(workflow.index('- name: Test, build, notarize, and package candidate'),
                        workflow.index('- name: Sign final Chromium update archive'))
        self.assertLess(workflow.index('- name: Sign final Chromium update archive'),
                        workflow.index('- name: Upload candidate for manual review'))

    def test_notarized_update_archive_requires_the_stapled_ticket_first(self):
        self.write_report(NOTARIZED)
        result = self.run_step('Sign final Chromium update archive')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        calls = self.logged()
        validate = next(index for index, line in enumerate(calls) if line.endswith('stapler validate target/release/bundle/macos/Aven.app'))
        package = next(index for index, line in enumerate(calls) if 'package-update.py' in line)
        self.assertLess(validate, package)

    def test_missing_ticket_on_notarized_build_blocks_update_signing(self):
        self.write_report(NOTARIZED)
        self.environment['AVEN_TEST_STAPLER_STATUS'] = '65'
        result = self.run_step('Sign final Chromium update archive')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('package-update.py' in line for line in self.logged()))

    def test_unnotarized_build_still_signs_updates_without_claiming_a_ticket(self):
        self.write_report(SKIPPED)
        result = self.run_step('Sign final Chromium update archive')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertFalse(any('stapler' in line for line in self.logged()))
        self.assertTrue(any('package-update.py' in line for line in self.logged()))

    def test_always_run_cleanup_removes_the_notary_key_and_the_keychain(self):
        self.assertIn('if: ${{ always() }}', step_block('Remove temporary signing material'))
        key_directory = self.root / 'runner-temp/aven-notary-key'
        key_directory.mkdir(mode=0o700)
        (key_directory / 'AuthKey_ABC123DEFG.p8').write_text('fixture key')
        result = self.run_step('Remove temporary signing material')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertFalse(key_directory.exists())
        self.assertTrue(any('ci-signing-keychain.py --cleanup' in line for line in self.logged()))

    def test_failed_key_cleanup_still_runs_keychain_cleanup_and_fails(self):
        (self.root / 'scripts/notarize-release.py').write_text('raise SystemExit(3)\n')
        result = self.run_step('Remove temporary signing material')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(any('ci-signing-keychain.py --cleanup' in line for line in self.logged()))

    def test_candidate_artifact_cannot_contain_the_runner_key_directory(self):
        upload = step_block('Upload candidate for manual review')
        self.assertIn('path: target/releases/v*/', upload)
        self.assertNotIn('RUNNER_TEMP', upload)


class WindowsUpdateSigningTests(unittest.TestCase):
    def test_release_signs_windows_updates_only_when_publishing(self):
        job = re.search(r'\n  windows:\n(.*?)\n\n  publish:', WORKFLOW.read_text(), re.S)
        self.assertIsNotNone(job)
        self.assertIn('sign_updates: ${{ inputs.publish }}', job.group(1))
        for name in ('TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'):
            self.assertIn(name + ': ${{ secrets.' + name + ' }}', job.group(1))

    def test_candidate_signs_the_tested_installer_and_verifies_it_with_the_public_key(self):
        text = WINDOWS_WORKFLOW.read_text()
        step = re.search(r'- name: Sign updater installer\n(.*?)\n      - name: ', text, re.S)
        self.assertIsNotNone(step)
        body = step.group(1)
        self.assertIn('if: inputs.sign_updates', body)
        self.assertIn('signer sign', body)
        self.assertIn('*> $null', body, 'signer output may contain key diagnostics')
        self.assertIn('--example verify_update', body)
        # The secret is scoped to this step, never to the build or tests.
        self.assertEqual(text.count('secrets.TAURI_SIGNING_PRIVATE_KEY }}'), 1)
        order = [text.index('- name: ' + name) for name in (
            'Build NSIS installer', 'Install and launch on Windows',
            'Sign updater installer', 'Prepare Windows release package')]
        self.assertEqual(order, sorted(order))
        self.assertIn('*-setup.exe.sig', text[text.index('- name: Prepare Windows release package'):])


class CheckoutCredentialTests(unittest.TestCase):
    def checkout_options(self):
        """Map each job to the `with:` lines of its checkout step."""
        jobs = {}
        job = None
        lines = WORKFLOW.read_text().splitlines()
        for index, line in enumerate(lines):
            match = re.fullmatch(r'  ([a-z0-9-]+):', line)
            if match:
                job = match.group(1)
            if line.strip() == '- uses: actions/checkout@v4':
                options = []
                for nested in lines[index + 1:]:
                    if nested.strip() in ('', 'with:'):
                        continue
                    if not nested.startswith(' ' * 10):
                        break
                    options.append(nested.strip())
                jobs[job] = options
        return jobs

    def test_build_jobs_do_not_persist_the_checkout_token(self):
        jobs = self.checkout_options()
        self.assertEqual(jobs['validate-source'], ['persist-credentials: false'])
        self.assertEqual(jobs['macos-arm64'], ['persist-credentials: false'])

    def test_publish_keeps_git_credentials_for_its_tag_lookup(self):
        # `git ls-remote origin` authenticates with the checkout token; gh uses
        # GH_TOKEN. Dropping it could block a release of a private repository.
        self.assertEqual(self.checkout_options()['publish'], [])
        self.assertIn('git ls-remote --exit-code --tags origin', step_script('Publish Aven release'))


if __name__ == '__main__':
    unittest.main()
