#!/usr/bin/env python3
"""Exercise fail-closed release identity selection and notarization without changing a keychain.

Notarization runs against fake xcrun, ditto, codesign and spctl executables; no
request reaches Apple and no real credential is used.
"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import stat
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
NOTARIZER = ROOT / 'scripts/notarize-release.py'
NOTARY_API_NAMES = ('APPLE_API_KEY_P8_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID')
FIXTURE_KEY = '-----BEGIN PRIVATE KEY-----\nZml4dHVyZS1vbmx5\n-----END PRIVATE KEY-----\n'
FIXTURE_CREDENTIALS = {
    'APPLE_API_KEY_P8_BASE64': base64.b64encode(FIXTURE_KEY.encode()).decode(),
    'APPLE_API_KEY_ID': 'ABC123DEFG',
    'APPLE_API_ISSUER_ID': '01234567-89ab-cdef-0123-456789abcdef',
}
SUBMISSION = '11111111-2222-3333-4444-555555555555'
# One fake for every Apple tool. It records the order of calls, whether the
# encoded key leaked into its environment, and the key file's permissions.
FAKE_APPLE_TOOL = r'''
import json, os, stat, sys
from pathlib import Path
tool, args = Path(sys.argv[0]).name, sys.argv[1:]
entry = {'tool': tool, 'args': args, 'encodedKeyInEnvironment': 'APPLE_API_KEY_P8_BASE64' in os.environ}
if args[:2] == ['notarytool', 'submit'] and '--key' in args:
    key = Path(args[args.index('--key') + 1])
    entry['key'] = {'mode': stat.S_IMODE(key.stat().st_mode), 'directoryMode': stat.S_IMODE(key.parent.stat().st_mode),
                    'directory': str(key.parent), 'contents': key.read_text()}
with open(os.environ['FAKE_APPLE_LOG'], 'a') as log:
    log.write(json.dumps(entry) + '\n')
if tool == 'ditto':
    Path(args[-1]).write_bytes(b'fixture upload')
elif args[:2] == ['notarytool', 'submit']:
    status = os.environ.get('FAKE_NOTARY_STATUS', 'Accepted')
    print(json.dumps({'id': os.environ['FAKE_SUBMISSION'], 'status': status, 'message': 'fixture'}))
    sys.exit(0 if status == 'Accepted' else 1)
elif args[:2] == ['notarytool', 'log']:
    print(json.dumps({'issues': [{'message': 'fixture notarization issue'}]}))
elif tool == 'spctl':
    print(args[-1] + ': accepted', file=sys.stderr)
    print('source=' + os.environ.get('FAKE_GATEKEEPER_SOURCE', 'Notarized Developer ID'), file=sys.stderr)
elif args[:2] == ['stapler', 'staple']:
    sys.exit(int(os.environ.get('FAKE_STAPLE_STATUS', '0')))
'''


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

    def test_ad_hoc_refuses_updater_or_notary_credentials_or_developer_id_options(self):
        self.assertEqual(set(signing.NOTARY_ENV), set(NOTARY_API_NAMES) | {'AVEN_NOTARY_KEYCHAIN_PROFILE'})
        for name in signing.UPDATER_ENV + signing.NOTARY_ENV + ('AVEN_RELEASE_SIGNING_IDENTITY', 'AVEN_RELEASE_KEYCHAIN'):
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
            self.assertEqual(report['notarization'], {'notarized': False, 'status': 'not-submitted'})
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


class NotarizationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='aven-notary-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ('xcrun', 'ditto', 'codesign', 'spctl'):
            tool = self.bin / name
            tool.write_text('#!' + sys.executable + '\n' + FAKE_APPLE_TOOL)
            tool.chmod(0o755)
        self.runner = self.root / 'runner-temp'
        self.runner.mkdir()
        self.app = self.root / 'Aven.app'
        self.app.mkdir()
        self.report = self.root / 'signing-verification.json'
        self.report.write_text(json.dumps({
            'status': 'verified', 'mode': 'developer-id', 'app': 'Aven.app', 'teamId': TEAM,
            'bundleId': BUNDLE, 'strictSignatureVerification': 'passed',
            'notarization': {'notarized': False, 'status': 'not-submitted'}}))
        self.log = self.root / 'apple-calls.jsonl'
        self.environment = {'PATH': str(self.bin) + os.pathsep + os.environ.get('PATH', ''),
                            'RUNNER_TEMP': str(self.runner), 'FAKE_APPLE_LOG': str(self.log),
                            'FAKE_SUBMISSION': SUBMISSION}

    def notarize(self, action='notarize', **extra):
        arguments = [sys.executable, '-B', str(NOTARIZER), action]
        if action == 'notarize':
            arguments += ['--app', str(self.app), '--report', str(self.report)]
        return subprocess.run(arguments, env={**self.environment, **extra},
                              capture_output=True, text=True, timeout=30)

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def notarization(self):
        return json.loads(self.report.read_text())['notarization']

    def assert_no_secret_output(self, result):
        for value in (FIXTURE_CREDENTIALS['APPLE_API_KEY_P8_BASE64'], 'Zml4dHVyZS1vbmx5'):
            self.assertNotIn(value, result.stdout + result.stderr)

    def test_absent_credentials_skip_with_warning_and_record_not_notarized(self):
        for github in ('', 'true'):
            with self.subTest(github_actions=github):
                result = self.notarize(GITHUB_ACTIONS=github, **{name: '' for name in NOTARY_API_NAMES})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), 'not-notarized')
                self.assertIn('::warning' if github else 'Warning:', result.stderr)
                self.assertIn('not notarized', result.stderr)
                self.assertEqual(self.notarization()['notarized'], False)
                self.assertEqual(self.notarization()['status'], 'skipped')
                self.assertEqual(self.calls(), [], 'Nothing may be submitted without credentials')
        check = self.notarize('check')
        self.assertEqual((check.returncode, check.stdout.strip()), (0, 'not-configured'))

    def test_api_key_notarizes_then_staples_and_assesses_before_recording(self):
        result = self.notarize(**FIXTURE_CREDENTIALS)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'notarized')
        self.assert_no_secret_output(result)
        calls = self.calls()
        self.assertEqual([(call['tool'], call['args'][:2]) for call in calls], [
            ('ditto', ['-c', '-k']), ('xcrun', ['notarytool', 'submit']), ('xcrun', ['stapler', 'staple']),
            ('xcrun', ['stapler', 'validate']), ('codesign', ['--verify', '--deep']), ('spctl', ['-a', '-vvv'])])
        self.assertIn('--keepParent', calls[0]['args'])
        submit = calls[1]['args']
        for option, value in (('--key-id', 'ABC123DEFG'), ('--issuer', FIXTURE_CREDENTIALS['APPLE_API_ISSUER_ID']),
                              ('--timeout', '45m')):
            self.assertEqual(submit[submit.index(option) + 1], value)
        self.assertIn('--wait', submit)
        self.assertEqual(calls[1]['key']['mode'], 0o600)
        self.assertEqual(calls[1]['key']['directoryMode'], 0o700)
        self.assertEqual(calls[1]['key']['contents'], FIXTURE_KEY)
        self.assertEqual(Path(calls[1]['key']['directory']), self.runner / 'aven-notary-key')
        self.assertFalse(any(call['encodedKeyInEnvironment'] for call in calls))
        self.assertFalse((self.runner / 'aven-notary-key').exists(), 'Decoded key must be removed')
        record = self.notarization()
        self.assertEqual((record['notarized'], record['submissionId'], record['stapled'], record['gatekeeper']),
                         (True, SUBMISSION, True, 'accepted'))

    def test_local_api_key_uses_a_private_temporary_directory_that_is_removed(self):
        environment = dict(FIXTURE_CREDENTIALS, RUNNER_TEMP='', TMPDIR=str(self.root))
        result = self.notarize(**environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        key = self.calls()[1]['key']
        self.assertEqual((key['mode'], key['directoryMode']), (0o600, 0o700))
        self.assertFalse(Path(key['directory']).exists())

    def test_rejected_submission_prints_apple_log_removes_key_and_never_staples(self):
        result = self.notarize(FAKE_NOTARY_STATUS='Invalid', **FIXTURE_CREDENTIALS)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fixture notarization issue', result.stderr)
        self.assertIn(SUBMISSION, result.stderr)
        self.assert_no_secret_output(result)
        commands = [call['args'][:2] for call in self.calls()]
        self.assertIn(['notarytool', 'log'], commands)
        self.assertNotIn(['stapler', 'staple'], commands)
        self.assertFalse((self.runner / 'aven-notary-key').exists())
        self.assertEqual(self.notarization()['notarized'], False)

    def test_failed_staple_or_unnotarized_gatekeeper_result_fails_closed(self):
        for extra in ({'FAKE_STAPLE_STATUS': '1'}, {'FAKE_GATEKEEPER_SOURCE': 'Developer ID'}):
            with self.subTest(extra=extra):
                result = self.notarize(**extra, **FIXTURE_CREDENTIALS)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.notarization()['notarized'], False)
                self.assertFalse((self.runner / 'aven-notary-key').exists())

    def test_keychain_profile_needs_no_key_file(self):
        result = self.notarize(AVEN_NOTARY_KEYCHAIN_PROFILE='aven-notary')
        self.assertEqual(result.returncode, 0, result.stderr)
        submit = self.calls()[1]['args']
        self.assertEqual(submit[submit.index('--keychain-profile') + 1], 'aven-notary')
        self.assertNotIn('--key', submit)
        self.assertEqual(self.notarization()['credential'], 'keychain-profile')

    def test_partial_conflicting_or_malformed_credentials_fail_without_echoing_values(self):
        cases = (
            ({'APPLE_API_KEY_ID': 'ABC123DEFG'}, 'missing: APPLE_API_KEY_P8_BASE64, APPLE_API_ISSUER_ID'),
            (dict(FIXTURE_CREDENTIALS, AVEN_NOTARY_KEYCHAIN_PROFILE='aven-notary'), 'not both'),
            (dict(FIXTURE_CREDENTIALS, APPLE_API_KEY_P8_BASE64='not base64!'), 'not valid base64'),
            (dict(FIXTURE_CREDENTIALS, APPLE_API_KEY_P8_BASE64=base64.b64encode(b'other').decode()), '.p8 private key'),
            (dict(FIXTURE_CREDENTIALS, APPLE_API_ISSUER_ID='issuer'), 'APPLE_API_ISSUER_ID'),
        )
        for environment, message in cases:
            for action in ('check', 'notarize'):
                with self.subTest(message=message, action=action):
                    result = self.notarize(action, **environment)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(message, result.stderr)
                    self.assert_no_secret_output(result)
        self.assertEqual(self.calls(), [])

    def test_ad_hoc_or_unverified_report_is_never_submitted(self):
        for change in ({'mode': 'ad-hoc-local-test', 'teamId': None}, {'strictSignatureVerification': 'failed'}):
            with self.subTest(change=change):
                report = json.loads(self.report.read_text())
                self.report.write_text(json.dumps({**report, **change}))
                result = self.notarize(**FIXTURE_CREDENTIALS)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('ad-hoc builds are never submitted', result.stderr)
                self.assertEqual(self.calls(), [])

    def test_cleanup_removes_a_leftover_runner_key_directory(self):
        leftover = self.runner / 'aven-notary-key'
        leftover.mkdir()
        (leftover / 'AuthKey_ABC123DEFG.p8').write_text(FIXTURE_KEY)
        result = self.notarize('cleanup')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(leftover.exists())
        self.assertEqual(self.notarize('cleanup').returncode, 0, 'Cleanup is safe to repeat')


class BuildEntrypointTests(unittest.TestCase):
    def test_notary_credentials_are_hidden_from_build_and_notarization_precedes_archives(self):
        script = (ROOT / 'scripts/build-release.sh').read_text()
        hidden = script.index('unset APPLE_API_KEY_P8_BASE64 APPLE_API_KEY_ID APPLE_API_ISSUER_ID')
        notarize = script.index('scripts/notarize-release.py notarize')
        self.assertLess(hidden, script.index('npm ci'))
        self.assertLess(hidden, script.index('./scripts/build-chromium.sh'))
        self.assertLess(script.index('scripts/notarize-release.py check'), script.index('npm ci'))
        self.assertLess(script.index('python3 -B scripts/release-signing.py "${task_verification_args[@]}"'), notarize)
        self.assertLess(notarize, script.index('ditto -c -k'))
        self.assertLess(notarize, script.index('scripts/package-update.py'))
        self.assertEqual(script.count('task_with_notary_env python3'), 3)

    def run_entrypoint(self, arguments=(), **extra):
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
                elif name in ('npm', 'cargo'):
                    body = 'echo "BUILD WORK WAS REACHED" >&2; exit 99\n'
                else:
                    body = 'exit 0\n'
                executable.write_text('#!/bin/sh\n' + body)
                executable.chmod(0o755)
            environment = {'PATH': str(bin_dir), 'CEF_ROOT': str(bin_dir / 'unused-cef'), **extra}
            return subprocess.run(['/bin/bash', str(ROOT / 'scripts/build-release.sh'), *arguments],
                                  env=environment, capture_output=True, text=True)

    def test_missing_identity_aborts_before_build_or_dependency_work(self):
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('No valid Developer ID', result.stderr)
        self.assertNotIn('BUILD WORK WAS REACHED', result.stdout + result.stderr)

    def test_ad_hoc_build_refuses_notarization_credentials_before_any_work(self):
        for name, value in (('APPLE_API_KEY_ID', 'ABC123DEFG'),
                            ('APPLE_API_KEY_P8_BASE64', FIXTURE_CREDENTIALS['APPLE_API_KEY_P8_BASE64']),
                            ('AVEN_NOTARY_KEYCHAIN_PROFILE', 'aven-notary')):
            with self.subTest(name=name):
                result = self.run_entrypoint(['--ad-hoc'], **{name: value})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Ad-hoc local tests cannot be notarized', result.stderr)
                self.assertNotIn('BUILD WORK WAS REACHED', result.stdout + result.stderr)
                self.assertNotIn(FIXTURE_CREDENTIALS['APPLE_API_KEY_P8_BASE64'], result.stdout + result.stderr)

if __name__ == '__main__':
    unittest.main()
