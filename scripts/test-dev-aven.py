#!/usr/bin/env python3
"""Focused stdlib checks for the isolated development runner; never launches apps."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('aven_dev_runner', Path(__file__).with_name('dev-aven.py'))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class DevRunnerGuards(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / 'checkout'
        self.root.mkdir()
        self.app = self.root / 'target/debug/Aven Dev.app'
        self.sdk = Path(self.temporary.name) / 'cef'
        (self.sdk / 'include').mkdir(parents=True)
        (self.sdk / 'include/cef_version.h').write_text('fixture header')
        (self.root / 'src-tauri/icons').mkdir(parents=True)
        (self.root / 'src-tauri/tauri.conf.json').write_text(json.dumps({
            'identifier': 'com.capi.monocode.personal',
            'build': {'devUrl': 'http://127.0.0.1:1420'},
        }))
        (self.root / 'src-tauri/Info.plist').write_bytes(plistlib.dumps({
            'NSCameraUsageDescription': 'Camera requires approval.',
            'NSMicrophoneUsageDescription': 'Microphone requires approval.',
            'NSDocumentsFolderUsageDescription': 'Open chosen projects.',
            'NSBluetoothAlwaysUsageDescription': 'The browser may check Bluetooth devices.',
        }))
        (self.root / 'src-tauri/icons/icon.icns').write_bytes(b'fixture icon')
        (self.root / 'package.json').write_text(json.dumps({'version': '0.9.0'}))
        (self.root / 'node_modules/.bin').mkdir(parents=True)
        (self.root / 'node_modules/.bin/vite').write_text('fixture executable')
        (self.root / 'target/debug').mkdir(parents=True)
        (self.root / 'target/debug/aven').write_bytes(b'fixture binary; never executed')
        for patcher in (
            mock.patch.object(runner, 'ROOT', self.root),
            mock.patch.object(runner, 'APP', self.app),
            mock.patch.dict(os.environ, {'CEF_ROOT': str(self.sdk)}, clear=True),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def doctor(self):
        with mock.patch.object(runner.sys, 'platform', 'darwin'), \
             mock.patch.object(runner.os, 'uname', return_value=SimpleNamespace(machine='arm64')), \
             mock.patch.object(runner.shutil, 'which', return_value='/fixture/tool'), \
             contextlib.redirect_stdout(io.StringIO()):
            runner.doctor()

    def test_doctor_rejects_foreign_cargo_output_directory(self):
        with mock.patch.dict(os.environ, {'CARGO_TARGET_DIR': str(Path(self.temporary.name) / 'other')}):
            with self.assertRaisesRegex(RuntimeError, 'CARGO_TARGET_DIR'):
                self.doctor()

    def test_doctor_rejects_inherited_compile_time_tauri_config(self):
        with mock.patch.dict(os.environ, {'TAURI_CONFIG': '{"build":{"devUrl":"http://other-host:9999"}}'}):
            with self.assertRaisesRegex(RuntimeError, 'TAURI_CONFIG'):
                self.doctor()

    def test_doctor_requires_distinct_production_identity(self):
        (self.root / 'src-tauri/tauri.conf.json').write_text(json.dumps({'identifier': runner.IDENTITY}))
        with self.assertRaisesRegex(RuntimeError, 'identities must differ'):
            self.doctor()

    def test_doctor_accepts_complete_local_prerequisites_without_building(self):
        with mock.patch.object(runner.subprocess, 'run') as run:
            self.doctor()
            run.assert_not_called()

    def test_occupied_loopback_port_is_not_available(self):
        with socket.socket() as owner:
            owner.bind(('127.0.0.1', 0))
            owner.listen(1)
            with mock.patch.object(runner, 'PORT', owner.getsockname()[1]):
                self.assertFalse(runner.port_is_available())

    def test_running_daily_app_is_allowed_but_development_helpers_block_rebuild(self):
        with mock.patch.object(runner.subprocess, 'check_output', return_value='/Applications/Aven.app/Contents/MacOS/aven\n'):
            runner.ensure_not_running()
        for executable in (
            self.app / 'Contents/MacOS/aven',
            self.app / 'Contents/MacOS/monocode',
            self.app / 'Contents/Frameworks/Aven Helper.app/Contents/MacOS/Aven Helper',
        ):
            with self.subTest(executable=str(executable)), \
                 mock.patch.object(runner.subprocess, 'check_output', return_value=str(executable) + '\n'):
                with self.assertRaisesRegex(RuntimeError, 'already running'):
                    runner.ensure_not_running()

    def test_symlinked_bundle_never_removes_its_target(self):
        outside = Path(self.temporary.name) / 'do-not-touch.app'
        outside.mkdir()
        marker = outside / 'user-file'
        marker.write_text('preserved')
        self.app.symlink_to(outside, target_is_directory=True)
        with mock.patch.object(runner, 'run'), mock.patch.object(runner, 'ensure_not_running'), \
             mock.patch.object(runner.shutil, 'rmtree') as remove:
            with self.assertRaises(RuntimeError):
                runner.prepare_bundle()
            remove.assert_not_called()
        self.assertEqual(marker.read_text(), 'preserved')

    def test_symlinked_debug_parent_never_builds_or_removes_external_bundle(self):
        # APP itself is a directory; its parent is the escaping link.
        debug = self.root / 'target/debug'
        (debug / 'aven').unlink()
        debug.rmdir()
        outside = Path(self.temporary.name) / 'external-output'
        outside.mkdir()
        debug.symlink_to(outside, target_is_directory=True)
        self.app.mkdir()
        marker = self.app / 'user-file'
        marker.write_text('preserved')
        with mock.patch.object(runner, 'run') as build, \
             mock.patch.object(runner, 'ensure_not_running'), \
             mock.patch.object(runner.shutil, 'rmtree') as remove:
            with self.assertRaises(RuntimeError):
                runner.prepare_bundle()
            build.assert_not_called()
            remove.assert_not_called()
        self.assertEqual(marker.read_text(), 'preserved')

    def test_failed_compilation_preserves_previous_development_bundle(self):
        self.app.mkdir()
        marker = self.app / 'existing-bundle'
        marker.write_text('last working preview')
        with mock.patch.object(runner, 'ensure_not_running'), \
             mock.patch.object(runner, 'run', side_effect=[None, subprocess.CalledProcessError(1, 'cargo')]):
            with self.assertRaises(subprocess.CalledProcessError):
                runner.prepare_bundle()
        self.assertEqual(marker.read_text(), 'last working preview')

    def test_bundle_preserves_usage_descriptions_and_declares_dev_identity(self):
        with mock.patch.object(runner, 'ensure_not_running'), mock.patch.object(runner, 'run') as run, \
             contextlib.redirect_stdout(io.StringIO()):
            runner.prepare_bundle()
        self.assertIn(mock.call('cargo', 'build', '--locked', '-p', 'aven', '--bin', 'aven'), run.call_args_list)
        info = plistlib.loads((self.app / 'Contents/Info.plist').read_bytes())
        self.assertEqual(info['CFBundleIdentifier'], 'com.capi.aven.dev')
        self.assertEqual(info['CFBundleName'], 'Aven Dev')
        self.assertEqual(info['CFBundleShortVersionString'], '0.9.0')
        self.assertEqual(info['CFBundleExecutable'], 'aven')
        self.assertEqual(info['NSCameraUsageDescription'], 'Camera requires approval.')
        self.assertEqual(info['NSMicrophoneUsageDescription'], 'Microphone requires approval.')
        self.assertEqual(info['NSDocumentsFolderUsageDescription'], 'Open chosen projects.')
        self.assertEqual(info['NSBluetoothAlwaysUsageDescription'], 'The browser may check Bluetooth devices.')
        self.assertTrue((self.app / 'Contents/Resources' / info['CFBundleIconFile']).is_file())
        self.assertTrue((self.app / 'Contents/MacOS' / info['CFBundleExecutable']).is_file())
        legacy = self.app / 'Contents/MacOS/monocode'
        self.assertTrue(legacy.is_symlink())
        self.assertEqual(os.readlink(legacy), 'aven')
        self.assertEqual(legacy.resolve(), (self.app / 'Contents/MacOS/aven').resolve())
        self.assertTrue(legacy.resolve().is_relative_to(self.app.resolve()))

    def test_launch_does_not_spawn_or_stop_anything_when_port_is_owned(self):
        with mock.patch.object(runner, 'port_is_available', return_value=False), \
             mock.patch.object(runner.subprocess, 'Popen') as popen, \
             mock.patch.object(runner.os, 'killpg') as killpg:
            with self.assertRaisesRegex(RuntimeError, 'Port'):
                runner.launch()
            popen.assert_not_called()
            killpg.assert_not_called()

    def test_launch_strips_host_scope_and_ctrl_c_leaves_app_to_quit_normally(self):
        server = mock.Mock(pid=312345)
        server.poll.return_value = None
        app = mock.Mock(pid=312346, returncode=0)
        app.poll.side_effect = [None, None, 0]
        app.wait.side_effect = [KeyboardInterrupt(), 0]
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        with mock.patch.dict(os.environ, {'AVEN_BROWSER_TOKEN': 'fake-fixture-only',
                                         'AVEN_CONTROL_TOKEN': 'fake-fixture-only',
                                         'SUPERMONO_BROWSER_TOKEN': 'fake-fixture-only',
                                         'MONOCODE_CONTROL_TOKEN': 'fake-fixture-only',
                                         'TAURI_CONFIG': '{}', 'PATH': '/fixture/bin'}), \
             mock.patch.object(runner, 'port_is_available', return_value=True), \
             mock.patch.object(runner, 'ensure_not_running') as not_running, \
             mock.patch.object(runner.subprocess, 'Popen', side_effect=[server, app]) as popen, \
             mock.patch.object(runner.urllib.request, 'urlopen', return_value=response), \
             mock.patch.object(runner.os, 'killpg') as killpg, \
             contextlib.redirect_stdout(io.StringIO()):
            runner.launch()
        for call in popen.call_args_list:
            env = call.kwargs['env']
            self.assertNotIn('AVEN_BROWSER_TOKEN', env)
            self.assertNotIn('AVEN_CONTROL_TOKEN', env)
            self.assertNotIn('SUPERMONO_BROWSER_TOKEN', env)
            self.assertNotIn('MONOCODE_CONTROL_TOKEN', env)
            self.assertNotIn('TAURI_CONFIG', env)
            self.assertEqual(env['PATH'], '/fixture/bin')
        not_running.assert_called_once_with()
        self.assertEqual(popen.call_args_list[1].args[0],
                         ['/usr/bin/open', '-W', '-n', '-a', str(self.app)])
        self.assertTrue(popen.call_args_list[1].kwargs['start_new_session'])
        # The app itself is launched by LaunchServices; no app binary or
        # process-name-based quit command is run by this runner.
        self.assertEqual([call.args[0][0] for call in popen.call_args_list], ['npm', '/usr/bin/open'])
        app.terminate.assert_not_called()
        app.kill.assert_not_called()
        killpg.assert_called_once_with(server.pid, runner.signal.SIGTERM)

    def test_preview_opened_during_server_startup_blocks_launch_and_only_stops_own_server(self):
        server = mock.Mock(pid=312345)
        server.poll.return_value = None
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        with mock.patch.object(runner, 'port_is_available', return_value=True), \
             mock.patch.object(runner.subprocess, 'check_output',
                               return_value=str(self.app / 'Contents/MacOS/aven') + '\n'), \
             mock.patch.object(runner.subprocess, 'Popen', return_value=server) as popen, \
             mock.patch.object(runner.urllib.request, 'urlopen', return_value=response), \
             mock.patch.object(runner.os, 'killpg') as killpg:
            with self.assertRaisesRegex(RuntimeError, 'already running'):
                runner.launch()
        popen.assert_called_once()
        self.assertEqual(popen.call_args.args[0][0], 'npm')
        killpg.assert_called_once_with(server.pid, runner.signal.SIGTERM)

    def test_debug_opt_ins_are_forwarded_to_launchservices_only_with_exact_opt_in(self):
        for flag, value in ((flag, value)
                            for flag in ('AVEN_DEV_CURSOR_PREVIEW', 'AVEN_DEV_BROWSER_LAYOUT_TRACE')
                            for value in (None, '', '0', 'true', '01', '1 ', '1\n', '1')):
            with self.subTest(flag=flag, value=value):
                server = mock.Mock(pid=312345)
                server.poll.return_value = None
                launcher = mock.Mock(pid=312346, returncode=0)
                launcher.poll.return_value = 0
                response = mock.MagicMock()
                response.__enter__.return_value.status = 200
                environment = {
                    'AVEN_BROWSER_TOKEN': 'fake-fixture-only',
                    'AVEN_CONTROL_TOKEN': 'fake-fixture-only',
                    'SUPERMONO_BROWSER_TOKEN': 'fake-fixture-only',
                    'MONOCODE_CONTROL_TOKEN': 'fake-fixture-only',
                }
                if value is not None:
                    environment[flag] = value
                with mock.patch.dict(os.environ, environment), \
                     mock.patch.object(runner, 'port_is_available', return_value=True), \
                     mock.patch.object(runner, 'ensure_not_running'), \
                     mock.patch.object(runner.subprocess, 'Popen', side_effect=[server, launcher]) as popen, \
                     mock.patch.object(runner.urllib.request, 'urlopen', return_value=response), \
                     mock.patch.object(runner.os, 'killpg') as killpg, \
                     contextlib.redirect_stdout(io.StringIO()):
                    runner.launch()
                expected = ['/usr/bin/open', '-W', '-n']
                if value == '1':
                    expected.extend(['--env', flag + '=1'])
                expected.extend(['-a', str(self.app)])
                self.assertEqual(popen.call_args_list[1].args[0], expected)
                for call in popen.call_args_list:
                    child_environment = call.kwargs['env']
                    self.assertNotIn('AVEN_DEV_CURSOR_PREVIEW', child_environment)
                    self.assertNotIn('AVEN_DEV_BROWSER_LAYOUT_TRACE', child_environment)
                    self.assertFalse(any(key.startswith(('AVEN_BROWSER_', 'AVEN_CONTROL_',
                                                        'SUPERMONO_', 'MONOCODE_'))
                                         for key in child_environment))
                self.assertEqual([call.args[0][0] for call in popen.call_args_list], ['npm', '/usr/bin/open'])
                launcher.terminate.assert_not_called()
                launcher.kill.assert_not_called()
                killpg.assert_called_once_with(server.pid, runner.signal.SIGTERM)

    def test_launchservices_failure_cleans_own_server_without_quitting_apps(self):
        server = mock.Mock(pid=312345)
        server.poll.return_value = None
        launcher = mock.Mock(pid=312346, returncode=1)
        launcher.poll.return_value = 1
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        with mock.patch.object(runner, 'port_is_available', return_value=True), \
             mock.patch.object(runner.subprocess, 'check_output',
                               return_value='/Applications/Aven.app/Contents/MacOS/aven\n'), \
             mock.patch.object(runner.subprocess, 'Popen', side_effect=[server, launcher]) as popen, \
             mock.patch.object(runner.urllib.request, 'urlopen', return_value=response), \
             mock.patch.object(runner.os, 'killpg') as killpg, \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'Could not open or wait for Aven Dev'):
                runner.launch()
        self.assertEqual(popen.call_args_list[1].args[0],
                         ['/usr/bin/open', '-W', '-n', '-a', str(self.app)])
        launcher.terminate.assert_not_called()
        launcher.kill.assert_not_called()
        killpg.assert_called_once_with(server.pid, runner.signal.SIGTERM)

    def test_failed_server_readiness_cleans_its_child_without_starting_app(self):
        server = mock.Mock(pid=312345)
        server.poll.return_value = None
        with mock.patch.object(runner, 'port_is_available', return_value=True), \
             mock.patch.object(runner.subprocess, 'Popen', return_value=server) as popen, \
             mock.patch.object(runner.urllib.request, 'urlopen', side_effect=OSError('not listening')), \
             mock.patch.object(runner.time, 'sleep'), \
             mock.patch.object(runner.os, 'killpg') as killpg:
            with self.assertRaisesRegex(RuntimeError, 'did not become ready'):
                runner.launch()
        popen.assert_called_once()
        killpg.assert_called_once_with(server.pid, runner.signal.SIGTERM)
        server.wait.assert_called_once_with(timeout=5)


if __name__ == '__main__':
    unittest.main()
