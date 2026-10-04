#!/usr/bin/env python3
"""Finish a release directory before publishing; never builds, signs or uploads.

`add-windows-update` adds the signed Windows installer to the macOS
`latest.json`. `add-stable-aliases` adds fixed-name copies of the main
downloads so `/releases/latest/download/<name>` links keep working. Both keep
the release `SHA256SUMS` covering every file they write.
"""
import argparse
import base64
import binascii
import hashlib
import json
from pathlib import Path
import re
import shutil
import urllib.parse

MAC_PLATFORM = 'darwin-aarch64'
# tauri-plugin-updater v2 looks for `{os}-{arch}-{installer}` first, then
# `{os}-{arch}`. Both name the same signed NSIS installer.
WINDOWS_PLATFORMS = ('windows-x86_64-nsis', 'windows-x86_64')
MAC_ALIAS = 'Aven-macos-arm64.zip'
WINDOWS_ALIAS = 'Aven-windows-x64-setup.exe'
VERSION = re.compile(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?')
INSTALLER = re.compile(r'Aven_(?P<version>[0-9A-Za-z.+-]+)_x64-setup\.exe')


def fail(message):
    raise SystemExit('Refusing to publish: ' + message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def refresh_checksums(folder, names):
    """Replace or add `SHA256SUMS` entries for `names`, keeping all others."""
    sums = folder / 'SHA256SUMS'
    lines = sums.read_text().splitlines() if sums.exists() else []
    kept = []
    for line in lines:
        match = re.fullmatch(r'[0-9a-fA-F]{64} [ *]([^/\\\r\n]+)', line)
        if match is None:
            fail('invalid release checksum entry')
        if match.group(1) not in names:
            kept.append(line)
    kept.extend(sha256(folder / name) + '  ' + name for name in names)
    sums.write_text('\n'.join(kept) + '\n')


def signature_text(path, signed_name):
    """Return the updater signature after checking it names the signed file."""
    if not path.is_file() or path.is_symlink():
        fail('the Windows updater signature is missing')
    encoded = path.read_text().strip()
    try:
        decoded = base64.b64decode(encoded, validate=True).decode()
    except (binascii.Error, UnicodeDecodeError):
        fail('the Windows updater signature is not a Tauri signature')
    comments = [line for line in decoded.splitlines() if line.startswith('trusted comment:')]
    if len(comments) != 1 or not re.search(r'(?:^|\t| )file:' + re.escape(signed_name) + r'$', comments[0]):
        fail('the Windows updater signature does not belong to ' + signed_name)
    return encoded


def add_windows_update(folder, version, installer, url_base):
    if not VERSION.fullmatch(version):
        fail('invalid release version')
    match = INSTALLER.fullmatch(installer)
    if match is None or match.group('version') != version:
        fail('unexpected Windows installer name ' + repr(installer))
    if not url_base.startswith('https://') or url_base.endswith('/'):
        fail('the Windows download URL base must be https without a trailing slash')
    if not (folder / installer).is_file() or (folder / installer).is_symlink():
        fail('the Windows installer is not in the release directory')
    manifest_path = folder / 'latest.json'
    manifest = json.loads(manifest_path.read_text())
    platforms = manifest.get('platforms')
    if manifest.get('version') != version or not isinstance(platforms, dict) or set(platforms) != {MAC_PLATFORM}:
        fail('latest.json must describe only this macOS release before adding Windows')
    entry = {
        'signature': signature_text(folder / (installer + '.sig'), installer),
        'url': url_base + '/' + urllib.parse.quote(installer),
    }
    for platform in WINDOWS_PLATFORMS:
        platforms[platform] = dict(entry)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    refresh_checksums(folder, ['latest.json'])


def add_stable_aliases(folder, version, windows_installer=None):
    if not VERSION.fullmatch(version):
        fail('invalid release version')
    aliases = [(folder / ('Aven-' + version + '-macos-arm64.zip'), MAC_ALIAS)]
    if windows_installer is not None:
        aliases.append((folder / windows_installer, WINDOWS_ALIAS))
    for source, alias in aliases:
        if not source.is_file() or source.is_symlink():
            fail('missing download for stable name ' + alias)
        if (folder / alias).exists():
            fail('stable download name already exists: ' + alias)
        # A real copy: GitHub release assets are uploaded file by file.
        shutil.copyfile(source, folder / alias)
    refresh_checksums(folder, [alias for _, alias in aliases])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    windows = commands.add_parser('add-windows-update')
    windows.add_argument('--release-dir', required=True, type=Path)
    windows.add_argument('--version', required=True)
    windows.add_argument('--installer', required=True)
    windows.add_argument('--url-base', required=True)
    aliases = commands.add_parser('add-stable-aliases')
    aliases.add_argument('--release-dir', required=True, type=Path)
    aliases.add_argument('--version', required=True)
    aliases.add_argument('--windows-installer')
    args = parser.parse_args()
    if args.command == 'add-windows-update':
        add_windows_update(args.release_dir, args.version, args.installer, args.url_base)
        print('Added the signed Windows update to latest.json.')
    else:
        add_stable_aliases(args.release_dir, args.version, args.windows_installer)
        print('Added stable download names.')


if __name__ == '__main__':
    main()
