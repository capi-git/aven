#!/usr/bin/env python3
"""Build and run an isolated Aven Dev with the complete embedded browser.

Never replaces, launches, stops, or reads the data of the installed Aven app.
The only server this runner stops is its own Vite child.
"""
import argparse
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


def launch():
    require(port_is_available(), f'Port {PORT} is in use. Close its owning preview first; no process was stopped.')
    log_path = ROOT / 'target/aven-dev-vite.log'
    # Provider-scoped control credentials belong to the installed host, not the
    # development host. Aven Dev provisions its own connections for its agents.
    child_env = {key: value for key, value in os.environ.items()
                 if not key.startswith(('AVEN_BROWSER_', 'AVEN_CONTROL_', 'SUPERMONO_', 'MONOCODE_'))}
    child_env.pop('TAURI_CONFIG', None)
    child_env.pop('TAURI_DEV_HOST', None)
    app = None
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
            print('Opening Aven Dev. Quit its window to stop this preview. Installed Aven stays running.', flush=True)
            app = subprocess.Popen([str(APP / 'Contents/MacOS/aven')], cwd=ROOT, env=child_env,
                                   start_new_session=True)
            # Control-C must not force-quit a desktop app that may contain work.
            while app.poll() is None:
                try:
                    app.wait(timeout=.5)
                except subprocess.TimeoutExpired:
                    pass
                except KeyboardInterrupt:
                    print('Quit the Aven Dev window normally to finish this preview.', flush=True)
            require(app.returncode == 0, f'Aven Dev exited with status {app.returncode}.')
        finally:
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    print(f'Preview server {server.pid} is still stopping; no unrelated process was touched.', file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--doctor', action='store_true', help='Check local prerequisites without building or opening anything')
    parser.add_argument('--build-only', action='store_true', help='Build and package without opening the development app')
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
        if not args.build_only:
            launch()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Aven Dev: {error}', file=sys.stderr)
        sys.exit(1)
