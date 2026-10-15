#!/usr/bin/env python3
"""Build and run an isolated Aven Dev with the complete embedded browser.

Never replaces, launches, stops, or reads the data of the installed Aven app.
The only server this runner stops is its own Vite child.
"""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'target/debug/Aven Dev.app'
IDENTITY = 'com.capi.aven.dev'
PORT = 1420


def run(*args):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def doctor():
    require(sys.platform == 'darwin' and os.uname().machine == 'arm64',
            'The complete Aven Dev browser currently requires an Apple Silicon Mac.')
    missing = [name for name in ('node', 'npm', 'cargo', 'rustc', 'codesign', 'ditto', 'xcrun')
               if not shutil.which(name)]
    for variable, default in (('CMAKE', 'cmake'), ('NINJA', 'ninja')):
        if not shutil.which(os.environ.get(variable, default)):
            missing.append(variable)
    require(not missing, 'Missing tools: ' + ', '.join(missing) + '. See docs/DEVELOPMENT.md.')
    require(Path(os.environ.get('CEF_ROOT', '')) .joinpath('include/cef_version.h').is_file(),
            'Set CEF_ROOT to the verified SDK; see docs/CHROMIUM.md.')
    require((ROOT / 'node_modules/.bin/vite').is_file(), 'Run npm ci before developing Aven.')
    target = Path(os.environ.get('CARGO_TARGET_DIR', ROOT / 'target')).resolve()
    require(target == ROOT / 'target', 'Unset CARGO_TARGET_DIR; Aven Dev uses this checkout target/.')
    require(not os.environ.get('CARGO_BUILD_TARGET'), 'Unset CARGO_BUILD_TARGET for native development.')
    require(not os.environ.get('TAURI_CONFIG'), 'Unset TAURI_CONFIG; the development identity and URL are managed by Aven.')
    config = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())
    require(config['identifier'] != IDENTITY, 'Production and development identities must differ.')
    print('Build tools ready. Aven Dev uses separate chats, settings, and browser data.', flush=True)


def ensure_not_running():
    processes = subprocess.check_output(['ps', '-axo', 'comm='], text=True).splitlines()
    require(not any(line.strip().startswith(str(APP) + '/') for line in processes),
            'Aven Dev is already running. Quit its window normally before rebuilding.')


def port_is_available():
    with socket.socket() as probe:
        # Match Vite's bind behavior: a closed preview's TIME_WAIT sockets do
        # not own the port. A live listener still refuses this bind.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(('127.0.0.1', PORT))
            return True
        except OSError:
            return False


def prepare_bundle():
    require(APP.resolve().is_relative_to((ROOT / 'target').resolve())
            and not any(parent.name == 'Applications' for parent in APP.resolve().parents),
            'Development bundle must stay inside this checkout target/ and outside Applications.')
    require(not APP.is_symlink(), 'Unexpected symlink at the development bundle path.')
    ensure_not_running()
    run(ROOT / 'scripts/build-chromium.sh')
    run('cargo', 'build', '--locked', '-p', 'aven', '--bin', 'aven')
    version = json.loads((ROOT / 'package.json').read_text())['version']
    # This exact generated bundle is replaceable; never target /Applications.
    if APP.exists():
        shutil.rmtree(APP)
    contents = APP / 'Contents'
    (contents / 'MacOS').mkdir(parents=True)
    (contents / 'Resources').mkdir()
    shutil.copy2(ROOT / 'target/debug/aven', contents / 'MacOS/aven')
    # Saved prompts may still invoke the old executable path. Keep this alias
    # relative so it follows this bundle when the candidate is moved.
    (contents / 'MacOS/monocode').symlink_to('aven')
    shutil.copy2(ROOT / 'src-tauri/icons/icon.icns', contents / 'Resources/icon.icns')
    info = plistlib.loads((ROOT / 'src-tauri/Info.plist').read_bytes())
    info.update(CFBundleIdentifier=IDENTITY, CFBundleName='Aven Dev', CFBundleDisplayName='Aven Dev',
                CFBundleExecutable='aven', CFBundleIconFile='icon.icns',
                CFBundleShortVersionString=version, CFBundleVersion=version,
                CFBundlePackageType='APPL', CFBundleInfoDictionaryVersion='6.0',
                LSMinimumSystemVersion='13.0', NSHighResolutionCapable=True)
    (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
    (contents / 'PkgInfo').write_bytes(b'APPL????')
    run('python3', ROOT / 'scripts/generate-third-party-notices.py')
    run('python3', ROOT / 'scripts/package-chromium.py', '--app', APP,
        '--identity', os.environ.get('AVEN_DEV_SIGNING_IDENTITY', '-'), '--execute')
    print(f'Ready: {APP}', flush=True)


def prepare_desktop_fixture():
    """A separate passive AppKit process, built only for the opt-in test."""
    fixture = ROOT / 'target/debug/Aven Input Fixture.app/Contents'
    (fixture / 'MacOS').mkdir(parents=True, exist_ok=True)
    run('xcrun', 'swiftc', ROOT / 'scripts/desktop-input-fixture.swift',
        '-o', fixture / 'MacOS/aven-input-fixture')
    (fixture / 'Info.plist').write_bytes(plistlib.dumps({
        'CFBundleIdentifier': 'com.capi.aven.dev.input-fixture',
        'CFBundleName': 'Aven Input Fixture', 'CFBundleExecutable': 'aven-input-fixture',
        'CFBundlePackageType': 'APPL', 'LSUIElement': True,
    }))


def host_scoped_environment():
    """This shell's environment without the installed host's credentials."""
    # Provider-scoped control credentials belong to the installed host, not the
    # development host. Aven Dev provisions its own connections for its agents.
    child_env = {key: value for key, value in os.environ.items()
                 if not key.startswith(('AVEN_BROWSER_', 'AVEN_CONTROL_', 'SUPERMONO_', 'MONOCODE_'))}
    child_env.pop('TAURI_CONFIG', None)
    child_env.pop('TAURI_DEV_HOST', None)
    return child_env


@contextmanager
def development_server(child_env):
    """Run this checkout's Vite server; only this child is ever stopped."""
    require(port_is_available(), f'Port {PORT} is in use. Close its owning preview first; no process was stopped.')
    log_path = ROOT / 'target/aven-dev-vite.log'
    with log_path.open('w') as log:
        server = subprocess.Popen(['npm', 'run', 'dev', '--', '--host', '127.0.0.1'],
                                  cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                  env=child_env, start_new_session=True)
        try:
            for _ in range(100):
                require(server.poll() is None, f'Development server stopped; inspect {log_path}')
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}', timeout=.2) as response:
                        if response.status == 200:
                            break
                except (OSError, TimeoutError):
                    time.sleep(.1)
            else:
                raise RuntimeError(f'Development server did not become ready; inspect {log_path}')
            yield server
        finally:
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    print(f'Preview server {server.pid} is still stopping; no unrelated process was touched.', file=sys.stderr)


def launch():
    child_env = host_scoped_environment()
    cursor_preview = child_env.pop('AVEN_DEV_CURSOR_PREVIEW', None) == '1'
    presence_preview = child_env.pop('AVEN_DEV_PRESENCE_PREVIEW', None) == '1'
    desktop_self_test = child_env.pop('AVEN_DEV_DESKTOP_SELF_TEST', None) == '1'
    browser_layout_trace = child_env.pop('AVEN_DEV_BROWSER_LAYOUT_TRACE', None) == '1'
    with development_server(child_env):
        # Recheck immediately before -n so an app opened while the server
        # was starting does not get a second instance.
        ensure_not_running()
        print('Opening Aven Dev. Quit its window to stop this preview. Installed Aven stays running.', flush=True)
        # A GUI app must enter through LaunchServices so privacy requests
        # are attributed to Aven Dev instead of the app hosting this shell.
        # start_new_session alone isolates signals, not TCC responsibility.
        # An absolute bundle path also avoids resolving another checkout or
        # the installed app by its shared executable name.
        launch_args = ['/usr/bin/open', '-W', '-n']
        # LaunchServices does not inherit this shell's opt-in. Forward only
        # the exact visual-only preview flag, never host control credentials.
        if cursor_preview:
            launch_args.extend(['--env', 'AVEN_DEV_CURSOR_PREVIEW=1'])
        if desktop_self_test:
            launch_args.extend(['--env', 'AVEN_DEV_DESKTOP_SELF_TEST=1'])
        if presence_preview:
            launch_args.extend(['--env', 'AVEN_DEV_PRESENCE_PREVIEW=1'])
        if browser_layout_trace:
            launch_args.extend(['--env', 'AVEN_DEV_BROWSER_LAYOUT_TRACE=1'])
        launch_args.extend(['-a', str(APP)])
        launcher = subprocess.Popen(launch_args,
                                    cwd=ROOT, env=child_env, start_new_session=True)
        # Control-C must not force-quit a desktop app that may contain work.
        while launcher.poll() is None:
            try:
                launcher.wait(timeout=.5)
            except subprocess.TimeoutExpired:
                pass
            except KeyboardInterrupt:
                print('Quit the Aven Dev window normally to finish this preview.', flush=True)
        # open reports launch/wait errors, not the app's process exit code.
        require(launcher.returncode == 0,
                f'Could not open or wait for Aven Dev (status {launcher.returncode}).')


SMOKE_MARKER = '.aven-smoke'
SMOKE_TIMEOUT = 240


def prepare_smoke_folder():
    """A throwaway home with a stand-in `claude` and an empty project.

    Aven finds providers through the login shell's PATH and then fixed folders
    such as ~/.local/bin; both lead to the stand-in. Nothing here touches the
    developer's own home, chats, settings or provider accounts.
    """
    root = Path(tempfile.mkdtemp(prefix='aven-smoke-'))
    (root / SMOKE_MARKER).write_text('Aven Dev real-app check\n')
    home = root / 'home'
    stand_in_dir = home / '.local/bin'
    stand_in_dir.mkdir(parents=True)
    (root / 'project').mkdir()
    (root / 'project/README.md').write_text('Aven Dev real-app check project.\n')
    stand_in = stand_in_dir / 'claude'
    shutil.copy2(ROOT / 'scripts/smoke/fake-claude.py', stand_in)
    stand_in.chmod(0o755)
    (home / '.zshrc').write_text(f'export PATH="{stand_in_dir}:/usr/bin:/bin:/usr/sbin:/sbin"\n')
    return root


def remove_smoke_folder(root):
    # Only a folder this runner created and marked.
    if root.is_dir() and (root / SMOKE_MARKER).is_file():
        shutil.rmtree(root, ignore_errors=True)


def stop_stand_ins(root):
    """End any stand-in still running from this run's folder."""
    marker = str(root / 'home/.local/bin/claude')
    for line in subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True).splitlines():
        pid, _, command = line.strip().partition(' ')
        if marker in command and pid.isdigit():
            try:
                os.kill(int(pid), signal.SIGTERM)
            except ProcessLookupError:
                pass


def smoke(keep=False):
    """Run Aven Dev's real-app check and return whether it passed."""
    root = prepare_smoke_folder()
    passed = False
    try:
        child_env = host_scoped_environment()
        with development_server(child_env):
            ensure_not_running()
            print('Running the real-app check in a throwaway profile...', flush=True)
            app_env = {
                **child_env,
                'HOME': str(root / 'home'),
                'SHELL': '/bin/zsh',
                'PATH': f'{root / "home/.local/bin"}:/usr/bin:/bin:/usr/sbin:/sbin',
                'AVEN_DEV_SMOKE_DIR': str(root),
            }
            # Launched directly: the check needs no privacy permission, and this
            # keeps the throwaway HOME and a timeout under the runner's control.
            with (root / 'app.log').open('w') as log:
                app = subprocess.Popen([str(APP / 'Contents/MacOS/aven')], env=app_env,
                                       stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True)
                try:
                    app.wait(timeout=SMOKE_TIMEOUT)
                except subprocess.TimeoutExpired:
                    os.killpg(app.pid, signal.SIGTERM)
                    try:
                        app.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(app.pid, signal.SIGKILL)
                    print(f'The check did not finish within {SMOKE_TIMEOUT} seconds.', file=sys.stderr)
        stop_stand_ins(root)
        passed = report_smoke(root, app.returncode)
        return passed
    finally:
        if passed and not keep:
            remove_smoke_folder(root)
        else:
            print(f'Kept the check\'s folder for inspection: {root}', flush=True)


PERF_MARKER = '.aven-perf'
PERF_TIMEOUT = 900
PERF_PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Speed test page</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#222}
pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow:auto}</style></head><body>
<h1>Speed test page</h1>
""" + "\n".join(
    f"<h2>Section {index}</h2><p>Aven's speed test opens this page in the built-in browser and switches to it and "
    f"away from it. The page is plain and static so the numbers reflect Aven, not the page.</p>"
    f"<pre>function section{index}(rows) {{ return rows.filter(Boolean).map(String); }}</pre>"
    for index in range(1, 41)
) + "</body></html>"


@contextmanager
def production_preview_server(child_env):
    """Serve a production build of the interface, as releases run it."""
    require(port_is_available(), f'Port {PORT} is in use. Close its owning preview first; no process was stopped.')
    out_dir = ROOT / 'target/perf-dist'
    log_path = ROOT / 'target/aven-perf-vite.log'
    with log_path.open('w') as log:
        subprocess.run(['npx', 'vite', 'build', '--outDir', str(out_dir), '--emptyOutDir'],
                       cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True,
                       env={**child_env, 'VITE_AVEN_PERF': '1'})
        server = subprocess.Popen(['npx', 'vite', 'preview', '--outDir', str(out_dir),
                                   '--host', '127.0.0.1', '--port', str(PORT), '--strictPort'],
                                  cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                  env=child_env, start_new_session=True)
        try:
            for _ in range(100):
                require(server.poll() is None, f'Preview server stopped; inspect {log_path}')
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}', timeout=.2) as response:
                        if response.status == 200:
                            break
                except (OSError, TimeoutError):
                    time.sleep(.1)
            else:
                raise RuntimeError(f'Preview server did not become ready; inspect {log_path}')
            yield server
        finally:
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass


@contextmanager
def static_page_server(folder):
    """A local web page for the browser scenarios; nothing leaves this Mac."""
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1',
                               '--directory', str(folder)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        yield f'http://127.0.0.1:{port}/index.html'
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


def perf(keep=False, compare=None):
    """Run Aven Dev's speed test and print what each scenario cost."""
    # macOS scans a newly signed app on its first launch (about 1.5 s here),
    # which users pay once per update. Absorb it so launch time is Aven's own.
    subprocess.run([str(APP / 'Contents/MacOS/aven'), '--version'],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    root = prepare_smoke_folder()
    (root / PERF_MARKER).write_text('Aven Dev speed test\n')
    (root / 'site').mkdir()
    (root / 'site/index.html').write_text(PERF_PAGE)
    finished = False
    try:
        child_env = host_scoped_environment()
        with production_preview_server(child_env), static_page_server(root / 'site') as page_url:
            (root / 'perf.json').write_text(json.dumps({'pageUrl': page_url}))
            ensure_not_running()
            print('Running the speed test in a throwaway profile (a few minutes)...', flush=True)
            app_env = {
                **child_env,
                'HOME': str(root / 'home'),
                'SHELL': '/bin/zsh',
                'PATH': f'{root / "home/.local/bin"}:/usr/bin:/bin:/usr/sbin:/sbin',
                'AVEN_DEV_SMOKE_DIR': str(root),
            }
            launched_at = time.time() * 1000
            with (root / 'app.log').open('w') as log:
                app = subprocess.Popen([str(APP / 'Contents/MacOS/aven')], env=app_env,
                                       stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True)
                try:
                    app.wait(timeout=PERF_TIMEOUT)
                except subprocess.TimeoutExpired:
                    os.killpg(app.pid, signal.SIGTERM)
                    try:
                        app.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(app.pid, signal.SIGKILL)
                    print(f'The speed test did not finish within {PERF_TIMEOUT} seconds.', file=sys.stderr)
        stop_stand_ins(root)
        finished = report_perf(root, launched_at, compare)
        return finished
    finally:
        if finished and not keep:
            remove_smoke_folder(root)
        else:
            print(f'Kept the test\'s folder for inspection: {root}', flush=True)


def report_perf(root, launched_at, compare):
    try:
        result = json.loads((root / 'result.json').read_text())
    except (OSError, ValueError):
        print(f'No result was written; see {root / "app.log"}.', file=sys.stderr)
        return False
    report = result.get('perf') or {}
    startup = report.get('startup') or {}
    if startup.get('readyAtEpochMs'):
        startup['launchToReadyMs'] = round(startup['readyAtEpochMs'] - launched_at)
    out_dir = ROOT / 'target/perf'
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / time.strftime('perf-%Y%m%d-%H%M%S.json')
    out_path.write_text(json.dumps(report, indent=2))
    previous = {}
    if compare:
        try:
            previous = {item['name']: item for item in json.loads(Path(compare).read_text()).get('scenarios', [])}
        except (OSError, ValueError, KeyError):
            print(f'Could not read {compare} for comparison.', file=sys.stderr)

    def cell(value, before=None, unit=''):
        if value is None:
            return '-'
        text = f'{value:g}{unit}'
        if before is not None and before != value:
            text += f' ({value - before:+g})'
        return text

    print(f'Display frame interval: {report.get("refreshMs")} ms. '
          f'Launch to ready: {startup.get("launchToReadyMs", "-")} ms.')
    header = f'{"scenario":40} {"input→frame p50/p95/max ms":28} {"slow frames":12} {"worst frame":12} {"CPU %":10} {"wakeups/s":12} {"memory MB":12}'
    print(header)
    print('-' * len(header))
    for item in report.get('scenarios', []):
        old = previous.get(item['name'], {})
        inter = item.get('interactions') or {}
        latency = f'{inter.get("p50", "-")}/{inter.get("p95", "-")}/{inter.get("max", "-")}' if inter else '-'
        frames = item.get('frames') or {}
        slow = f'{frames.get("slow")}/{frames.get("n")}' if frames else '-'
        long_text = f'{frames.get("max")} ms' if frames else '-'
        proc = item.get('processes') or {}
        old_proc = old.get('processes') or {}
        print(f'{item["name"][:40]:40} {latency:28} {slow:12} {long_text:14} '
              f'{cell(proc.get("cpuPct"), old_proc.get("cpuPct")):10} '
              f'{cell(proc.get("idleWakeupsPerSec"), old_proc.get("idleWakeupsPerSec")):12} '
              f'{cell(proc.get("footprintMB"), old_proc.get("footprintMB")):12}'
              + (f'  (window hidden {item["hiddenMs"] / 1000:.0f} s: timings unreliable)' if item.get('hiddenMs', 0) > 250 else '')
              + (f'  ERROR: {item["error"]}' if item.get('error') else ''))
    scenarios = report.get('scenarios', [])
    if scenarios:
        last = scenarios[-1]
        kinds = (last.get('processes') or {}).get('byKind') or {}
        parts = [f'{kind} {info["footprintMB"]:g} MB ({info["count"]})' for kind, info in sorted(kinds.items())]
        print(f'Memory at the end, by process: {", ".join(parts)}; '
              f'agents and shells Aven started: {(last.get("processes") or {}).get("startedFootprintMB")} MB')
    for step in result.get('steps', []):
        if not step.get('passed'):
            print(f'  FAIL  {step.get("name")} - {step.get("detail")}', flush=True)
    print(f'Saved: {out_path}', flush=True)
    return result.get('passed') is True


def report_smoke(root, exit_code):
    result_path = root / 'result.json'
    try:
        result = json.loads(result_path.read_text())
    except (OSError, ValueError):
        print(f'No result was written (app exit status {exit_code}); see {root / "app.log"}.', file=sys.stderr)
        return False
    for step in result.get('steps', []):
        mark = 'PASS' if step.get('passed') else 'FAIL'
        detail = f' - {step["detail"]}' if step.get('detail') else ''
        print(f'  {mark}  {step.get("name")}{detail}', flush=True)
    # Evidence that the turn went through Aven's own native harness spawn.
    log_path = root / 'home/.local/bin/fake-claude.log'
    spawned = []
    if log_path.is_file():
        spawned = [json.loads(line) for line in log_path.read_text().splitlines() if line.strip()]
    # A chat process (not a background helper) that Aven's harness spawned
    # and that then received the message.
    chats = {entry['pid'] for entry in spawned
             if entry.get('harnessParent') and '--replay-user-messages' in entry.get('args', [])}
    native_turn = any(entry.get('turn') and entry.get('pid') in chats for entry in spawned)
    print(f'  {"PASS" if native_turn else "FAIL"}  stand-in chat received the turn from Aven\'s harness', flush=True)
    passed = result.get('passed') is True and native_turn and exit_code == 0
    print('Real-app check passed.' if passed else 'Real-app check FAILED.', flush=True)
    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--doctor', action='store_true', help='Check local prerequisites without building or opening anything')
    parser.add_argument('--build-only', action='store_true', help='Build and package without opening the development app')
    parser.add_argument('--smoke', action='store_true',
                        help='Run the real-app check in a throwaway profile, then exit with its result')
    parser.add_argument('--keep-smoke-folder', action='store_true', help='Keep the check\'s throwaway folder')
    parser.add_argument('--perf', action='store_true',
                        help='Run the speed test (production interface, throwaway profile) and print what each scenario cost')
    parser.add_argument('--perf-compare', metavar='FILE', help='A saved speed test result to compare against')
    args = parser.parse_args()
    doctor()
    if args.doctor:
        return
    (ROOT / 'target').mkdir(exist_ok=True)
    with (ROOT / 'target/aven-dev.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('An Aven Dev build or preview is already running in this checkout.')
        ensure_not_running()
        if not args.build_only:
            require(port_is_available(), f'Port {PORT} is in use. No process was stopped.')
        prepare_bundle()
        if os.environ.get('AVEN_DEV_DESKTOP_SELF_TEST') == '1':
            prepare_desktop_fixture()
        if args.smoke:
            if not smoke(keep=args.keep_smoke_folder):
                raise RuntimeError('The real-app check failed.')
        elif args.perf:
            if not perf(keep=args.keep_smoke_folder, compare=args.perf_compare):
                raise RuntimeError('The speed test did not finish cleanly.')
        elif not args.build_only:
            launch()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Aven Dev: {error}', file=sys.stderr)
        sys.exit(1)
