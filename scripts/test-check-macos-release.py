#!/usr/bin/env python3
"""Keep release signing readiness separate from Apple notarization readiness."""
import importlib.util
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('release_checker', ROOT / 'scripts/check-macos-release.py')
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class ReleaseReadinessTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'scripts/package-update.py').touch()
        (self.root / 'src/lib').mkdir(parents=True)
        (self.root / 'src/lib/personalBuild.ts').write_text('export const IS_PERSONAL_BUILD = false;')
        self.app = self.root / 'Aven.app'
        (self.app / 'Contents/Frameworks/Chromium Embedded Framework.framework').mkdir(parents=True)
        self.config = {'identifier': 'com.capi.monocode.personal', 'version': '1.2.3',
                       'plugins': {'updater': {'pubkey': 'fixture-public-key',
                                              'endpoints': ['https://example.com/latest.json']}}}
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': self.config['identifier'], 'CFBundleShortVersionString': '1.2.3'}))
        for patcher in (mock.patch.object(checker, 'ROOT', self.root),
                        mock.patch.object(checker.release_signing, 'preflight', return_value='A' * 40),
                        mock.patch.object(checker.release_signing, 'verify', return_value={'status': 'verified'}),
                        mock.patch.object(checker.subprocess, 'run', return_value=subprocess.CompletedProcess(
                            [], 0, '', self.app.name + ': accepted\nsource=Notarized Developer ID\n'))):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def checks(report):
        return {item['check']: item for item in report['checks']}

    def test_final_packager_policy_replaces_unused_tauri_signing_config(self):
        self.assertNotIn('bundle', self.config)
        report = checker.check_release(self.config, self.app)
        self.assertTrue(self.checks(report)['Developer ID configured']['passed'])
        self.assertTrue(report['configuration_ready'])
        checker.release_signing.verify.assert_called_once_with(self.app)

    def test_missing_keychain_identity_is_a_separate_failed_readiness_check(self):
        checker.release_signing.preflight.side_effect = RuntimeError('No matching release identity')
        report = checker.check_release(self.config, self.app)
        self.assertTrue(self.checks(report)['Developer ID configured']['passed'])
        self.assertFalse(self.checks(report)['Developer ID identity available']['passed'])
        self.assertFalse(report['configuration_ready'])

    def test_signed_app_without_notarization_is_not_ready(self):
        checker.subprocess.run.return_value = subprocess.CompletedProcess([], 1)
        report = checker.check_release(self.config, self.app)
        self.assertTrue(self.checks(report)['Final app signing contract']['passed'])
        self.assertFalse(self.checks(report)['Stapled notarization ticket']['passed'])
        self.assertFalse(report['configuration_ready'])

    def test_final_app_must_pass_staple_validation_and_gatekeeper_assessment(self):
        report = checker.check_release(self.config, self.app)
        commands = [call.args[0] for call in checker.subprocess.run.call_args_list]
        self.assertIn(['xcrun', 'stapler', 'validate', str(self.app)], commands)
        self.assertIn(['spctl', '-a', '-vvv', '-t', 'exec', str(self.app)], commands)
        self.assertTrue(self.checks(report)['Gatekeeper accepts notarized app']['passed'])

    def test_signed_but_unnotarized_gatekeeper_source_is_not_ready(self):
        checker.subprocess.run.return_value = subprocess.CompletedProcess(
            [], 0, '', 'Aven.app: accepted\nsource=Developer ID\n')
        report = checker.check_release(self.config, self.app)
        self.assertFalse(self.checks(report)['Gatekeeper accepts notarized app']['passed'])
        self.assertFalse(report['configuration_ready'])

    def test_unexpected_team_or_requirement_cannot_pass_with_valid_ticket(self):
        checker.release_signing.verify.side_effect = RuntimeError('Unexpected signing team')
        report = checker.check_release(self.config, self.app)
        self.assertFalse(self.checks(report)['Final app signing contract']['passed'])
        self.assertTrue(self.checks(report)['Stapled notarization ticket']['passed'])
        self.assertFalse(report['configuration_ready'])

    def test_changed_production_identifier_cannot_pass_configuration_readiness(self):
        self.config['identifier'] = 'com.unrelated.app'
        report = checker.check_release(self.config, self.app)
        self.assertFalse(self.checks(report)['Developer ID configured']['passed'])
        self.assertFalse(report['configuration_ready'])

    def test_no_final_app_or_missing_stapler_does_not_claim_readiness(self):
        self.assertFalse(checker.check_release(self.config)['configuration_ready'])
        checker.subprocess.run.side_effect = FileNotFoundError('xcrun unavailable')
        report = checker.check_release(self.config, self.app)
        self.assertFalse(self.checks(report)['Stapled notarization ticket']['passed'])
        self.assertFalse(self.checks(report)['Gatekeeper accepts notarized app']['passed'])
        self.assertFalse(report['configuration_ready'])


if __name__ == '__main__':
    unittest.main()
