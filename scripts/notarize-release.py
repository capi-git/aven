#!/usr/bin/env python3
"""Notarize, staple and assess the final Developer ID signed Aven app.

Credentials are either an App Store Connect API key (APPLE_API_KEY_P8_BASE64,
APPLE_API_KEY_ID and APPLE_API_ISSUER_ID, all three) or the name of a notarytool
Keychain profile (AVEN_NOTARY_KEYCHAIN_PROFILE). Without credentials nothing is
submitted and signing-verification.json records that the app is not notarized.

The decoded .p8 key is written only to a private temporary directory (0700,
file 0600) and removed as soon as Apple has answered. On a GitHub runner that
directory is $RUNNER_TEMP/aven-notary-key, which `cleanup` removes again from
an always-run step. Credential values are never printed or passed to tools
other than notarytool. Never installs or publishes anything.
"""
import argparse
import base64
import binascii
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile

API_NAMES = ('APPLE_API_KEY_P8_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID')
PROFILE_NAME = 'AVEN_NOTARY_KEYCHAIN_PROFILE'
KEY_DIRECTORY = 'aven-notary-key'
WAIT_TIMEOUT = '45m'
PROCESS_TIMEOUT = 50 * 60
MAX_KEY_BYTES = 16 * 1024
NOTARIZED_SOURCE = 'source=Notarized Developer ID'
SUBMISSION_ID = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
SKIPPED_REASON = ('No notarization credentials were supplied. The app is Developer ID signed '
                  'but not notarized, so macOS may ask users to approve opening it.')


class NotaryError(Exception):
    """Messages name settings, never their values."""


def require(condition, message):
    if not condition:
        raise NotaryError(message)


def credentials(environment):
    present = [name for name in API_NAMES if environment.get(name, '').strip()]
    profile = environment.get(PROFILE_NAME, '').strip()
    require(not present or len(present) == len(API_NAMES),
            'Set all of ' + ', '.join(API_NAMES) + ' or none of them; missing: '
            + ', '.join(name for name in API_NAMES if name not in present) + '.')
    require(not (present and profile), 'Use either the App Store Connect API key variables or '
            + PROFILE_NAME + ', not both.')
    if present:
        key_id = environment['APPLE_API_KEY_ID'].strip()
        issuer = environment['APPLE_API_ISSUER_ID'].strip()
        require(re.fullmatch(r'[A-Za-z0-9]{8,32}', key_id), 'APPLE_API_KEY_ID is not an App Store Connect key ID.')
        require(SUBMISSION_ID.fullmatch(issuer), 'APPLE_API_ISSUER_ID is not an App Store Connect issuer ID.')
        decode_key(environment)
        return {'kind': 'app-store-connect-api-key', 'keyId': key_id, 'issuer': issuer}
    if profile:
        require(len(profile) <= 128 and not any(ord(character) < 32 for character in profile),
                PROFILE_NAME + ' is not a valid Keychain profile name.')
        return {'kind': 'keychain-profile', 'profile': profile}
    return None


def decode_key(environment):
    try:
        contents = base64.b64decode(''.join(environment['APPLE_API_KEY_P8_BASE64'].split()), validate=True)
    except (binascii.Error, ValueError):
        raise NotaryError('APPLE_API_KEY_P8_BASE64 is not valid base64.') from None
    require(0 < len(contents) <= MAX_KEY_BYTES and b'-----BEGIN PRIVATE KEY-----' in contents,
            'APPLE_API_KEY_P8_BASE64 does not contain an App Store Connect .p8 private key.')
    return contents


def runner_key_directory(environment):
    runner = environment.get('RUNNER_TEMP', '')
    if not runner:
        return None
    root = Path(runner)
    require(root.is_absolute() and root.is_dir() and not root.is_symlink(),
            'RUNNER_TEMP must be an existing absolute directory.')
    return root.resolve() / KEY_DIRECTORY


def remove_key_directory(directory):
    if directory is None:
        return
    if directory.is_symlink() or directory.is_file():
        directory.unlink()
    elif directory.exists():
        shutil.rmtree(directory)


def create_key_directory(environment):
    directory = runner_key_directory(environment)
    if directory is None:
        return Path(tempfile.mkdtemp(prefix='aven-notary-key-'))
    remove_key_directory(directory)
    directory.mkdir(mode=0o700)
    os.chmod(directory, 0o700)
    return directory


def write_private(path, contents):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(contents)


def run(arguments, timeout=600):
    # Child tools never receive the encoded key through their environment.
    environment = {key: value for key, value in os.environ.items() if key not in API_NAMES}
    try:
        return subprocess.run([str(argument) for argument in arguments], stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, env=environment, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise NotaryError(' '.join(map(str, arguments[:3])) + ' timed out.') from None
    except OSError:
        raise NotaryError(str(arguments[0]) + ' is unavailable.') from None


def read_report(path, app):
    report = json.loads(path.read_text())
    require(report.get('status') == 'verified' and report.get('mode') == 'developer-id'
            and report.get('strictSignatureVerification') == 'passed' and report.get('app') == app.name,
            'Only a verified Developer ID app can be notarized; ad-hoc builds are never submitted.')
    return report


def write_report(path, report, notarization):
    report['notarization'] = notarization
    path.write_text(json.dumps(report, indent=2) + '\n')


def warn(message):
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        print('::warning title=Not notarized::' + message, file=sys.stderr)
    else:
        print('Warning: ' + message, file=sys.stderr)


def submit(archive, authentication):
    result = run(['xcrun', 'notarytool', 'submit', archive, *authentication, '--wait',
                  '--timeout', WAIT_TIMEOUT, '--output-format', 'json'], timeout=PROCESS_TIMEOUT)
    try:
        response = json.loads(result.stdout)
    except ValueError:
        response = {}
    response = response if isinstance(response, dict) else {}
    submission = str(response.get('id', ''))
    status = str(response.get('status', ''))
    if not SUBMISSION_ID.fullmatch(submission):
        raise NotaryError('Notarization submission failed before Apple returned a submission ID.\n'
                          + result.stderr.strip())
    print('Notarization submission ' + submission + ': ' + (status or 'no status'), file=sys.stderr)
    if result.returncode == 0 and status == 'Accepted':
        return submission
    log = run(['xcrun', 'notarytool', 'log', submission, *authentication])
    print(log.stdout.strip() or log.stderr.strip(), file=sys.stderr)
    raise NotaryError('Apple did not accept notarization submission ' + submission + ' (status: '
                      + (status or 'unknown') + '). See the notarization log above.')


def staple_and_assess(app):
    for arguments, failure in (
            (['xcrun', 'stapler', 'staple', app], 'Stapling the notarization ticket failed.'),
            (['xcrun', 'stapler', 'validate', app], 'The stapled notarization ticket did not validate.'),
            (['codesign', '--verify', '--deep', '--strict', app], 'The signature changed while stapling.')):
        result = run(arguments)
        require(result.returncode == 0, failure + '\n' + result.stderr.strip())
    result = run(['spctl', '-a', '-vvv', '-t', 'exec', app])
    output = result.stdout + result.stderr
    require(result.returncode == 0 and NOTARIZED_SOURCE in output,
            'Gatekeeper did not accept the app as notarized Developer ID software.\n' + output.strip())


def notarize(app, report_path, environment):
    app = app.resolve()
    report = read_report(report_path, app)
    selected = credentials(environment)
    if selected is None:
        write_report(report_path, report, {'notarized': False, 'status': 'skipped', 'reason': SKIPPED_REASON})
        warn(SKIPPED_REASON)
        return 'not-notarized'
    key_directory = None
    try:
        if selected['kind'] == 'keychain-profile':
            authentication = ['--keychain-profile', selected['profile']]
        else:
            key_directory = create_key_directory(environment)
            key = key_directory / ('AuthKey_' + selected['keyId'] + '.p8')
            write_private(key, decode_key(environment))
            authentication = ['--key', key, '--key-id', selected['keyId'], '--issuer', selected['issuer']]
        with tempfile.TemporaryDirectory(prefix='aven-notary-upload-') as upload:
            archive = Path(upload) / (app.stem + '-notarization.zip')
            result = run(['ditto', '-c', '-k', '--keepParent', app, archive])
            require(result.returncode == 0, 'Could not create the notarization upload archive.')
            submission = submit(archive, authentication)
    finally:
        remove_key_directory(key_directory)
    staple_and_assess(app)
    write_report(report_path, report, {
        'notarized': True, 'status': 'accepted', 'submissionId': submission, 'stapled': True,
        'stapleValidation': 'passed', 'gatekeeper': 'accepted', 'gatekeeperSource': 'Notarized Developer ID',
        'credential': selected['kind']})
    return 'notarized'


def terminate(signum, frame):
    # Run the `finally` cleanup when a job is cancelled.
    raise SystemExit(128 + signum)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('check', help='Validate optional credentials before building; prints the mode')
    notarize_parser = commands.add_parser('notarize', help='Notarize, staple and record the result')
    notarize_parser.add_argument('--app', type=Path, required=True)
    notarize_parser.add_argument('--report', type=Path, required=True)
    commands.add_parser('cleanup', help='Remove the runner key directory, if any')
    args = parser.parse_args()
    for signum in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, terminate)
    try:
        if args.action == 'check':
            selected = credentials(os.environ)
            print(selected['kind'] if selected else 'not-configured')
        elif args.action == 'notarize':
            print(notarize(args.app, args.report, os.environ))
        else:
            remove_key_directory(runner_key_directory(os.environ))
    except (NotaryError, OSError, ValueError) as error:
        print('Notarization: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
