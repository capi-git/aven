#!/usr/bin/env python3
"""Prepare an isolated Developer ID keychain on a disposable GitHub Actions runner.

The runner's ordered search list temporarily includes this keychain so codesign
can resolve the certificate chain. Cleanup restores the original list exactly;
the default keychain and existing keychain contents/ACLs are never changed.
Only public identity/path metadata is written to GITHUB_ENV. No notarization.
"""
import argparse
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import stat
import subprocess
import sys
import urllib.request


ROOT = Path(__file__).resolve().parent.parent
POLICY = ROOT / 'scripts/release-signing.json'
DIRECTORY = 'aven-release-signing'
KEYCHAIN = 'release.keychain-db'
STATE = 'state.json'
OWNER = 'aven-ci-signing-keychain-v1'
G2_URL = 'https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer'
G2_SHA256 = 'f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a'
SYSTEM_ROOTS = '/System/Library/Keychains/SystemRootCertificates.keychain'
SECRET_NAMES = ('APPLE_DEVELOPER_ID_P12_BASE64', 'APPLE_DEVELOPER_ID_P12_PASSWORD')
MAX_P12_BYTES = 10 * 1024 * 1024


class SigningError(Exception):
    """Only fixed, non-sensitive messages cross the command-line boundary."""


def require(condition, message):
    if not condition:
        raise SigningError(message)


def public_path(value):
    return isinstance(value, str) and value.startswith('/') and not any(
        character in value for character in '\r\n\0')


def directory_for(environment):
    value = environment.get('RUNNER_TEMP', '')
    require(public_path(value), 'RUNNER_TEMP must be an absolute runner directory.')
    root = Path(value)
    require(root.is_dir() and not root.is_symlink(), 'RUNNER_TEMP must be an existing real directory.')
    return root.resolve() / DIRECTORY


def run_security(arguments, operation, capture=False):
    # CLI password arguments are required for unattended import. Never trace or
    # expose command lines, output, or subprocess exception details. Do not pass
    # the repository secrets to child processes via their environment as well.
    environment = {key: value for key, value in os.environ.items() if key not in SECRET_NAMES}
    try:
        result = subprocess.run(
            ['/usr/bin/security', *map(str, arguments)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True, env=environment, timeout=60, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        raise SigningError(operation + ' failed; sensitive diagnostics suppressed.') from None
    require(result.returncode == 0, operation + ' failed; sensitive diagnostics suppressed.')
    return result.stdout if capture else ''


def write_private(path, contents):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(contents)


def read_search_list():
    output = run_security(['list-keychains', '-d', 'user'], 'Read runner keychain search list', True)
    try:
        paths = shlex.split(output)
    except ValueError:
        raise SigningError('Runner keychain search list could not be parsed.') from None
    require(all(public_path(path) for path in paths), 'Runner keychain search list contains an invalid path.')
    return paths


def download_intermediate():
    try:
        with urllib.request.urlopen(G2_URL, timeout=30) as response:
            require(response.geturl().startswith('https://'), 'Apple intermediate download requires HTTPS.')
            contents = response.read(128 * 1024 + 1)
    except SigningError:
        raise
    except Exception:
        raise SigningError('Apple intermediate download failed; diagnostics suppressed.') from None
    require(len(contents) <= 128 * 1024, 'Apple intermediate certificate exceeds the size limit.')
    return contents


def has_pinned_intermediate(keychain):
    # PKCS12 exports may already include the issuing certificate chain. Query
    # only this job's keychain: a matching certificate in the login/search-list
    # keychains must not make an incomplete isolated signing keychain pass.
    output = run_security(['find-certificate', '-a', '-p', keychain],
                          'Read temporary keychain certificates', True)
    blocks = re.findall(r'-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)'
                        r'-----END CERTIFICATE-----', output)
    require(bool(blocks), 'Temporary keychain certificate data could not be verified.')
    fingerprints = set()
    try:
        for block in blocks:
            der = base64.b64decode(''.join(block.split()), validate=True)
            require(bool(der), 'Temporary keychain certificate data could not be verified.')
            fingerprints.add(hashlib.sha256(der).hexdigest())
    except (binascii.Error, ValueError):
        raise SigningError('Temporary keychain certificate data could not be verified.') from None
    return G2_SHA256 in fingerprints


def ensure_intermediate(keychain, intermediate_path):
    # add-certificates treats an exact duplicate as failure. Skip only after an
    # exact pinned DER hash match, never by common name or by ignoring errors.
    if not has_pinned_intermediate(keychain):
        run_security(['add-certificates', '-k', keychain, intermediate_path],
                     'Import verified Apple intermediate')
        require(has_pinned_intermediate(keychain),
                'Verified Apple intermediate is missing from the temporary keychain.')


def selected_identity(output, team_id):
    rows = re.findall(r'^\s*\d+\)\s+([0-9a-fA-F]{40})\s+"([^"\r\n]+)"\s*$', output, re.M)
    totals = re.findall(r'^\s*(\d+) valid identities found\s*$', output, re.M)
    require(len(rows) == 1 and totals == ['1'],
            'The temporary keychain must contain exactly one valid signing identity.')
    fingerprint, name = rows[0]
    require(name.startswith('Developer ID Application: ') and name.endswith(' (' + team_id + ')'),
            'The temporary Developer ID identity does not match the configured Apple team.')
    return fingerprint.upper()


def read_state(directory):
    require(not directory.is_symlink() and directory.is_dir(), 'Refusing an unsafe signing directory.')
    require(directory.stat().st_uid == os.getuid() and stat.S_IMODE(directory.stat().st_mode) == 0o700,
            'Signing directory ownership or permissions do not match the helper.')
    path = directory / STATE
    require(not path.is_symlink() and path.is_file(), 'Signing directory has no safe ownership record.')
    require(path.stat().st_size <= 64 * 1024 and stat.S_IMODE(path.stat().st_mode) == 0o600,
            'Signing ownership record has invalid size or permissions.')
    try:
        state = json.loads(path.read_text())
    except (OSError, ValueError):
        raise SigningError('Signing ownership record could not be read.') from None
    require(isinstance(state, dict) and state.get('owner') == OWNER,
            'Signing directory is not owned by this helper.')
    original = state.get('originalSearchList')
    require(isinstance(original, list) and all(public_path(path) for path in original),
            'Signing ownership record contains an invalid search list.')
    return state


def cleanup_directory(directory, state=None):
    if not directory.exists() and not directory.is_symlink():
        return
    stored = read_state(directory)
    require(state is None or stored == state, 'Signing ownership record changed during setup.')
    keychain = directory / KEYCHAIN
    p12 = directory / 'identity.p12'
    if p12.exists() or p12.is_symlink():
        p12.unlink()
    # Never send an attacker-controlled symlink to the Security framework.
    require(not keychain.is_symlink(), 'Refusing a symlinked temporary keychain.')
    failures = []
    try:
        run_security(['list-keychains', '-d', 'user', '-s', *stored['originalSearchList']],
                     'Restore runner keychain search list')
    except SigningError:
        failures.append('search list')
    if keychain.exists():
        try:
            run_security(['delete-keychain', keychain], 'Delete temporary signing keychain')
        except SigningError:
            failures.append('temporary keychain')
    # Keep the ownership record for the always-cleanup retry if security failed.
    require(not failures, 'Signing cleanup failed; retry cleanup on this runner.')
    shutil.rmtree(directory)


def append_public_environment(path, directory, fingerprint):
    require(public_path(str(path)) and not path.is_symlink(), 'GITHUB_ENV must be a real absolute file.')
    require(path.parent.is_dir() and path.resolve().is_relative_to(directory.parent),
            'GITHUB_ENV must remain inside RUNNER_TEMP.')
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'ab') as handle:
        require(stat.S_ISREG(os.fstat(handle.fileno()).st_mode), 'GITHUB_ENV must be a regular file.')
        handle.write(('AVEN_RELEASE_KEYCHAIN=' + str(directory / KEYCHAIN) + '\n'
                      'AVEN_RELEASE_SIGNING_IDENTITY=' + fingerprint + '\n').encode())


def setup(environment):
    require(environment.get('GITHUB_ACTIONS') == 'true',
            'Signing keychain setup is restricted to disposable GitHub Actions runners.')
    directory = directory_for(environment)
    require(not directory.exists() and not directory.is_symlink(),
            'Signing directory already exists; run cleanup before retrying setup.')
    require(all(environment.get(key) for key in SECRET_NAMES), 'Both Apple Developer ID secrets are required.')
    require(public_path(environment.get('GITHUB_ENV', '')), 'GITHUB_ENV is required.')
    password = environment[SECRET_NAMES[1]]
    require('\0' not in password, 'The certificate password contains an unsupported character.')
    try:
        encoded = ''.join(environment[SECRET_NAMES[0]].split())
        require(len(encoded) <= MAX_P12_BYTES * 2, 'The PKCS12 secret exceeds the size limit.')
        p12_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise SigningError('The PKCS12 secret is not valid base64.') from None
    require(0 < len(p12_bytes) <= MAX_P12_BYTES and p12_bytes.startswith(b'\x30'),
            'The PKCS12 secret is empty, malformed, or too large.')
    try:
        team_id = json.loads(POLICY.read_text())['teamId']
    except (OSError, ValueError, KeyError, TypeError):
        raise SigningError('The public Apple signing policy could not be read.') from None
    require(isinstance(team_id, str) and re.fullmatch(r'[A-Z0-9]{10}', team_id),
            'The public Apple signing policy has an invalid team ID.')
    original = read_search_list()
    require(str(directory / KEYCHAIN) not in original, 'The temporary signing path is already registered.')
    directory.mkdir(mode=0o700)
    state = {'owner': OWNER, 'originalSearchList': original}
    try:
        write_private(directory / STATE, (json.dumps(state) + '\n').encode())
    except Exception:
        (directory / STATE).unlink(missing_ok=True)
        directory.rmdir()
        raise SigningError('Signing ownership record could not be created.') from None
    try:
        intermediate = download_intermediate()
        require(hashlib.sha256(intermediate).hexdigest() == G2_SHA256,
                'Apple Developer ID G2 intermediate does not match its pinned hash.')
        intermediate_path = directory / 'DeveloperIDG2CA.cer'
        write_private(intermediate_path, intermediate)
        run_security(['verify-cert', '-c', intermediate_path, '-p', 'basic', '-l',
                      '-k', SYSTEM_ROOTS, '-L'], 'Verify Apple intermediate against system roots')
        keychain = directory / KEYCHAIN
        keychain_password = secrets.token_urlsafe(48)
        run_security(['create-keychain', '-p', keychain_password, keychain], 'Create temporary signing keychain')
        # create-keychain registers the new keychain. Make the ordered temporary
        # list explicit and keep it only for this signing job; never set default.
        run_security(['list-keychains', '-d', 'user', '-s', *original, keychain],
                     'Scope temporary signing keychain search list')
        run_security(['set-keychain-settings', '-l', '-u', '-t', '7200', keychain],
                     'Set temporary keychain lifetime')
        run_security(['unlock-keychain', '-p', keychain_password, keychain], 'Unlock temporary signing keychain')
        p12_path = directory / 'identity.p12'
        write_private(p12_path, p12_bytes)
        del p12_bytes
        try:
            run_security(['import', p12_path, '-k', keychain, '-t', 'agg', '-f', 'pkcs12',
                          '-P', password, '-T', '/usr/bin/codesign'], 'Import Developer ID identity')
        finally:
            p12_path.unlink(missing_ok=True)
        ensure_intermediate(keychain, intermediate_path)
        output = run_security(['find-identity', '-v', '-p', 'codesigning', keychain],
                              'Verify temporary signing identity', True)
        fingerprint = selected_identity(output, team_id)
        run_security(['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s',
                      '-k', keychain_password, keychain], 'Authorize CI signing tools')
        append_public_environment(Path(environment['GITHUB_ENV']), directory, fingerprint)
    except Exception as error:
        reason = str(error) if isinstance(error, SigningError) else 'Signing setup failed; sensitive diagnostics suppressed.'
        try:
            cleanup_directory(directory, state)
        except Exception:
            raise SigningError('Signing setup failed; cleanup also failed. Retry cleanup on this runner. '
                               'Sensitive diagnostics suppressed.') from None
        raise SigningError(reason + ' Temporary credentials cleaned up.') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cleanup', action='store_true', help='Restore search list and delete only the owned runner keychain')
    arguments = parser.parse_args(argv)
    try:
        require(sys.platform == 'darwin', 'CI signing keychain operations require macOS.')
        require(os.environ.get('GITHUB_ACTIONS') == 'true',
                'Signing keychain operations are restricted to disposable GitHub Actions runners.')
        if arguments.cleanup:
            cleanup_directory(directory_for(os.environ))
        else:
            setup(os.environ)
    except Exception:
        # Never render unexpected exceptions: they can contain subprocess argv
        # (passwords) or HTTP response data. Expected errors are fixed strings.
        error = sys.exc_info()[1]
        print(str(error) if isinstance(error, SigningError)
              else 'Signing keychain operation failed; sensitive diagnostics suppressed.', file=sys.stderr)
        return 1
    print('Temporary signing keychain cleaned up.' if arguments.cleanup else 'Temporary Developer ID signing keychain is ready.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
