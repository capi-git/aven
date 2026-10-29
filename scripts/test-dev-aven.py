#!/usr/bin/env python3
"""Focused stdlib checks for the isolated development runner; never launches apps."""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import sys
import tempfile
import time
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

    def test_closed_preview_connection_does_not_look_like_a_running_server(self):
        with socket.socket() as owner, socket.socket() as client:
            owner.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            owner.bind(('127.0.0.1', 0))
            owner.listen(1)
            port = owner.getsockname()[1]
            client.settimeout(2)
            client.connect(('127.0.0.1', port))
            connection, _ = owner.accept()
            connection.close()
            self.assertEqual(client.recv(1), b'')
            client.close()
            owner.close()
            with mock.patch.object(runner, 'PORT', port):
                self.assertTrue(runner.port_is_available())

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



class RealAppCheck(unittest.TestCase):
    """The --smoke runner's folder, cleanup and scoring; never launches apps."""

    def setUp(self):
        self.checkout = Path(__file__).resolve().parent.parent
        patcher = mock.patch.object(runner, 'ROOT', self.checkout)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.root = runner.prepare_smoke_folder()
        self.addCleanup(lambda: runner.remove_smoke_folder(self.root))

    def test_folder_puts_only_the_stand_in_on_the_login_shell_path(self):
        stand_in = self.root / 'home/.local/bin/claude'
        self.assertTrue((self.root / runner.SMOKE_MARKER).is_file())
        self.assertTrue(os.access(stand_in, os.X_OK))
        self.assertTrue((self.root / 'project/README.md').is_file())
        zshrc = (self.root / 'home/.zshrc').read_text()
        self.assertIn(f'export PATH="{stand_in.parent}:/usr/bin:/bin:/usr/sbin:/sbin"', zshrc)
        # Homebrew and the developer's own folders are not on it.
        self.assertNotIn('homebrew', zshrc)
        self.assertNotIn(str(Path.home()), zshrc)

    def test_check_page_is_a_local_page_the_check_is_told_about(self):
        site = runner.add_check_page(self.root)
        self.assertIn('<title>Aven check page</title>', (site / 'index.html').read_text())
        runner.offer_check_page(self.root, 'http://127.0.0.1:8123/index.html')
        self.assertEqual(json.loads((self.root / 'page.json').read_text()),
                         {'pageUrl': 'http://127.0.0.1:8123/index.html'})

    def test_stand_in_answers_one_turn_with_the_smoke_word(self):
        stand_in = self.root / 'home/.local/bin/claude'
        version = subprocess.run([str(stand_in), '--version'], capture_output=True, text=True, timeout=10)
        self.assertRegex(version.stdout, r'\d+\.\d+\.\d+')
        auth = subprocess.run([str(stand_in), 'auth', 'status'], capture_output=True, text=True, timeout=10)
        self.assertTrue(json.loads(auth.stdout)['loggedIn'])
        requests = '\n'.join(json.dumps(line) for line in [
            {'type': 'control_request', 'request_id': 'aven_2', 'request': {'subtype': 'initialize'}},
            {'type': 'user', 'uuid': 'turn-1', 'message': {'role': 'user', 'content': []}},
        ]) + '\n'
        chat = subprocess.run([str(stand_in), '--input-format', 'stream-json', '--replay-user-messages',
                               '--session-id', 'SID'], input=requests, capture_output=True, text=True, timeout=10)
        messages = [json.loads(line) for line in chat.stdout.splitlines()]
        self.assertEqual([m['type'] for m in messages],
                         ['system', 'control_response', 'user', 'stream_event', 'stream_event',
                          'assistant', 'result'])
        self.assertEqual(messages[3]['event']['type'], 'message_start')
        self.assertEqual(messages[1]['response']['request_id'], 'aven_2')
        self.assertTrue(messages[2]['isReplay'])
        self.assertEqual(messages[-1]['result'], 'AVEN_SMOKE_OK')
        self.assertTrue(all(m.get('session_id', 'SID') == 'SID' for m in messages))

    def test_stand_in_streams_a_long_reply_for_the_speed_test(self):
        stand_in = self.root / 'home/.local/bin/claude'
        request = {'type': 'user', 'uuid': 'turn-2',
                   'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'Go. AVEN_PERF_STREAM 5'}]}}
        chat = subprocess.run([str(stand_in), '--input-format', 'stream-json'],
                              input=json.dumps(request) + '\n', capture_output=True, text=True, timeout=10)
        messages = [json.loads(line) for line in chat.stdout.splitlines()]
        deltas = [m['event']['delta']['text'] for m in messages
                  if m['type'] == 'stream_event' and m['event']['type'] == 'content_block_delta']
        # Five chunks, then the word the checks look for.
        self.assertEqual(len(deltas), 6)
        self.assertEqual(deltas[-1], 'AVEN_SMOKE_OK')
        final = next(m for m in messages if m['type'] == 'assistant')
        self.assertEqual(final['message']['content'][0]['text'], ''.join(deltas))

    def test_stand_in_streams_a_long_code_block_for_the_speed_test(self):
        stand_in = self.root / 'home/.local/bin/claude'
        request = {'type': 'user', 'uuid': 'turn-5',
                   'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'Go. AVEN_PERF_CODE 9'}]}}
        chat = subprocess.run([str(stand_in), '--input-format', 'stream-json'],
                              input=json.dumps(request) + '\n', capture_output=True, text=True, timeout=10)
        messages = [json.loads(line) for line in chat.stdout.splitlines()]
        deltas = [m['event']['delta']['text'] for m in messages
                  if m['type'] == 'stream_event' and m['event']['type'] == 'content_block_delta']
        text = ''.join(deltas)
        # An opening, two pieces per line, a closing, then the check word.
        self.assertEqual(len(deltas), 1 + 2 * 9 + 1 + 1)
        self.assertTrue(text.startswith('Here is the whole module:\n\n```ts\n'))
        self.assertEqual(text.count('```'), 2)
        self.assertIn('visibleRows1(', text)
        self.assertTrue(text.endswith('AVEN_SMOKE_OK'))

    def test_stand_in_holds_its_reply_when_asked(self):
        stand_in = self.root / 'home/.local/bin/claude'
        request = {'type': 'user', 'uuid': 'turn-3',
                   'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'Wait. AVEN_SMOKE_HOLD 600'}]}}
        started = time.monotonic()
        chat = subprocess.run([str(stand_in), '--input-format', 'stream-json'],
                              input=json.dumps(request) + '\n', capture_output=True, text=True, timeout=10)
        self.assertGreaterEqual(time.monotonic() - started, 0.6)
        messages = [json.loads(line) for line in chat.stdout.splitlines()]
        self.assertEqual(messages[-1]['result'], 'AVEN_SMOKE_OK')
        # A message without the marker is answered at once.
        started = time.monotonic()
        quick = {**request, 'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'Go.'}]}}
        subprocess.run([str(stand_in), '--input-format', 'stream-json'],
                       input=json.dumps(quick) + '\n', capture_output=True, text=True, timeout=10)
        self.assertLess(time.monotonic() - started, 0.6)

    def test_stand_in_answers_a_tool_free_keeper_call_with_memory_sections(self):
        stand_in = self.root / 'home/.local/bin/claude'
        request = {'type': 'user', 'uuid': 'turn-4',
                   'message': {'role': 'user', 'content': [{'type': 'text', 'text': '<project-digest>\nx\n</project-digest>'}]}}
        keeper = ['--input-format', 'stream-json', '--system-prompt', "You are Aven's memory keeper. Rules.",
                  '--tools', '']
        chat = subprocess.run([str(stand_in), *keeper], input=json.dumps(request) + '\n',
                              capture_output=True, text=True, timeout=10)
        messages = [json.loads(line) for line in chat.stdout.splitlines()]
        reply = messages[-1]['result']
        self.assertIn('## Stack', reply)
        self.assertIn('AVEN_KEEPER_OK', reply)
        log = [json.loads(line) for line in (self.root / 'home/.local/bin/fake-claude.log').read_text().splitlines()]
        self.assertTrue(any(entry.get('keeperTurn') == 'turn-4' and entry.get('digest') for entry in log))
        # With tools available it is not a keeper call: the chat word comes back.
        tools = subprocess.run([str(stand_in), *keeper[:-2]], input=json.dumps(request) + '\n',
                               capture_output=True, text=True, timeout=10)
        self.assertEqual(json.loads(tools.stdout.splitlines()[-1])['result'], 'AVEN_SMOKE_OK')
    def test_stand_in_starts_a_pretend_dev_server_and_echoes_the_note(self):
        stand_in = self.root / 'home/.local/bin/claude'
        note = ('<aven-shared-work>\nLive from Aven.\nDev server running: '
                'http://localhost:5199/ (started by Claude).\n</aven-shared-work>\n\nGo.')
        requests = '\n'.join(json.dumps({
            'type': 'user', 'uuid': uuid,
            'message': {'role': 'user', 'content': [{'type': 'text', 'text': text}]},
        }) for uuid, text in [
            ('turn-4', 'Start it. AVEN_SMOKE_DEV_SERVER 5199'),
            ('turn-5', f'{note} AVEN_SMOKE_ECHO_NOTE'),
            ('turn-6', 'Plain. AVEN_SMOKE_ECHO_NOTE'),
        ]) + '\n'
        chat = subprocess.run([str(stand_in), '--input-format', 'stream-json'],
                              input=requests, capture_output=True, text=True, timeout=10)
        messages = [json.loads(line) for line in chat.stdout.splitlines()]
        use = next(m for m in messages if m['type'] == 'assistant'
                   and m['message']['content'][0]['type'] == 'tool_use')['message']['content'][0]
        self.assertEqual((use['name'], use['input']['command']), ('Bash', 'npm run dev'))
        result = next(m for m in messages if m['type'] == 'user' and not m.get('isReplay'))
        output = result['message']['content'][0]
        self.assertEqual(output['tool_use_id'], use['id'])
        self.assertIn('VITE v5.4.0', output['content'])
        self.assertIn('Local:   http://localhost:5199/', output['content'])
        replies = [m['result'] for m in messages if m['type'] == 'result']
        self.assertEqual(replies, [
            'AVEN_SMOKE_OK',
            'AVEN_SMOKE_OK NOTE[Live from Aven. | Dev server running: http://localhost:5199/ (started by Claude).]',
            'AVEN_SMOKE_OK NOTE[none]',
        ])

    def test_stand_in_iterates_on_one_page_through_the_browser_command(self):
        stand_in = self.root / 'home/.local/bin/claude'
        calls = self.root / 'browser-calls.jsonl'
        # Aven's browser command, answering each open with the same page.
        fake = self.root / 'fake-aven'
        fake.write_text(
            f'#!{sys.executable}\n'
            'import json, sys\n'
            'request = json.loads(sys.argv[2])\n'
            f'open({str(calls)!r}, "a").write(json.dumps(request) + "\\n")\n'
            'print(json.dumps({"ok": True, "result": {"id": "page-1", "url": request["url"]}}))\n')
        fake.chmod(0o755)
        request = {'type': 'user', 'uuid': 'turn-8', 'message': {'role': 'user', 'content': [
            {'type': 'text', 'text': 'Show it. AVEN_SMOKE_PAGES http://127.0.0.1:8123/'}]}}
        chat = subprocess.run([str(stand_in), '--input-format', 'stream-json',
                               '--permission-prompt-tool', 'stdio'],
                              input=json.dumps(request) + '\n', capture_output=True, text=True,
                              timeout=20, env={**os.environ, 'AVEN_BROWSER_EXECUTABLE': str(fake)})
        reply = json.loads(chat.stdout.splitlines()[-1])['result']
        self.assertTrue(reply.startswith('AVEN_SMOKE_OK AVEN_PAGES ['), reply)
        opens = json.loads(reply.split('AVEN_PAGES ', 1)[1])
        self.assertEqual(len(opens), 6)
        # Each open says how long it took, for the check's report.
        self.assertTrue(all(isinstance(entry['ms'], int) and entry['ms'] >= 0 for entry in opens), opens)
        logged = [json.loads(line) for line in (stand_in.parent / 'fake-claude.log').read_text().splitlines()]
        self.assertEqual([entry['ms'] >= 0 for entry in logged if entry.get('browser') == 'open'], [True] * 6)
        sent = [json.loads(line) for line in calls.read_text().splitlines()]
        mock = 'http://127.0.0.1:8123/index.html?mock=1'
        self.assertEqual([(c['action'], c['url'], c.get('newTab', False), c['arrange']) for c in sent], [
            ('open', mock, False, False),
            ('open', mock, False, False),
            ('open', mock + '&v=2', False, False),
            ('open', 'http://127.0.0.1:8123/?mock=1', False, False),
            ('open', 'http://127.0.0.1:8123/alternative.html?mock=1', True, False),
            ('open', 'http://127.0.0.1:8123/alternative.html?mock=2', True, False),
        ])

    def test_stand_in_answers_with_its_timings_when_an_open_hangs(self):
        spec = importlib.util.spec_from_loader(
            'fake_claude', importlib.machinery.SourceFileLoader(
                'fake_claude', str(self.root / 'home/.local/bin/claude')))
        stand_in = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(stand_in)
        # Aven's browser command: the first open answers, the second never does.
        fake = self.root / 'fake-aven'
        count = self.root / 'opens'
        fake.write_text(
            f'#!{sys.executable}\n'
            'import json, sys, time\n'
            f'count = open({str(count)!r}, "a+"); count.write("x"); count.flush(); count.seek(0)\n'
            'if len(count.read()) > 1: time.sleep(30)\n'
            'print(json.dumps({"ok": True, "result": {"id": "page-1"}}))\n')
        fake.chmod(0o755)
        started = time.monotonic()
        with mock.patch.dict(os.environ, {'AVEN_BROWSER_EXECUTABLE': str(fake)}):
            reply = stand_in.pages_turn('http://127.0.0.1:8123/', budget=3, each=1)
        self.assertLess(time.monotonic() - started, 5)
        self.assertTrue(reply.startswith('AVEN_SMOKE_OK AVEN_PAGES FAILED open 2 got no answer in 1 s ['),
                        reply)
        first, second = json.loads(reply.split(' s ', 1)[1])
        self.assertEqual(first['id'], 'page-1')
        self.assertGreaterEqual(second['ms'], 900)
        # The whole run stays inside its budget, however many opens hang.
        with mock.patch.dict(os.environ, {'AVEN_BROWSER_EXECUTABLE': str(fake)}):
            started = time.monotonic()
            reply = stand_in.pages_turn('http://127.0.0.1:8123/', budget=1, each=5)
        self.assertLess(time.monotonic() - started, 3)
        self.assertIn('FAILED', reply)

    def test_stand_in_claude_writes_into_its_folder_as_a_race_lane(self):
        stand_in = self.root / 'home/.local/bin/claude'
        lane = self.root / 'lane'
        lane.mkdir()
        request = {'type': 'user', 'uuid': 'turn-7', 'message': {'role': 'user', 'content': [
            {'type': 'text', 'text': 'Build it. AVEN_SMOKE_RACE AVEN_SMOKE_FAIL_ONCE AVEN_SMOKE_HOLD 1200'}]}}
        chat = subprocess.run([str(stand_in), '--input-format', 'stream-json'], cwd=lane,
                              input=json.dumps(request) + '\n', capture_output=True, text=True, timeout=10)
        # Claude never fails on purpose; only the Grok lane does.
        self.assertEqual(json.loads(chat.stdout.splitlines()[-1])['result'], 'AVEN_SMOKE_OK')
        names = sorted(path.name for path in lane.iterdir())
        self.assertEqual(names[-1], 'race-claude.txt')
        self.assertGreaterEqual(sum(name.startswith('race-claude-late-') for name in names), 1)

    def test_stand_in_grok_fails_a_race_lane_once_then_writes_into_it(self):
        runner.add_race_stand_in(self.root)
        stand_in = self.root / 'home/.local/bin/grok'
        self.assertTrue(os.access(stand_in, os.X_OK))
        # Aven recognises Grok Build by its help or by naming itself.
        self.assertIn('Grok Build', stand_in.read_text())
        lane = self.root / 'lane'
        lane.mkdir()
        prompt = 'Build it. AVEN_SMOKE_RACE AVEN_SMOKE_FAIL_ONCE AVEN_SMOKE_HOLD 600'

        def turn():
            requests = '\n'.join(json.dumps({'jsonrpc': '2.0', **message}) for message in [
                {'id': 1, 'method': 'initialize', 'params': {'protocolVersion': 1}},
                {'id': 2, 'method': 'session/new', 'params': {'cwd': str(lane), 'mcpServers': []}},
                {'id': 3, 'method': 'session/prompt',
                 'params': {'sessionId': 's', 'prompt': [{'type': 'text', 'text': prompt}]}},
            ]) + '\n'
            out = subprocess.run([str(stand_in), '--no-auto-update', 'agent', '--no-leader', 'stdio'],
                                 cwd=lane, input=requests, capture_output=True, text=True, timeout=10)
            return [json.loads(line) for line in out.stdout.splitlines()]

        first = turn()
        self.assertEqual([m.get('id') for m in first], [1, 2, 3])
        self.assertIn('failed on purpose', first[-1]['error']['message'])
        self.assertFalse((lane / 'race-grok.txt').exists())
        second = turn()
        self.assertEqual(second[-1]['result'], {'stopReason': 'end_turn'})
        update = next(m for m in second if m.get('method') == 'session/update')
        self.assertEqual(update['params']['update']['content']['text'], 'AVEN_SMOKE_OK')
        self.assertTrue((lane / 'race-grok.txt').is_file())
        # Anything but `agent stdio` does nothing, as updates and probes expect.
        quiet = subprocess.run([str(stand_in), 'models'], capture_output=True, text=True, timeout=10)
        self.assertEqual((quiet.returncode, quiet.stdout), (0, ''))

    def test_project_gets_one_other_checkout_for_parallel_work(self):
        runner.add_parallel_copy(self.root)
        project = self.root / 'project'
        listing = subprocess.run(['git', 'worktree', 'list', '--porcelain'], cwd=project,
                                 capture_output=True, text=True, check=True, timeout=10).stdout
        paths = [line.split(' ', 1)[1] for line in listing.splitlines() if line.startswith('worktree ')]
        self.assertEqual([Path(path).resolve() for path in paths],
                         [project.resolve(), (self.root / 'copies/project-copy').resolve()])
        self.assertIn('branch refs/heads/aven-check-copy', listing)
        # The copy lives inside the throwaway folder, so cleanup removes it.
        runner.remove_smoke_folder(self.root)
        self.assertFalse(self.root.exists())

    def test_unmarked_folders_are_never_removed(self):
        other = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: other.rmdir() if other.exists() else None)
        runner.remove_smoke_folder(other)
        self.assertTrue(other.exists())

    def write_run(self, steps, spawned):
        (self.root / 'result.json').write_text(json.dumps({
            'passed': all(step['passed'] for step in steps), 'steps': steps}))
        log = self.root / 'home/.local/bin/fake-claude.log'
        log.write_text(''.join(json.dumps(entry) + '\n' for entry in spawned))

    def score(self, exit_code=0):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return runner.report_smoke(self.root, exit_code)

    def test_passes_only_when_a_chat_process_received_the_turn(self):
        chat = {'pid': 1, 'args': ['--input-format', 'stream-json', '--replay-user-messages'],
                'harnessParent': True}
        helper = {'pid': 2, 'args': ['--input-format', 'stream-json', '--no-session-persistence'],
                  'harnessParent': True}
        steps = [{'name': 'agent turn', 'passed': True}]
        self.write_run(steps, [chat, {'pid': 1, 'turn': 't'}])
        self.assertTrue(self.score())
        # A background helper's message is not the chat turn.
        self.write_run(steps, [chat, helper, {'pid': 2, 'turn': 't'}])
        self.assertFalse(self.score())
        # Not spawned by Aven's harness.
        self.write_run(steps, [{**chat, 'harnessParent': False}, {'pid': 1, 'turn': 't'}])
        self.assertFalse(self.score())

    def test_fails_on_a_failed_step_a_missing_result_or_a_bad_exit(self):
        chat = {'pid': 1, 'args': ['--replay-user-messages'], 'harnessParent': True}
        self.write_run([{'name': 'floating sidebar', 'passed': False, 'detail': 'stopped responding'}],
                       [chat, {'pid': 1, 'turn': 't'}])
        self.assertFalse(self.score())
        self.write_run([{'name': 'agent turn', 'passed': True}], [chat, {'pid': 1, 'turn': 't'}])
        self.assertFalse(self.score(exit_code=1))
        (self.root / 'result.json').unlink()
        self.assertFalse(self.score())

    def test_a_failed_run_prints_the_browser_calls_timings_and_aven_s_notes(self):
        chat = {'pid': 1, 'args': ['--replay-user-messages'], 'harnessParent': True}
        calls = [{'pid': 1, 'browser': 'open', 'url': 'http://127.0.0.1:8123/index.html?mock=1', 'ok': True, 'ms': 120},
                 {'pid': 1, 'browser': 'open', 'url': 'http://127.0.0.1:8123/?mock=1', 'ok': None, 'ms': 20004}]
        (self.root / 'app.log').write_text(
            'chromium noise\n'
            '[aven] Agent page open: 2001 ms for the page\'s running load (stopped it), then 4002 ms for its own (still loading)\n')
        self.write_run([{'name': "an agent's opens build on one page", 'passed': False, 'detail': 'open 2 got no answer'}],
                       [chat, {'pid': 1, 'turn': 't'}, *calls])
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            self.assertFalse(runner.report_smoke(self.root, 0))
        text = out.getvalue()
        self.assertIn('Stand-in browser calls:\n'
                      '    open http://127.0.0.1:8123/index.html?mock=1 - 120 ms, ok\n'
                      '    open http://127.0.0.1:8123/?mock=1 - 20004 ms, no answer\n', text)
        self.assertIn("From Aven's log:\n    [aven] Agent page open: 2001 ms", text)
        self.assertNotIn('chromium noise', text)
        # Chromium's own log says when it went to the keychain for its key.
        chromium_log = self.root / runner.SMOKE_CHROMIUM_LOG
        chromium_log.parent.mkdir(parents=True)
        chromium_log.write_text(
            '[1:2:1028/165059.917157:ERROR:components/password_manager/core/browser/password_store/'
            'login_database_async_helper.cc:99] Encryption is not available.\n')
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            self.assertFalse(runner.report_smoke(self.root, 0))
        self.assertIn('login_database_async_helper.cc:99] Encryption is not available.', out.getvalue())
        # A passing run prints none of it.
        self.write_run([{'name': 'agent turn', 'passed': True}], [chat, {'pid': 1, 'turn': 't'}, *calls])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertTrue(runner.report_smoke(self.root, 0))
        self.assertNotIn('Stand-in browser calls', out.getvalue())


class PerfReport(unittest.TestCase):
    def test_reports_launch_to_ready_and_to_visible(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'result.json').write_text(json.dumps({'passed': True, 'perf': {
                'refreshMs': 8.33, 'scenarios': [],
                'startup': {'readyAtEpochMs': 10_620, 'visibleAtEpochMs': 10_655}}}))
            out = io.StringIO()
            with mock.patch.object(runner, 'ROOT', root), contextlib.redirect_stdout(out):
                self.assertTrue(runner.report_perf(root, 10_000, None))
            self.assertIn('Launch to ready: 620 ms. Launch to visible: 655 ms.', out.getvalue())
            saved = json.loads(next((root / 'target/perf').glob('perf-*.json')).read_text())
            self.assertEqual(saved['startup']['launchToVisibleMs'], 655)


if __name__ == '__main__':
    unittest.main()
