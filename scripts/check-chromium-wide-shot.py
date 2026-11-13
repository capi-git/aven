#!/usr/bin/env python3
"""Live check: an agent's picture of a page at another width, in the real Chromium bridge.

Builds `src-tauri/chromium/browser_wide_shot_check_test.mm` against this
checkout's bridge (run scripts/build-chromium.sh first) into a throwaway app
bundle, as scripts/check-chromium-loads.py does, and serves a small responsive
page on 127.0.0.1: red when narrow, blue from 1000 px, with a picture only the
wide layout loads, which the server sends late. In a pane 480 wide the check
takes a picture at 1280 and at 1920, of the page hidden and then on screen. The
picture must show the wide layout with that late picture in it; the pane must
keep showing the narrow one, under a still picture of itself while Chromium
has the page's view at the other size; and afterwards the page must have its
pane's width and its scroll position. It runs under a throwaway home with
Chromium's stand-in key and no notifications, so nothing asks the person
anything, and the folder is removed afterwards.

For the second half a small red window sits in the bottom-left corner of the
screen for about three seconds; it takes no click and no key. That half needs
an unlocked Mac with its display on.

    ./scripts/with-dev-env.sh python3 scripts/check-chromium-wide-shot.py [--keep <folder for the pictures>]
"""
from contextlib import contextmanager
import http.server
import importlib.util
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zlib

ROOT = Path(__file__).resolve().parent.parent
TARGET = 'supermono_chromium_browser_wide_shot_check_test'
APP_NAME = 'Wide Shot Check'
BUNDLE_ID = 'com.capi.aven.dev.throwaway.chromium-wide-shot-check'
TIMEOUT = 120
# How late the server sends the picture only the wide layout asks for.
LATE = 0.6

PAGE = '''<!doctype html><html><head><meta charset="utf-8"><title>loading</title><style>
html, body { margin: 0 }
body { background: rgb(200, 30, 30) }
.top, .bottom { position: fixed; left: 0; right: 0; height: 40px }
.top { top: 0; background: rgb(240, 200, 0) }
.bottom { bottom: 0; background: rgb(150, 40, 200) }
.tall { height: 3000px }
.hero { position: absolute; left: 100px; top: 100px; width: 200px; height: 100px; display: block }
@media (min-width: 1000px) {
  body { background: rgb(30, 90, 200) }
  .tall { height: 200px }
}
</style></head><body>
<div class="top"></div><div class="bottom"></div>
<picture><source media="(min-width: 1000px)" srcset="/wide.png"><img class="hero" src="/narrow.png" alt=""></picture>
<div class="tall"></div>
<script>
let resizes = 0;
const say = () => { document.title = 'w' + innerWidth + ' y' + Math.round(scrollY) + ' r' + resizes; };
addEventListener('resize', () => { resizes += 1; say(); });
addEventListener('scroll', say);
say();
</script></body></html>
'''


def loads_check():
    """The load check's bundler, shared rather than copied."""
    spec = importlib.util.spec_from_file_location('check_chromium_loads', ROOT / 'scripts/check-chromium-loads.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def png(width, height, colour):
    """A small, real PNG in one colour."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    row = b'\x00' + bytes(colour) * width
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(row * height)) + chunk(b'IEND', b''))


@contextmanager
def responsive_site():
    """The page and its two pictures on 127.0.0.1; nothing leaves this Mac."""
    seen = {'wide': 0}
    narrow, wide = png(200, 100, (120, 120, 120)), png(200, 100, (20, 160, 60))

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, body, kind):
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == '/page.html':
                self.reply(PAGE.encode(), 'text/html; charset=utf-8')
            elif self.path == '/narrow.png':
                self.reply(narrow, 'image/png')
            elif self.path == '/wide.png':
                seen['wide'] += 1
                time.sleep(LATE)
                self.reply(wide, 'image/png')
            else:
                self.send_error(404)

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f'http://127.0.0.1:{server.server_address[1]}/', seen
    finally:
        server.shutdown()
        server.server_close()


def main():
    loads = loads_check()
    loads.require(sys.platform == 'darwin', 'The Chromium wide picture check needs macOS.')
    keep = None
    if '--keep' in sys.argv:
        loads.require(len(sys.argv) > sys.argv.index('--keep') + 1, 'Pass a folder after --keep.')
        keep = Path(sys.argv[sys.argv.index('--keep') + 1]).resolve()
        keep.mkdir(parents=True, exist_ok=True)
    cef_root = Path(os.environ.get('CEF_ROOT', ''))
    loads.require(cef_root.is_dir(), 'Set CEF_ROOT (scripts/with-dev-env.sh does) to the verified CEF SDK.')
    build = Path(os.environ.get('CEF_BUILD_DIR', ROOT / 'target/chromium'))
    loads.require((build / 'build.ninja').is_file(), f'Run scripts/build-chromium.sh first; {build} is not configured.')
    cmake = os.environ.get('CMAKE', 'cmake')
    subprocess.run([cmake, '--build', str(build), '--target', TARGET, 'supermono_chromium_helper'],
                   check=True, stdout=subprocess.DEVNULL)
    folder = Path(tempfile.mkdtemp(prefix='aven-wide-shot-check-'))
    try:
        executable = loads.bundle(folder, build, cef_root, TARGET, APP_NAME, BUNDLE_ID)
        home, cache = folder / 'home', folder / 'cache'
        home.mkdir()
        with responsive_site() as (base, seen):
            # Through LaunchServices: a window of an app started straight from
            # a shell that is not the person's own session never comes into
            # view, and the on-screen half needs it in view.
            app = executable.parent.parent.parent
            printed = folder / 'output.txt'
            command = ['open', '-n', '-W', '--stdout', str(printed), '--stderr', str(printed),
                       '--env', f'HOME={home}', '-a', str(app), '--args', base, str(cache),
                       str(keep or '')]
            try:
                returncode = subprocess.run(command, timeout=TIMEOUT).returncode
            except subprocess.TimeoutExpired:
                subprocess.run(['pkill', '-f', str(executable)], check=False)
                returncode = 1
        output = printed.read_text(errors='replace') if printed.is_file() else ''
        done = subprocess.CompletedProcess(command, returncode if 'PASSED' in output.splitlines() else 1, output)
        lines = done.stdout.splitlines()
        steps = [line for line in lines if line.startswith(('PASS ', 'FAIL '))]
        # Each of the four pictures from 1000 px up lays the page out wide once.
        asked = seen['wide'] == 4
        steps.append(('PASS' if asked else 'FAIL') + '  only the wide layout asked for its picture - '
                     + f"{seen['wide']} requests, each answered {int(LATE * 1000)} ms late")
        log_text = (cache / 'chromium.log').read_text(errors='replace') if (cache / 'chromium.log').is_file() else ''
        keychain = loads.NO_ENCRYPTION not in log_text + done.stdout
        steps.append(('PASS' if keychain else 'FAIL') + '  Chromium uses its stand-in key - '
                     + ('encryption worked without the keychain' if keychain else 'it went to the keychain'))
        alerts = not (folder / loads.ALERTS_LAUNCHED).exists()
        steps.append(('PASS' if alerts else 'FAIL') + '  Chromium never starts its notifications helper - '
                     + ('its Alerts helper was never launched' if alerts else 'it launched the Alerts helper'))
        print('\n'.join(steps))
        passed = asked and keychain and alerts and done.returncode == 0 and 'PASSED' in lines
        if not passed and done.returncode != 0:
            print(done.stdout[-4000:], file=sys.stderr)
        print('PASSED' if passed else 'FAILED')
        return 0 if passed else 1
    finally:
        shutil.rmtree(folder, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
