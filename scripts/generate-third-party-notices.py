#!/usr/bin/env python3
"""Collect installed dependency license texts offline; fail on missing notices.

Run after npm ci and Cargo dependency resolution. Python 3.9+, Git/Rust tooling.
No network calls, credentials, global settings, or dependency writes are made.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'scripts/license-texts'
LICENSE_FILE = re.compile(r'^(?:licen[cs]e|copying|copyright|notice|unlicense)(?:[._-]|$)', re.I)
LICENSE_DIR = re.compile(r'^(?:licen[cs]es?|notices?)$', re.I)
FULL_TEXT = re.compile(r'Permission is hereby granted|Redistribution and use|TERMS AND CONDITIONS|Mozilla Public License|free and unencumbered software|Permission to use, copy|Creative Commons|altered source versions|THE WORK IS PROVIDED|Community Data License Agreement', re.I)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def license_files(root):
    found = []
    for path in sorted(root.iterdir()):
        if path.is_file() and LICENSE_FILE.match(path.name):
            found.append(path)
        elif path.is_dir() and LICENSE_DIR.fullmatch(path.name):
            found.extend(p for p in sorted(path.rglob('*')) if p.is_file())
    return found


def file_text(path):
    return path.read_text(encoding='utf-8-sig').replace('\r\n', '\n').strip() + '\n'


def repo_url(value):
    if isinstance(value, dict):
        value = value.get('url', '')
    return (value or '').removeprefix('git+').removesuffix('.git')


def package_record(ecosystem, name, version, license_name, source, authors, root):
    return {'id': ecosystem + ':' + name + '@' + version,
            'ecosystem': ecosystem, 'name': name, 'version': version,
            'license': license_name or 'Not declared', 'source': source,
            'authors': authors, 'root': root, 'notices': []}


def platform_allows(values, selected):
    if not values:
        return True
    positives = [v for v in values if not v.startswith('!')]
    return ('!' + selected) not in values and (not positives or selected in positives)


def npm_packages(missing, skipped, os_name, cpu):
    records = []
    lock = read_json(ROOT / 'package-lock.json')
    for relative, data in sorted(lock['packages'].items()):
        if not relative or data.get('dev'):
            continue
        if not platform_allows(data.get('os'), os_name) or not platform_allows(data.get('cpu'), cpu):
            skipped.append(relative + ' (other target platform)')
            continue
        root = ROOT / relative
        if not (root / 'package.json').is_file():
            missing.append(relative + ': installed package missing; run npm ci on the release platform')
            continue
        package = read_json(root / 'package.json')
        if package['version'] != data['version']:
            missing.append(relative + ': installed version does not match package-lock.json')
            continue
        author = package.get('author')
        if isinstance(author, dict):
            author = author.get('name', '')
        authors = [author] if isinstance(author, str) and author else []
        records.append(package_record('npm', package['name'], data['version'], data.get('license') or package.get('license'),
                                      repo_url(package.get('repository')) or 'https://www.npmjs.com/package/' + package['name'],
                                      authors, root))
    return records


def rust_packages(metadata, missing):
    nodes = {p['id']: p for p in metadata['resolve']['nodes']}
    pending = list(metadata['workspace_members'])
    included = set()
    while pending:
        current = pending.pop()
        if current in included:
            continue
        included.add(current)
        for dep in nodes[current]['deps']:
            if any(kind['kind'] != 'dev' for kind in dep['dep_kinds']):
                pending.append(dep['pkg'])
    records = []
    for package in metadata['packages']:
        if package['id'] not in included or package['id'] in metadata['workspace_members']:
            continue
        root = Path(package['manifest_path']).parent
        record = package_record('cargo', package['name'], package['version'], package.get('license'),
                                package.get('repository') or 'https://crates.io/crates/' + package['name'],
                                package.get('authors', []), root)
        record['source_archive'] = 'https://crates.io/api/v1/crates/' + package['name'] + '/' + package['version'] + '/download'
        if package.get('license_file'):
            explicit = root / package['license_file']
            if explicit.is_file():
                record['license_file'] = explicit
            else:
                missing.append(record['id'] + ': declared license_file is missing')
        records.append(record)
    # This Windows-only vendored crate is distributed in the source tree; include
    # its actual text even though the initial release target is Apple Silicon.
    vendor = ROOT / 'vendor/portable-pty'
    if vendor.is_dir() and not any(p['name'] == 'portable-pty' for p in records):
        manifest = (vendor / 'Cargo.toml').read_text()
        version = re.search(r'^version = "([^"]+)"', manifest, re.M).group(1)
        records.append(package_record('vendored', 'portable-pty', version, 'MIT',
                                      'https://github.com/wezterm/wezterm', ['Wez Furlong'], vendor))
    return records


def copyright_headers(root):
    """Keep existing source-header copyright notices for upstream text supplements."""
    results = set()
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.suffix not in ('.rs', '.c', '.h', '.js', '.ts'):
            continue
        try:
            with path.open(encoding='utf-8') as stream:
                lines = [line.rstrip() for _, line in zip(range(35), stream)]
        except UnicodeDecodeError:
            continue
        for line in lines:
            if re.search(r'copyright\s+(?:\(c\)\s*)?(?:\d{4}|[A-Z])', line, re.I):
                results.add(line.strip())
    return '\n'.join(sorted(results)) + '\n' if results else ''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', default='aarch64-apple-darwin')
    parser.add_argument('--npm-os', default='darwin')
    parser.add_argument('--npm-cpu', default='arm64')
    parser.add_argument('--cargo-metadata', type=Path, help='Previously generated cargo metadata JSON for this checkout/target')
    parser.add_argument('--output', type=Path, default=ROOT / 'THIRD_PARTY_NOTICES.txt')
    parser.add_argument('--report', type=Path, default=ROOT / 'target/third-party-notices-report.json')
    parser.add_argument('--check', action='store_true', help='Check existing aggregate without modifying it')
    args = parser.parse_args()
    missing, skipped = [], []
    if args.cargo_metadata:
        metadata = read_json(args.cargo_metadata)
    else:
        try:
            result = subprocess.run(['cargo', 'metadata', '--offline', '--locked', '--format-version', '1',
                                     '--filter-platform', args.target], cwd=ROOT, capture_output=True, text=True, check=True)
        except (OSError, subprocess.CalledProcessError):
            raise SystemExit('Could not resolve offline Cargo metadata. Install Rust and run cargo fetch --locked, then retry.')
        metadata = json.loads(result.stdout)
    if Path(metadata['workspace_root']).resolve() != ROOT.resolve():
        raise SystemExit('Cargo metadata belongs to another checkout; regenerate it here.')
    sources = read_json(CACHE / 'sources.json')['files']
    overrides = read_json(CACHE / 'overrides.json')
    for name, source in sources.items():
        path = CACHE / name
        if not path.is_file() or digest(path.read_bytes()) != source['sha256']:
            raise SystemExit('Cached upstream license text failed verification: ' + name)
    packages = npm_packages(missing, skipped, args.npm_os, args.npm_cpu) + rust_packages(metadata, missing)
    texts = {}
    for package in packages:
        root = package.pop('root')
        paths = license_files(root)
        explicit = package.pop('license_file', None)
        if explicit and explicit not in paths:
            paths.append(explicit)
        collected = []
        for path in paths:
            collected.append((str(path.relative_to(root)), file_text(path)))
        for name in overrides.get(package['id'], []):
            if name not in sources:
                raise SystemExit('Untracked upstream license supplement: ' + name)
            collected.append((sources[name]['url'], file_text(CACHE / name)))
        if package['name'] == '@napi-rs/canvas-darwin-arm64':
            companion = ROOT / 'node_modules/@napi-rs/canvas'
            meta = read_json(companion / 'package.json')
            if meta['version'] != package['version']:
                missing.append(package['id'] + ': companion package version mismatch')
            else:
                collected.append(('@napi-rs/canvas@' + package['version'] + '/LICENSE (same-project native package)', file_text(companion / 'LICENSE')))
        if package['id'] in overrides:
            headers = copyright_headers(root)
            if headers:
                collected.append(('Original package source copyright headers', headers))
        if not any(FULL_TEXT.search(text) and len(text) > 400 for _, text in collected):
            missing.append(package['id'] + ': complete license text not found; add a verified primary-source supplement')
        for source, text in collected:
            key = digest(text.encode())[:20]
            texts[key] = text
            package['notices'].append({'source': source, 'text': key})
    packages.sort(key=lambda p: (p['ecosystem'], p['name'].casefold(), p['version']))
    report = {'complete': not missing, 'target': args.target, 'npm_os': args.npm_os, 'npm_cpu': args.npm_cpu,
              'package_count': len(packages), 'unique_text_count': len(texts), 'missing': missing, 'skipped': skipped,
              'packages': packages}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    if missing:
        print(json.dumps({'complete': False, 'missing': missing, 'report': str(args.report)}, indent=2))
        return 1
    lines = ['AVEN THIRD-PARTY NOTICES', '',
             'Generated from the locked, installed dependencies by scripts/generate-third-party-notices.py.',
             'Target: ' + args.target + '; npm platform: ' + args.npm_os + '/' + args.npm_cpu + '.',
             'Includes production npm dependencies, non-dev Rust dependency graph (including build-time',
             'dependencies), and the source-distributed portable-pty crate. This is intentionally broader',
             'than only code retained after bundling. Other-platform optional npm binaries are excluded.',
             'CEF/Chromium notices and credits are distributed separately in Contents/Resources/Chromium.',
             'Aven and original application copyrights are in LICENSE and NOTICE.',
             'Copyright statements and complete license texts follow. Identical texts are shared by ID.',
             'Declared alternative licenses are preserved; supplying multiple texts does not remove alternatives.',
             'Package source links identify upstream/source archives, including MPL-covered source.', '',
             'DEPENDENCIES', '============', '']
    for package in packages:
        lines.extend([package['id'], 'Declared license: ' + str(package['license']), 'Source: ' + package['source']])
        if package.get('source_archive'):
            lines.append('Source archive: ' + package['source_archive'])
        if package['authors']:
            lines.append('Package author metadata: ' + '; '.join(package['authors']))
        for notice in package['notices']:
            lines.append('Text [' + notice['text'] + ']: ' + notice['source'])
        lines.append('')
    lines.extend(['LICENSE AND NOTICE TEXTS', '========================', ''])
    for key, text in sorted(texts.items()):
        lines.extend(['----- TEXT ' + key + ' -----', text.rstrip(), '----- END TEXT ' + key + ' -----', ''])
    output = '\n'.join(lines) + '\n'
    report['aggregate_sha256'] = digest(output.encode())
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    if args.check:
        if not args.output.is_file() or args.output.read_text() != output:
            raise SystemExit('Third-party notices are stale. Regenerate before packaging.')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding='utf-8')
    print(json.dumps({'complete': True, 'packages': len(packages), 'unique_texts': len(texts),
                      'output': str(args.output), 'sha256': report['aggregate_sha256']}, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
