#!/usr/bin/env python3
"""Live check: a hidden page's load signals in the real Chromium bridge.

Builds `src-tauri/chromium/browser_load_signals_test.mm` against this
checkout's bridge (run scripts/build-chromium.sh first), wraps it in a
throwaway app bundle with the pinned CEF runtime and the bridge's helper,
signs that bundle ad hoc, serves a small local page on 127.0.0.1 and runs the
check under a throwaway home. The page is hidden in a window that is never
shown; nothing takes the Dock, the menu bar or the keyboard, no keychain item
is read or written, and the folder is removed afterwards.

    ./scripts/with-dev-env.sh python3 scripts/check-chromium-loads.py
"""
from contextlib import contextmanager
from functools import partial
import http.server
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parent.parent
TARGET = 'supermono_chromium_browser_load_signals_test'
APP_NAME = 'Load Check'
HELPER_SUFFIXES = ['', ' (Alerts)', ' (GPU)', ' (Plugin)', ' (Renderer)']
PAGE = ('<!doctype html><html><head><meta charset="utf-8"><title>Aven load check</title>'
        '</head><body><h1>Aven load check</h1></body></html>\n')
# Chromium writes this when it could not get its key from the keychain, which
# under the throwaway home means the stand-in key switch did not reach it.
NO_ENCRYPTION = 'Encryption is not available'
TIMEOUT = 90


def require(ok, message):
    if not ok:
        raise SystemExit(message)


def plist(executable, identifier):
    return plistlib.dumps({
        'CFBundleExecutable': executable, 'CFBundleIdentifier': identifier,
        'CFBundleName': executable, 'CFBundlePackageType': 'APPL',
        'CFBundleInfoDictionaryVersion': '6.0', 'LSUIElement': True,
        'NSPrincipalClass': 'NSApplication',
    })


def macho(path):
    with path.open('rb') as stream:
        return stream.read(4) in (b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe')


def entitlements(folder, jit):
    values = {'com.apple.security.cs.disable-library-validation': True}
    if jit:
        values['com.apple.security.cs.allow-jit'] = True
    path = folder / ('jit.plist' if jit else 'helper.plist')
    path.write_bytes(plistlib.dumps(values))
    return path


def bundle(folder, build, cef_root):
    """The check's executable as an app, with CEF and its five helpers."""
    app = folder / f'{APP_NAME}.app'
    contents = app / 'Contents'
    (contents / 'MacOS').mkdir(parents=True)
    shutil.copy2(build / TARGET, contents / 'MacOS' / APP_NAME)
    (contents / 'Info.plist').write_bytes(plist(APP_NAME, 'com.capi.aven.dev.loadcheck'))
    frameworks = contents / 'Frameworks'
    frameworks.mkdir()
    framework = frameworks / 'Chromium Embedded Framework.framework'
    subprocess.run(['ditto', str(cef_root / 'Release/Chromium Embedded Framework.framework'),
                    str(framework)], check=True)
    helpers = []
    for suffix in HELPER_SUFFIXES:
        name = f'{APP_NAME} Helper{suffix}'
        helper = frameworks / f'{name}.app'
        (helper / 'Contents/MacOS').mkdir(parents=True)
        shutil.copy2(build / 'Aven Chromium Helper', helper / 'Contents/MacOS' / name)
        (helper / 'Contents/Info.plist').write_bytes(
            plist(name, 'com.capi.aven.dev.loadcheck.helper'))
        helpers.append((helper, suffix in (' (GPU)', ' (Renderer)')))
    subprocess.run(['xattr', '-cr', str(app)], check=True)
    sign = ['codesign', '--force', '--sign', '-', '--options', 'runtime', '--timestamp=none']
    for path in sorted(framework.rglob('*'), key=lambda p: len(p.parts), reverse=True):
        if path.is_file() and not path.is_symlink() and macho(path):
            subprocess.run(sign + [str(path)], check=True, capture_output=True)
    subprocess.run(sign + [str(framework)], check=True, capture_output=True)
    for helper, jit in helpers:
        subprocess.run(sign + ['--entitlements', str(entitlements(folder, jit)), str(helper)],
                       check=True, capture_output=True)
    subprocess.run(sign + ['--entitlements', str(entitlements(folder, False)), str(app)],
                   check=True, capture_output=True)
    return contents / 'MacOS' / APP_NAME


@contextmanager
def local_page(folder):
    """A small page on 127.0.0.1; nothing leaves this Mac."""
    site = folder / 'site'
    site.mkdir()
    (site / 'index.html').write_text(PAGE)
    quiet = type('Quiet', (http.server.SimpleHTTPRequestHandler,),
                 {'log_message': lambda *args: None})
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), partial(quiet, directory=str(site)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_address[1]}/'
    finally:
        server.shutdown()
        server.server_close()


def main():
    require(sys.platform == 'darwin', 'The Chromium load check needs macOS.')
    cef_root = Path(os.environ.get('CEF_ROOT', ''))
    require(cef_root.is_dir(), 'Set CEF_ROOT (scripts/with-dev-env.sh does) to the verified CEF SDK.')
    build = Path(os.environ.get('CEF_BUILD_DIR', ROOT / 'target/chromium'))
    require((build / 'build.ninja').is_file(), f'Run scripts/build-chromium.sh first; {build} is not configured.')
    cmake = os.environ.get('CMAKE', 'cmake')
    subprocess.run([cmake, '--build', str(build), '--target', TARGET, 'supermono_chromium_helper'],
                   check=True, stdout=subprocess.DEVNULL)
    folder = Path(tempfile.mkdtemp(prefix='aven-load-check-'))
    try:
        executable = bundle(folder, build, cef_root)
        home = folder / 'home'
        home.mkdir()
        cache = folder / 'cache'
        with local_page(folder) as base:
            env = {**os.environ, 'HOME': str(home)}
            done = subprocess.run([str(executable), base, str(cache)], env=env, text=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=TIMEOUT)
        lines = done.stdout.splitlines()
        steps = [line for line in lines if line.startswith(('PASS ', 'FAIL '))]
        log = cache / 'chromium.log'
        log_text = log.read_text(errors='replace') if log.is_file() else ''
        keychain = NO_ENCRYPTION not in log_text + done.stdout
        steps.append(('PASS' if keychain else 'FAIL') + '  Chromium uses its stand-in key - '
                     + ('encryption worked without the keychain' if keychain
                        else 'it went to the keychain, which the throwaway home does not have'))
        print('\n'.join(steps))
        passed = keychain and done.returncode == 0 and 'PASSED' in lines
        if not passed and done.returncode != 0:
            print(done.stdout[-4000:], file=sys.stderr)
        print('PASSED' if passed else 'FAILED')
        return 0 if passed else 1
    finally:
        shutil.rmtree(folder, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
