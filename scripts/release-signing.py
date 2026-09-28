#!/usr/bin/env python3
"""Select and verify Aven's stable release signing identity without reading secrets.

Developer ID releases must keep the public team and bundle contract in
release-signing.json. Ad-hoc builds are explicitly local tests, never updates.
No keychain modification, app launch, installation, or notarization is performed.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
POLICY = ROOT / 'scripts/release-signing.json'
HELPERS = [('', ''), (' (Alerts)', '.alerts'), (' (GPU)', '.gpu'),
           (' (Plugin)', '.plugin'), (' (Renderer)', '.renderer')]
UPDATER_ENV = ('TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PATH',
               'TAURI_SIGNING_PRIVATE_KEY_PASSWORD')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def policy():
    value = json.loads(POLICY.read_text())
    require(isinstance(value.get('teamId'), str)
            and re.fullmatch(r'[A-Z0-9]{10}', value['teamId']), 'Invalid release teamId')
    require(isinstance(value.get('bundleId'), str)
            and re.fullmatch(r'[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+', value['bundleId']),
            'Invalid release bundleId')
    return value


def command(arguments):
    result = subprocess.run([str(arg) for arg in arguments], capture_output=True, text=True)
    require(result.returncode == 0, 'Command failed: ' + str(arguments[0])
            + '\n' + result.stderr.strip())
    return result.stdout + result.stderr


def select_identity(output, team_id, selector=''):
    # -v means valid identities only. Reject any line with an error suffix too.
    identities = {}
    for line in output.splitlines():
        match = re.fullmatch(r'\s*\d+\) ([0-9A-Fa-f]{40}) "([^"]+)"\s*', line)
        if match:
            fingerprint, name = match.groups()
            if name.startswith('Developer ID Application: ') and name.endswith(' (' + team_id + ')'):
                identities[fingerprint.upper()] = name
    if selector:
        selected = [(fingerprint, name) for fingerprint, name in identities.items()
                    if selector == name or selector.upper() == fingerprint]
        require(bool(selected), 'AVEN_RELEASE_SIGNING_IDENTITY must select a valid Developer ID '
                'Application identity for team ' + team_id + '; no matching identity was found.')
    else:
        selected = list(identities.items())
        require(bool(selected), 'No valid Developer ID Application identity for team ' + team_id
                + '. Install its certificate and private key, or use --ad-hoc for a local test only.')
    require(len(selected) == 1, 'Multiple matching Developer ID identities; set '
            'AVEN_RELEASE_SIGNING_IDENTITY to the exact certificate SHA-1 fingerprint.')
    return selected[0][0]


def preflight(ad_hoc=False, environment=None):
    environment = os.environ if environment is None else environment
    contract = policy()
    if ad_hoc:
        require(not any(environment.get(name) for name in UPDATER_ENV),
                'Ad-hoc local tests cannot use updater signing credentials; unset TAURI_SIGNING_* variables.')
        require(not environment.get('AVEN_RELEASE_SIGNING_IDENTITY')
                and not environment.get('AVEN_RELEASE_KEYCHAIN'),
                'Ad-hoc local tests cannot specify a Developer ID identity or keychain.')
        return '-'
    arguments = ['security', 'find-identity', '-v', '-p', 'codesigning']
    keychain = environment.get('AVEN_RELEASE_KEYCHAIN')
    if keychain:
        keychain_path = Path(keychain).expanduser().resolve()
        require(keychain_path.is_file(), 'AVEN_RELEASE_KEYCHAIN does not name an existing keychain file.')
        arguments.append(keychain_path)
    return select_identity(command(arguments), contract['teamId'],
                           environment.get('AVEN_RELEASE_SIGNING_IDENTITY', ''))


def check_output_directory(output, version, environment=None):
    environment = os.environ if environment is None else environment
    require(re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version), 'Invalid release version')
    require(not output.is_symlink(), 'Release output directory cannot be a symlink.')
    updater_names = ('Aven-' + version + '-macos-arm64.app.tar.gz',
                     'Aven-' + version + '-macos-arm64.app.tar.gz.sig', 'latest.json')
    if any((output / name).exists() or (output / name).is_symlink() for name in updater_names):
        require(environment.get('TAURI_SIGNING_PRIVATE_KEY')
                or environment.get('TAURI_SIGNING_PRIVATE_KEY_PATH'),
                'Existing updater artifacts would become stale in ' + str(output)
                + '. Supply updater signing credentials to regenerate them, or move this release '
                'directory aside before rebuilding. Existing artifacts were not changed.')


def stable_requirement(identifier, team_id):
    # Apple's default Developer ID requirement is stable across builds and
    # certificate renewal within this team. Never pin a binary or certificate hash.
    return ('identifier "' + identifier + '" and anchor apple generic '
            'and certificate 1[field.1.2.840.113635.100.6.2.6] '
            'and certificate leaf[field.1.2.840.113635.100.6.1.13] '
            'and certificate leaf[subject.OU] = ' + team_id)


def normalize_requirement(value):
    return ' '.join(re.sub(r'/\*.*?\*/', '', value).split())


def inspect_signature(output, identifier, team_id, ad_hoc=False):
    def field(name):
        match = re.search(r'^' + re.escape(name) + r'=(.+)$', output, re.M)
        return match.group(1).strip() if match else ''

    require(field('Identifier') == identifier, 'Unexpected signing identifier for ' + identifier)
    require(re.search(r'^CodeDirectory .*flags=0x[0-9a-fA-F]+\([^\n)]*\bruntime\b', output, re.M),
            'Hardened runtime missing for ' + identifier)
    requirement = re.search(r'^(?:# )?designated => (.+)$', output, re.M)
    require(requirement, 'Designated requirement missing for ' + identifier)
    actual_requirement = normalize_requirement(requirement.group(1))
    if ad_hoc:
        require(field('Signature') == 'adhoc' and field('TeamIdentifier') == 'not set',
                'Expected ad-hoc local test signature for ' + identifier)
    else:
        require(field('TeamIdentifier') == team_id, 'Unexpected signing team for ' + identifier)
        require(any(line.startswith('Authority=Developer ID Application: ')
                    and line.endswith(' (' + team_id + ')') for line in output.splitlines()),
                'Developer ID Application authority missing for ' + identifier)
        require(field('Timestamp') and field('Timestamp').lower() not in ('none', 'not set'),
                'Secure signing timestamp missing for ' + identifier)
        require(actual_requirement == stable_requirement(identifier, team_id),
                'Unstable or unexpected designated requirement for ' + identifier)
    return {'identifier': identifier, 'teamId': field('TeamIdentifier'),
            'hardenedRuntime': True, 'timestamp': field('Timestamp') or None,
            'designatedRequirement': actual_requirement}


def verify(app, ad_hoc=False):
    contract = policy()
    app = app.resolve()
    framework = app / 'Contents/Frameworks/Chromium Embedded Framework.framework'
    targets = [(app, 'Contents/Info.plist', contract['bundleId']),
               (framework, 'Resources/Info.plist', 'org.cef.framework')]
    targets.extend((app / 'Contents/Frameworks' / ('Aven Helper' + name + '.app'),
                    'Contents/Info.plist', contract['bundleId'] + '.chromium.helper' + suffix)
                   for name, suffix in HELPERS)
    for target, info_path, identifier in targets:
        require(target.is_dir(), 'Missing signed bundle: ' + str(target))
        info = plistlib.loads((target / info_path).read_bytes())
        require(info.get('CFBundleIdentifier') == identifier,
                'Unexpected bundle identifier in ' + str(target))
    command(['codesign', '--verify', '--deep', '--strict', str(app)])
    signatures = []
    for target, _, identifier in targets:
        output = command(['codesign', '-d', '--verbose=4', '-r-', str(target)])
        result = inspect_signature(output, identifier, contract['teamId'], ad_hoc)
        result['bundle'] = str(target.relative_to(app))
        signatures.append(result)
    return {'status': 'verified', 'mode': 'ad-hoc-local-test' if ad_hoc else 'developer-id',
            'app': app.name, 'teamId': None if ad_hoc else contract['teamId'],
            'bundleId': contract['bundleId'], 'strictSignatureVerification': 'passed',
            'notarization': 'not checked', 'signatures': signatures,
            'scope': 'Signature identity and bundle integrity; does not grant or verify macOS permissions.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    preflight_parser = commands.add_parser('preflight', help='Print verified signing SHA-1 fingerprint')
    preflight_parser.add_argument('--ad-hoc', action='store_true')
    output_parser = commands.add_parser('check-output', help='Refuse to leave stale updater artifacts')
    output_parser.add_argument('--out', type=Path, required=True)
    output_parser.add_argument('--version', required=True)
    verify_parser = commands.add_parser('verify', help='Verify the final complete Chromium app')
    verify_parser.add_argument('--app', type=Path, required=True)
    verify_parser.add_argument('--report', type=Path)
    verify_parser.add_argument('--ad-hoc', action='store_true')
    args = parser.parse_args()
    try:
        if args.action == 'preflight':
            print(preflight(args.ad_hoc))
        elif args.action == 'check-output':
            check_output_directory(args.out, args.version)
        else:
            result = verify(args.app, args.ad_hoc)
            rendered = json.dumps(result, indent=2) + '\n'
            if args.report:
                args.report.write_text(rendered)
            print(rendered, end='')
    except (RuntimeError, OSError, ValueError) as error:
        print('Release signing: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
