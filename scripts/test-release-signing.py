#!/usr/bin/env python3
"""Exercise fail-closed release identity selection without changing a keychain."""
import importlib.util
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('release_signing', ROOT / 'scripts/release-signing.py')
signing = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(signing)
TEAM = 'L54FM345MU'
BUNDLE = 'com.capi.monocode.personal'
FINGERPRINT = 'A' * 40
NAME = 'Developer ID Application: Example Developer (' + TEAM + ')'
IDENTITY = '  1) ' + FINGERPRINT + ' "' + NAME + '"\n     1 valid identities found\n'


def signature(identifier=BUNDLE):
    return '\n'.join([
        'Identifier=' + identifier,
        'CodeDirectory v=20500 size=100 flags=0x10000(runtime) hashes=10+7 location=embedded',
        'Authority=' + NAME,
        'Authority=Developer ID Certification Authority',
        'Authority=Apple Root CA',
        'Timestamp=Sep 28, 2026 at 1:23:53 PM',
        'TeamIdentifier=' + TEAM,
        'designated => ' + signing.stable_requirement(identifier, TEAM),
    ])


class IdentityTests(unittest.TestCase):
    def test_unique_valid_expected_team_identity_is_selected(self):
        other = '2) ' + 'B' * 40 + ' "Developer ID Application: Other (ABCDEFGHIJ)"\n'
        self.assertEqual(signing.select_identity(IDENTITY + other, TEAM), FINGERPRINT)

    def test_same_identity_in_multiple_keychains_is_not_ambiguous(self):
        self.assertEqual(signing.select_identity(IDENTITY + IDENTITY, TEAM), FINGERPRINT)

    def test_missing_wrong_team_wrong_type_and_expired_fail_closed(self):
        outputs = ('', IDENTITY.replace(TEAM, 'ABCDEFGHIJ'),
                   IDENTITY.replace('Developer ID Application:', 'Apple Development:'),
                   IDENTITY.replace('"\n', '" (CSSMERR_TP_CERT_EXPIRED)\n'))
        for output in outputs:
            with self.subTest(output=output), self.assertRaisesRegex(RuntimeError, 'No valid Developer ID'):
                signing.select_identity(output, TEAM)

    def test_ambiguous_identities_need_exact_selection(self):
        identities = IDENTITY + IDENTITY.replace(FINGERPRINT, 'B' * 40)
        with self.assertRaisesRegex(RuntimeError, 'Multiple matching'):
            signing.select_identity(identities, TEAM)
        with self.assertRaisesRegex(RuntimeError, 'Multiple matching'):
            signing.select_identity(identities, TEAM, NAME)
        self.assertEqual(signing.select_identity(identities, TEAM, FINGERPRINT.lower()), FINGERPRINT)

    def test_explicit_selector_cannot_bypass_team_or_type(self):
        for selector in ('-', 'Apple Development:', 'B' * 40, 'Example Developer'):
            with self.subTest(selector=selector), self.assertRaisesRegex(RuntimeError, 'must select a valid'):
                signing.select_identity(IDENTITY, TEAM, selector)
        self.assertEqual(signing.select_identity(IDENTITY, TEAM, NAME), FINGERPRINT)

    def test_preflight_scopes_discovery_to_explicit_keychain(self):
        with tempfile.TemporaryDirectory() as folder:
            keychain = Path(folder).resolve() / 'isolated.keychain-db'
            keychain.touch()
            with mock.patch.object(signing, 'command', return_value=IDENTITY) as run:
                self.assertEqual(signing.preflight(environment={'AVEN_RELEASE_KEYCHAIN': str(keychain)}), FINGERPRINT)
            run.assert_called_once_with(['security', 'find-identity', '-v', '-p', 'codesigning', keychain])

    def test_missing_explicit_keychain_never_falls_back_to_login(self):
        with mock.patch.object(signing, 'command') as run:
            with self.assertRaisesRegex(RuntimeError, 'existing keychain'):
                signing.preflight(environment={'AVEN_RELEASE_KEYCHAIN': '/nonexistent/keychain'})
            run.assert_not_called()

    def test_ad_hoc_is_explicit_and_does_not_discover_keys(self):
        with mock.patch.object(signing, 'command') as run:
            self.assertEqual(signing.preflight(ad_hoc=True, environment={}), '-')
            run.assert_not_called()

    def test_ad_hoc_refuses_updater_credentials_or_developer_id_options(self):
        for name in signing.UPDATER_ENV + ('AVEN_RELEASE_SIGNING_IDENTITY', 'AVEN_RELEASE_KEYCHAIN'):
            with self.subTest(name=name), mock.patch.object(signing, 'command') as run:
                with self.assertRaisesRegex(RuntimeError, 'Ad-hoc local tests cannot'):
                    signing.preflight(ad_hoc=True, environment={name: 'fixture-never-read'})
                run.assert_not_called()

    def test_native_discovery_failure_is_not_silently_ignored(self):
        result = subprocess.CompletedProcess([], 1, '', 'keychain is unavailable')
        with mock.patch.object(signing.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, 'keychain is unavailable'):
                signing.preflight(environment={})


class SignatureTests(unittest.TestCase):
    def test_default_requirement_is_stable_and_comment_insensitive(self):
        output = signature().replace('] and certificate', '] /* exists */ and certificate')
        report = signing.inspect_signature(output, BUNDLE, TEAM)
        self.assertEqual(report['designatedRequirement'], signing.stable_requirement(BUNDLE, TEAM))
        self.assertEqual(report['teamId'], TEAM)

    def test_missing_identity_timestamp_runtime_or_requirement_fails(self):
        bad = (
            (signature().replace('Identifier=' + BUNDLE, 'Identifier=other'), 'signing identifier'),
            (signature().replace('TeamIdentifier=' + TEAM, 'TeamIdentifier=ABCDEFGHIJ'), 'signing team'),
            (signature().replace('Authority=' + NAME, 'Authority=Apple Development: Example'), 'authority'),
            (signature().replace('Timestamp=', 'Signed Time='), 'timestamp'),
            (signature().replace('0x10000(runtime)', '0x0(none)'), 'runtime'),
            (signature().replace('designated =>', 'missing =>'), 'requirement'),
        )
        for output, message in bad:
            with self.subTest(message=message), self.assertRaisesRegex(RuntimeError, message):
                signing.inspect_signature(output, BUNDLE, TEAM)

    def test_binary_hash_certificate_hash_and_permissive_requirements_are_rejected(self):
        default = signing.stable_requirement(BUNDLE, TEAM)
        for requirement in ('cdhash H"' + FINGERPRINT + '"',
                            default + ' and certificate leaf = H"' + FINGERPRINT + '"',
                            default + ' or anchor trusted'):
            with self.subTest(requirement=requirement), self.assertRaisesRegex(RuntimeError, 'Unstable'):
                signing.inspect_signature(signature().replace(default, requirement), BUNDLE, TEAM)

    def test_ad_hoc_signature_cannot_pass_release_verification(self):
        output = signature().replace('Authority=' + NAME, 'Signature=adhoc').replace(
            'TeamIdentifier=' + TEAM, 'TeamIdentifier=not set')
        with self.assertRaisesRegex(RuntimeError, 'signing team'):
            signing.inspect_signature(output, BUNDLE, TEAM)
        self.assertEqual(signing.inspect_signature(output, BUNDLE, TEAM, ad_hoc=True)['teamId'], 'not set')

    def test_final_bundle_verifies_every_helper_and_produces_public_report(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder).resolve() / 'Aven.app'
            targets = {app: ('Contents/Info.plist', BUNDLE)}
            targets[app / 'Contents/Frameworks/Chromium Embedded Framework.framework'] = (
                'Resources/Info.plist', 'org.cef.framework')
            for name, suffix in signing.HELPERS:
                targets[app / 'Contents/Frameworks' / ('Aven Helper' + name + '.app')] = (
                    'Contents/Info.plist', BUNDLE + '.chromium.helper' + suffix)
            for path, (info_path, identifier) in targets.items():
                info = path / info_path
                info.parent.mkdir(parents=True)
                info.write_bytes(plistlib.dumps({'CFBundleIdentifier': identifier}))

            def run(arguments):
                if '--verify' in arguments:
                    return ''
                return signature(targets[Path(arguments[-1])][1])

            with mock.patch.object(signing, 'command', side_effect=run) as native:
                report = signing.verify(app)
            self.assertEqual(native.call_args_list[0].args[0],
                             ['codesign', '--verify', '--deep', '--strict', str(app)])
            self.assertEqual(len(report['signatures']), 7)
            self.assertEqual(report['mode'], 'developer-id')
            self.assertNotIn(folder, json.dumps(report))
            # A corrupted helper cannot be hidden by a valid root signature.
            helper = next(path for path in targets if 'Renderer' in path.name)
            info = helper / targets[helper][0]
            info.write_bytes(plistlib.dumps({'CFBundleIdentifier': 'com.unexpected.helper'}))
            with mock.patch.object(signing, 'command') as native:
                with self.assertRaisesRegex(RuntimeError, 'Unexpected bundle identifier'):
                    signing.verify(app)
                native.assert_not_called()


class OutputTests(unittest.TestCase):
    def test_existing_updater_artifacts_are_preserved_and_block_unsigned_regeneration(self):
        for name in ('latest.json', 'Aven-1.2.3-macos-arm64.app.tar.gz',
                     'Aven-1.2.3-macos-arm64.app.tar.gz.sig'):
            with self.subTest(artifact=name), tempfile.TemporaryDirectory() as folder:
                output = Path(folder)
                artifact = output / name
                artifact.write_bytes(b'existing release bytes')
                with self.assertRaisesRegex(RuntimeError, 'would become stale'):
                    signing.check_output_directory(output, '1.2.3', environment={})
                self.assertEqual(artifact.read_bytes(), b'existing release bytes')
                for key in ('TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PATH'):
                    signing.check_output_directory(output, '1.2.3', environment={key: 'never-read'})
                    self.assertEqual(artifact.read_bytes(), b'existing release bytes')

    def test_existing_candidate_without_updates_can_be_rebuilt(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            (output / 'Aven-1.2.3-macos-arm64.zip').write_bytes(b'old candidate')
            signing.check_output_directory(output, '1.2.3', environment={})

    def test_broken_updater_symlink_is_not_left_beside_new_release(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            (output / 'latest.json').symlink_to(output / 'old-missing-manifest.json')
            with self.assertRaisesRegex(RuntimeError, 'would become stale'):
                signing.check_output_directory(output, '1.2.3', environment={})


class BuildEntrypointTests(unittest.TestCase):
    def test_missing_identity_aborts_before_build_or_dependency_work(self):
        with tempfile.TemporaryDirectory() as folder:
            bin_dir = Path(folder)
            # Real Python executes the checked-in preflight. All other tools are
            # inert fixtures, and no command may reach compilation or npm ci.
            (bin_dir / 'python3').symlink_to(sys.executable)
            for name in ('node', 'npm', 'cargo', 'rustc', 'cmake', 'ninja', 'codesign',
                         'ditto', 'xcrun', 'lipo', 'shasum', 'unzip', 'security', 'uname', 'dirname'):
                executable = bin_dir / name
                if name == 'uname':
                    body = 'if [ "$1" = -s ]; then echo Darwin; else echo arm64; fi\n'
                elif name == 'dirname':
                    body = '/usr/bin/dirname "$@"\n'
                elif name == 'security':
                    body = 'echo "0 valid identities found"\n'
                elif name == 'npm' or name == 'cargo':
                    body = 'echo "BUILD WORK WAS REACHED" >&2; exit 99\n'
                else:
                    body = 'exit 0\n'
                executable.write_text('#!/bin/sh\n' + body)
                executable.chmod(0o755)
            environment = {'PATH': str(bin_dir), 'CEF_ROOT': str(bin_dir / 'unused-cef')}
            result = subprocess.run(['/bin/bash', str(ROOT / 'scripts/build-release.sh')],
                                    env=environment, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('No valid Developer ID', result.stderr)
            self.assertNotIn('BUILD WORK WAS REACHED', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
