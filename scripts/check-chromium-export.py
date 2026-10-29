#!/usr/bin/env python3
"""Live check: reading a page and saving its images in the real Chromium bridge.

Builds `src-tauri/chromium/browser_export_check_test.mm` against this
checkout's bridge (run scripts/build-chromium.sh first) into a throwaway app
bundle, as scripts/check-chromium-loads.py does, and serves a small article on
127.0.0.1. The article's page gives the browser a cookie, and two of its
images answer only to that cookie, the way a signed-in site's (Notion's) do.
The check reads the hidden page's main content, loads every image through the
page's own session and compares the bytes with what the server sent. It also
checks that an image the site refuses is reported, that a file over the size
limit stops loading, and that reading leaves the page as it was. It runs under
a throwaway home with Chromium's stand-in key and no notifications, so
nothing asks the person anything, and the folder is removed afterwards.

    ./scripts/with-dev-env.sh python3 scripts/check-chromium-export.py
"""
from contextlib import contextmanager
import hashlib
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
import zlib

ROOT = Path(__file__).resolve().parent.parent
TARGET = 'supermono_chromium_browser_export_check_test'
APP_NAME = 'Export Check'
BUNDLE_ID = 'com.capi.aven.dev.throwaway.chromium-export-check'
COOKIE = 'aven_check=let-me-in'
TIMEOUT = 120


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


ARTICLE = ('<!doctype html><html><head><meta charset="utf-8"><title>Field notes - Check site</title></head><body>'
           '<header><nav>Site menu <a href="/">Home</a></nav></header>'
           '<main><article><h1>Field notes</h1><p>Cookies keep the images private.</p>'
           '<figure><img src="/private/photo.png" alt="Photo"><figcaption>A private photo</figcaption></figure>'
           '<h2>Results</h2><p><img src="/private/chart.png" alt="Chart"> beside <img src="/public/logo.png" alt="Logo"></p>'
           '</article></main></body></html>\n')
IMAGES = {
    '/private/photo.png': png(64, 48, (200, 80, 40)),
    '/private/chart.png': png(32, 32, (20, 120, 220)),
    '/public/logo.png': png(16, 16, (0, 0, 0)),
}


@contextmanager
def article_site():
    """The article and its images on 127.0.0.1; nothing leaves this Mac."""
    seen = {'cookie': 0, 'refused': 0}

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, body, kind, headers=()):
            self.send_response(status)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            for name, value in headers:
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split('?')[0]
            cookie = COOKIE in (self.headers.get('Cookie') or '')
            if path == '/article.html':
                self.reply(200, ARTICLE.encode(), 'text/html; charset=utf-8',
                           [('Set-Cookie', f'{COOKIE}; Path=/; HttpOnly; SameSite=Lax')])
            elif path.startswith('/private/') and path in IMAGES:
                if cookie:
                    seen['cookie'] += 1
                    self.reply(200, IMAGES[path], 'image/png', [('Cache-Control', 'no-store')])
                else:
                    seen['refused'] += 1
                    self.reply(403, b'Sign in to see this image', 'text/plain')
            elif path in IMAGES:
                self.reply(200, IMAGES[path], 'image/png')
            elif path == '/public/large.bin':
                self.reply(200, os.urandom(2 * 1024 * 1024), 'application/octet-stream')
            elif path == '/private/expired.png':
                self.reply(403, b'This link has expired', 'text/plain')
            else:
                self.reply(404, b'Not found', 'text/plain')

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_address[1]}/', seen
    finally:
        server.shutdown()
        server.server_close()


def main():
    loads = loads_check()
    loads.require(sys.platform == 'darwin', 'The Chromium export check needs macOS.')
    cef_root = Path(os.environ.get('CEF_ROOT', ''))
    loads.require(cef_root.is_dir(), 'Set CEF_ROOT (scripts/with-dev-env.sh does) to the verified CEF SDK.')
    build = Path(os.environ.get('CEF_BUILD_DIR', ROOT / 'target/chromium'))
    loads.require((build / 'build.ninja').is_file(), f'Run scripts/build-chromium.sh first; {build} is not configured.')
    cmake = os.environ.get('CMAKE', 'cmake')
    subprocess.run([cmake, '--build', str(build), '--target', TARGET, 'supermono_chromium_helper'],
                   check=True, stdout=subprocess.DEVNULL)
    folder = Path(tempfile.mkdtemp(prefix='aven-export-check-'))
    try:
        executable = loads.bundle(folder, build, cef_root, TARGET, APP_NAME, BUNDLE_ID)
        home, cache, output = folder / 'home', folder / 'cache', folder / 'saved'
        for path in (home, output):
            path.mkdir()
        with article_site() as (base, seen):
            env = {**os.environ, 'HOME': str(home)}
            done = subprocess.run([str(executable), base, str(cache), str(output)], env=env, text=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=TIMEOUT)
        lines = done.stdout.splitlines()
        steps = [line for line in lines if line.startswith(('PASS ', 'FAIL '))]
        same = True
        for path, expected in IMAGES.items():
            saved = output / Path(path).name
            ok = saved.is_file() and hashlib.sha256(saved.read_bytes()).digest() == hashlib.sha256(expected).digest()
            same &= ok
            steps.append(('PASS' if ok else 'FAIL') + f'  the saved {Path(path).name} is the image the server sent - '
                         + (f'{len(expected)} bytes match' if ok else 'missing or different'))
        gated = seen['cookie'] >= 2
        steps.append(('PASS' if gated else 'FAIL') + '  the private images were loaded with the page\'s cookie - '
                     + f"{seen['cookie']} answered with it, {seen['refused']} refused without it")
        log_text = (cache / 'chromium.log').read_text(errors='replace') if (cache / 'chromium.log').is_file() else ''
        keychain = loads.NO_ENCRYPTION not in log_text + done.stdout
        steps.append(('PASS' if keychain else 'FAIL') + '  Chromium uses its stand-in key - '
                     + ('encryption worked without the keychain' if keychain else 'it went to the keychain'))
        alerts = not (folder / loads.ALERTS_LAUNCHED).exists()
        steps.append(('PASS' if alerts else 'FAIL') + '  Chromium never starts its notifications helper - '
                     + ('its Alerts helper was never launched' if alerts else 'it launched the Alerts helper'))
        print('\n'.join(steps))
        passed = same and gated and keychain and alerts and done.returncode == 0 and 'PASSED' in lines
        if not passed and done.returncode != 0:
            print(done.stdout[-4000:], file=sys.stderr)
        print('PASSED' if passed else 'FAILED')
        return 0 if passed else 1
    finally:
        shutil.rmtree(folder, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
