#!/usr/bin/env python3
"""Exercise CI signing setup with fake certificates and mocked security/network IO."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location('aven_ci_signing', Path(__file__).with_name('ci-signing-keychain.py'))
ci = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci)
TEAM = 'L54FM345MU'
FINGERPRINT = 'A1' * 20
IDENTITY = 'Developer ID Application: Test Only (' + TEAM + ')'
P12 = b'\x30fictional PKCS12 fixture; never import into a real keychain'
P12_PASSWORD = 'test-certificate-password-never-real'
KEYCHAIN_PASSWORD = 'test-temporary-password-never-real'
CERTIFICATE = b'fictional G2 certificate fixture; never trust or import'
ORIGINAL = ['/Users/runner/Library/Keychains/login.keychain-db',
            '/Users/runner/Library/Keychains/build tools.keychain-db']


def identity_output(rows=None):
    rows = [(FINGERPRINT, IDENTITY)] if rows is None else rows
    return ''.join(f'  {number}) {fingerprint} "{name}"\n'
                   for number, (fingerprint, name) in enumerate(rows, 1)) + f'  {len(rows)} valid identities found\n'


class SigningKeychainTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='aven-ci-signing-tests-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.policy = self.root / 'policy.json'
        self.policy.write_text(json.dumps({'teamId': TEAM, 'bundleId': 'com.capi.monocode.personal'}))
        self.envfile = self.root / 'github-env'
        self.environment = {
            'GITHUB_ACTIONS': 'true', 'RUNNER_TEMP': str(self.root), 'GITHUB_ENV': str(self.envfile),
            'APPLE_DEVELOPER_ID_P12_BASE64': base64.b64encode(P12).decode(),
            'APPLE_DEVELOPER_ID_P12_PASSWORD': P12_PASSWORD,
        }
        self.directory = self.root / ci.DIRECTORY
        self.commands = []
        self.identities = identity_output()
        self.failure = None
        self.import_observed = False
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(ci, 'POLICY', self.policy).start()
        mock.patch.object(ci, 'G2_SHA256', hashlib.sha256(CERTIFICATE).hexdigest()).start()
        self.download = mock.patch.object(ci, 'download_intermediate', return_value=CERTIFICATE).start()
        mock.patch.object(ci.secrets, 'token_urlsafe', return_value=KEYCHAIN_PASSWORD).start()
        self.process = mock.patch.object(ci.subprocess, 'run', side_effect=self.fake_security).start()

    def fake_security(self, command, **options):
        self.assertEqual(command[0], '/usr/bin/security')
        self.assertEqual(options['stderr'], subprocess.DEVNULL)
        self.assertEqual(options['stdin'], subprocess.DEVNULL)
        self.assertNotIn('APPLE_DEVELOPER_ID_P12_BASE64', options['env'])
        self.assertNotIn('APPLE_DEVELOPER_ID_P12_PASSWORD', options['env'])
        self.commands.append(command)
        action = command[1]
        if action == 'import':
            p12_path = Path(command[2])
            self.assertEqual(p12_path.read_bytes(), P12)
            self.assertEqual(stat.S_IMODE(p12_path.stat().st_mode), 0o600)
            self.import_observed = True
        if action == self.failure:
            return subprocess.CompletedProcess(command, 1, stdout=P12_PASSWORD, stderr=KEYCHAIN_PASSWORD)
        if action == 'list-keychains' and '-s' not in command:
            output = '\n'.join(shlex.quote(path) for path in ORIGINAL)
        elif action == 'create-keychain':
            Path(command[-1]).write_bytes(b'fake keychain; not an actual Security database')
            output = ''
        elif action == 'find-identity':
            output = self.identities
        elif action == 'delete-keychain':
            Path(command[-1]).unlink(missing_ok=True)
            output = ''
        else:
            output = ''
        return subprocess.CompletedProcess(command, 0, stdout=output, stderr='')

    def test_setup_imports_only_into_owned_keychain_and_exports_public_metadata(self):
        with mock.patch.dict(os.environ, self.environment):
            ci.setup(self.environment)
        keychain = str(self.directory / ci.KEYCHAIN)
        self.assertEqual(stat.S_IMODE(self.directory.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.directory / ci.STATE).stat().st_mode), 0o600)
        self.assertFalse((self.directory / 'identity.p12').exists())
        self.assertTrue(self.import_observed)
        self.assertEqual(self.envfile.read_text(),
                         f'AVEN_RELEASE_KEYCHAIN={keychain}\nAVEN_RELEASE_SIGNING_IDENTITY={FINGERPRINT}\n')
        state = (self.directory / ci.STATE).read_text()
        self.assertEqual(json.loads(state)['originalSearchList'], ORIGINAL)
        for secret in (P12_PASSWORD, KEYCHAIN_PASSWORD, self.environment['APPLE_DEVELOPER_ID_P12_BASE64']):
            self.assertNotIn(secret, state + self.envfile.read_text())
        imported = next(command for command in self.commands if command[1] == 'import')
        self.assertNotIn('-A', imported)
        self.assertEqual(imported[imported.index('-T') + 1], '/usr/bin/codesign')
        verify = next(command for command in self.commands if command[1] == 'verify-cert')
        self.assertIn(ci.SYSTEM_ROOTS, verify)
        self.assertIn('-L', verify)
        self.assertLess(self.commands.index(verify), self.commands.index(imported))
        partitions = next(command for command in self.commands if command[1] == 'set-key-partition-list')
        self.assertEqual(partitions[-1], keychain)
        self.assertEqual(partitions[partitions.index('-S') + 1], 'apple-tool:,apple:')
        for command in self.commands:
            self.assertNotIn(command[1], ('default-keychain', 'login-keychain', 'add-trusted-cert'))
        search_update = next(command for command in self.commands if command[1] == 'list-keychains' and '-s' in command)
        self.assertEqual(search_update[5:], ORIGINAL + [keychain])

    def test_explicit_cleanup_restores_ordered_search_list_and_removes_only_owned_directory(self):
        unrelated = self.root / 'unrelated'
        unrelated.write_text('keep')
        ci.setup(self.environment)
        self.commands.clear()
        ci.cleanup_directory(self.directory)
        self.assertFalse(self.directory.exists())
        self.assertEqual(unrelated.read_text(), 'keep')
        self.assertEqual(self.commands[0], ['/usr/bin/security', 'list-keychains', '-d', 'user', '-s', *ORIGINAL])
        self.assertEqual(self.commands[1], ['/usr/bin/security', 'delete-keychain', str(self.directory / ci.KEYCHAIN)])
        self.commands.clear()
        ci.cleanup_directory(self.directory)
        self.assertEqual(self.commands, [])

    def test_existing_or_symlinked_setup_directory_is_preserved(self):
        self.directory.mkdir()
        marker = self.directory / 'existing-work'
        marker.write_text('keep')
        with self.assertRaisesRegex(ci.SigningError, 'already exists'):
            ci.setup(self.environment)
        self.assertEqual(marker.read_text(), 'keep')
        marker.unlink()
        self.directory.rmdir()
        self.directory.symlink_to(self.root / 'missing-target', target_is_directory=True)
        with self.assertRaisesRegex(ci.SigningError, 'already exists'):
            ci.setup(self.environment)
        self.assertTrue(self.directory.is_symlink())
        self.process.assert_not_called()

    def test_setup_requires_ci_and_both_secrets_before_any_security_calls(self):
        for key in ('GITHUB_ACTIONS', *ci.SECRET_NAMES):
            with self.subTest(key=key):
                environment = dict(self.environment)
                environment.pop(key)
                with self.assertRaises(ci.SigningError):
                    ci.setup(environment)
        self.process.assert_not_called()
        self.assertFalse(self.directory.exists())

    def test_malformed_base64_or_non_der_p12_is_rejected_before_import(self):
        for encoded in ('@@invalid', base64.b64encode(b'not DER').decode(), ''):
            with self.subTest(encoded=encoded):
                environment = dict(self.environment, APPLE_DEVELOPER_ID_P12_BASE64=encoded)
                with self.assertRaises(ci.SigningError):
                    ci.setup(environment)
        self.process.assert_not_called()
        self.assertFalse(self.directory.exists())

    def test_failed_import_removes_p12_keychain_and_restores_search_list_without_leaking_diagnostics(self):
        self.failure = 'import'
        with self.assertRaises(ci.SigningError) as failure:
            ci.setup(self.environment)
        self.assertNotIn(P12_PASSWORD, str(failure.exception))
        self.assertNotIn(KEYCHAIN_PASSWORD, str(failure.exception))
        self.assertFalse(self.directory.exists())
        self.assertFalse(self.envfile.exists())
        self.assertTrue(self.import_observed)
        self.assertEqual(self.commands[-2][5:], ORIGINAL)
        self.assertEqual(self.commands[-1][1], 'delete-keychain')

    def test_wrong_team_non_developer_or_multiple_identities_fail_closed_and_clean_up(self):
        for rows in (
            [(FINGERPRINT, 'Developer ID Application: Somebody (WRONGTEAM1)')],
            [(FINGERPRINT, 'Apple Development: Test Only (' + TEAM + ')')],
            [(FINGERPRINT, IDENTITY), ('B2' * 20, IDENTITY)],
            [(FINGERPRINT, IDENTITY), ('B2' * 20, 'Developer ID Application: Other (WRONGTEAM1)')],
            [],
        ):
            with self.subTest(rows=rows):
                self.identities = identity_output(rows)
                with self.assertRaises(ci.SigningError):
                    ci.setup(self.environment)
                self.assertFalse(self.directory.exists())
                self.assertFalse(self.envfile.exists())
        self.assertFalse(any(command[1] == 'set-key-partition-list' for command in self.commands))

    def test_bad_intermediate_hash_or_system_trust_failure_never_imports_secrets(self):
        self.download.return_value = b'tampered public certificate'
        with self.assertRaisesRegex(ci.SigningError, 'pinned hash'):
            ci.setup(self.environment)
        self.assertFalse(self.directory.exists())
        self.assertFalse(any(command[1] in ('import', 'create-keychain') for command in self.commands))
        self.download.return_value = CERTIFICATE
        self.failure = 'verify-cert'
        with self.assertRaises(ci.SigningError):
            ci.setup(self.environment)
        self.assertFalse(self.directory.exists())
        self.assertFalse(any(command[1] == 'import' for command in self.commands))

    def test_partition_failure_and_environment_write_failure_always_clean_up(self):
        self.failure = 'set-key-partition-list'
        with self.assertRaises(ci.SigningError):
            ci.setup(self.environment)
        self.assertFalse(self.directory.exists())
        self.assertFalse(self.envfile.exists())
        self.failure = None
        with mock.patch.object(ci, 'append_public_environment', side_effect=OSError('fixture error ' + P12_PASSWORD)):
            with self.assertRaises(ci.SigningError) as failure:
                ci.setup(self.environment)
        self.assertNotIn(P12_PASSWORD, str(failure.exception))
        self.assertFalse(self.directory.exists())

    def test_failed_cleanup_keeps_public_record_for_retry_and_removes_decoded_p12(self):
        ci.setup(self.environment)
        ci.write_private(self.directory / 'identity.p12', P12)
        self.failure = 'delete-keychain'
        with self.assertRaisesRegex(ci.SigningError, 'cleanup failed'):
            ci.cleanup_directory(self.directory)
        self.assertTrue((self.directory / ci.STATE).exists())
        self.assertFalse((self.directory / 'identity.p12').exists())
        self.failure = None
        ci.cleanup_directory(self.directory)
        self.assertFalse(self.directory.exists())

    def test_cleanup_refuses_unowned_or_symlinked_keychain_targets(self):
        self.directory.mkdir(mode=0o700)
        with self.assertRaisesRegex(ci.SigningError, 'ownership record'):
            ci.cleanup_directory(self.directory)
        self.process.assert_not_called()
        self.directory.rmdir()
        ci.setup(self.environment)
        keychain = self.directory / ci.KEYCHAIN
        keychain.unlink()
        outside = self.root / 'do-not-delete'
        outside.write_text('keep')
        keychain.symlink_to(outside)
        self.commands.clear()
        with self.assertRaisesRegex(ci.SigningError, 'symlinked'):
            ci.cleanup_directory(self.directory)
        self.assertEqual(outside.read_text(), 'keep')
        self.assertEqual(self.commands, [])

    def test_main_suppresses_sensitive_subprocess_exception_details(self):
        output = io.StringIO()
        error = io.StringIO()
        with mock.patch.dict(os.environ, self.environment), mock.patch.object(ci.sys, 'platform', 'darwin'):
            self.process.side_effect = subprocess.TimeoutExpired(['security', '-P', P12_PASSWORD], 60)
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
                self.assertEqual(ci.main([]), 1)
        displayed = output.getvalue() + error.getvalue()
        self.assertIn('sensitive diagnostics suppressed', displayed)
        self.assertNotIn(P12_PASSWORD, displayed)
        self.assertNotIn(KEYCHAIN_PASSWORD, displayed)

    def test_cleanup_cli_rejects_non_ci_environment_without_security_calls(self):
        with mock.patch.dict(os.environ, self.environment), mock.patch.object(ci.sys, 'platform', 'darwin'):
            os.environ.pop('GITHUB_ACTIONS')
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(ci.main(['--cleanup']), 1)
        self.process.assert_not_called()


if __name__ == '__main__':
    unittest.main()
