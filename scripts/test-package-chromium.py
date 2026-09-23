#!/usr/bin/env python3
"""Exercise app/helper privacy metadata without native builds, signing, or app launches."""
import importlib.util
import io
from pathlib import Path
import plistlib
import shutil
import tempfile
import unittest
from unittest import mock


SOURCE_ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('aven_packager', SOURCE_ROOT / 'scripts/package-chromium.py')
packager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packager)
BLUETOOTH_KEY = 'NSBluetoothAlwaysUsageDescription'


class PrivacyPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='aven-privacy-packaging-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.app = self.root / 'target/Aven.app'
        self.contents = self.app / 'Contents'
        (self.contents / 'MacOS').mkdir(parents=True)
        (self.contents / 'Resources').mkdir()
        (self.contents / 'Resources/icon.icns').write_bytes(b'fixture icon')
        (self.contents / 'MacOS/monocode').write_bytes(b'fixture binary, never executed')
        (self.root / 'src-tauri').mkdir()
        (self.root / 'src-tauri/Entitlements.plist').write_bytes(plistlib.dumps({}))
        for name in ('LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt'):
            (self.root / name).write_text('fixture notice')
        self.cef = self.root / 'cef'
        framework = self.cef / 'Release/Chromium Embedded Framework.framework'
        for relative in ('Chromium Embedded Framework', 'Libraries/libcef_sandbox.dylib',
                         'Resources/icudtl.dat', 'Resources/en.lproj/locale.pak', 'Resources/Info.plist'):
            path = framework / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'fixture runtime, never executed')
        for name in ('LICENSE.txt', 'CREDITS.html'):
            (self.cef / name).write_text('fixture notice')
        self.build = self.root / 'chromium-build'
        self.build.mkdir()
        (self.build / packager.HELPER_BUILD_NAME).write_bytes(b'fixture helper, never executed')
        self.scratch = self.root / 'scratch'
        self.scratch.mkdir()
        for name, value in (('REPO', self.root), ('CEF_ROOT', self.cef),
                            ('CEF_BUILD', self.build), ('SCRATCH', self.scratch)):
            patcher = mock.patch.object(packager, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)

    def host_info(self, product='Aven', identifier='com.capi.monocode.personal'):
        info = plistlib.loads((SOURCE_ROOT / 'src-tauri/Info.plist').read_bytes())
        info.update(CFBundleName=product, CFBundleIdentifier=identifier,
                    CFBundleExecutable='monocode', CFBundleIconFile='icon.icns',
                    CFBundleVersion='0.9.0', CFBundleShortVersionString='0.9.0')
        return info

    def write_info(self, info):
        # Binary form makes an unintended rewrite visible in the negative test.
        (self.contents / 'Info.plist').write_bytes(plistlib.dumps(info, fmt=plistlib.FMT_BINARY))

    def snapshot(self):
        return {str(path.relative_to(self.app)): path.read_bytes()
                for path in self.app.rglob('*') if path.is_file()}

    def test_source_declares_nonempty_bluetooth_purpose(self):
        description = self.host_info().get(BLUETOOTH_KEY)
        self.assertIsInstance(description, str)
        self.assertTrue(description.strip())

    def test_missing_or_invalid_purpose_fails_before_bundle_mutation_or_signing(self):
        for value in (None, '', ' \n\t', False, 7):
            with self.subTest(description=value):
                info = self.host_info()
                if value is None:
                    info.pop(BLUETOOTH_KEY, None)
                else:
                    info[BLUETOOTH_KEY] = value
                self.write_info(info)
                before = self.snapshot()
                with mock.patch.object(packager, 'run') as run, \
                     mock.patch.object(packager.subprocess, 'check_output') as check_output:
                    with self.assertRaisesRegex(RuntimeError, BLUETOOTH_KEY):
                        packager.package(self.app, 'Aven', 'com.capi.monocode.personal', '-', io.StringIO(), {})
                    run.assert_not_called()
                    check_output.assert_not_called()
                self.assertEqual(before, self.snapshot())
                self.assertFalse((self.contents / 'Frameworks').exists())

    def test_production_and_dev_helpers_inherit_all_host_privacy_descriptions(self):
        def simulated_run(command, _log, _env):
            if command[0] == 'ditto':
                shutil.copytree(command[1], command[2])
            # All other commands are signing steps, intentionally not executed.

        for product, identifier in (('Aven', 'com.capi.monocode.personal'),
                                    ('Aven Dev', 'com.capi.aven.dev')):
            with self.subTest(product=product):
                info = self.host_info(product, identifier)
                self.write_info(info)
                with mock.patch.object(packager, 'run', side_effect=simulated_run) as run, \
                     mock.patch.object(packager.subprocess, 'check_output', return_value=''):
                    _, _, helpers, _ = packager.package(self.app, product, identifier, '-', io.StringIO(), {})
                host = plistlib.loads((self.contents / 'Info.plist').read_bytes())
                self.assertEqual(host[BLUETOOTH_KEY], info[BLUETOOTH_KEY])
                expected = {key: value for key, value in info.items()
                            if key.startswith('NS') and key.endswith('UsageDescription')}
                self.assertEqual(len(helpers), 5)
                for helper, _ in helpers:
                    helper_info = plistlib.loads((helper / 'Contents/Info.plist').read_bytes())
                    actual = {key: value for key, value in helper_info.items()
                              if key.startswith('NS') and key.endswith('UsageDescription')}
                    self.assertEqual(actual, expected, helper.name)
                    self.assertTrue(helper_info['CFBundleIdentifier'].startswith(identifier + '.chromium.helper'))
                self.assertTrue(any(call.args[0][:2] == ['codesign', '--verify'] for call in run.call_args_list))


if __name__ == '__main__':
    unittest.main()
