#!/usr/bin/env python3
"""Package an already-built Aven macOS arm64 app with the pinned CEF runtime.

Self-contained: Python 3.9+, macOS command-line tools, and a verified CEF SDK.
No build, download, install, process termination, or launch is performed.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parent.parent
CEF_VERSION = '152.0.6+g708dc14+chromium-152.0.7977.83'
CEF_FRAMEWORK_SHA256 = 'f3edb1933329befbd09f03d05b15c49f0688d28ed81257d7931a5fded925ee8c'
HELPER_NAME = 'Supermono Helper'
HELPER_BUILD_NAME = 'Supermono Chromium Helper'
HELPERS = [('', ''), (' (Alerts)', '.alerts'), (' (GPU)', '.gpu'), (' (Plugin)', '.plugin'), (' (Renderer)', '.renderer')]
MACHO_MAGICS = {b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def entitlements(name, identity):
    values = plistlib.loads((REPO / 'src-tauri/Entitlements.plist').read_bytes()) if name == 'host' else {}
    if name == 'jit-helper':
        values['com.apple.security.cs.allow-jit'] = True
    if identity == '-':
        values['com.apple.security.cs.disable-library-validation'] = True
    else:
        values.pop('com.apple.security.cs.disable-library-validation', None)
    path = SCRATCH / (name + '-entitlements.plist')
    path.write_bytes(plistlib.dumps(values))
    return path

def assert_not_running(app):
    processes = subprocess.check_output(['ps', '-axo', 'comm='], text=True).splitlines()
    require(not any(p.strip().startswith(str(app) + '/') for p in processes),
            'The candidate app is running; root must quit it before rebuilding: ' + str(app))


def run(command, log, env):
    log.write('\n$ ' + repr([str(x) for x in command]) + '\n')
    log.flush()
    subprocess.run([str(x) for x in command], cwd=REPO, env=env,
                   stdout=log, stderr=subprocess.STDOUT, check=True)


def macho(path):
    if not path.is_file() or path.is_symlink():
        return False
    with path.open('rb') as stream:
        return stream.read(4) in MACHO_MAGICS


def manifest(root):
    result = {}
    total = 0
    for path in sorted(root.rglob('*')):
        relative = str(path.relative_to(root))
        if path.is_symlink():
            require(path.resolve().is_relative_to(root.resolve()), 'Bundle symlink escapes app: ' + relative)
            result[relative] = {'type': 'symlink', 'target': os.readlink(path)}
        elif path.is_file():
            result[relative] = {'type': 'file', 'sha256': sha(path), 'bytes': path.stat().st_size}
            total += path.stat().st_size
    payload = json.dumps(result, sort_keys=True, separators=(',', ':')).encode()
    return result, hashlib.sha256(payload).hexdigest(), total


def package(app, product_name, bundle_id, identity, log, env):
    info_path = app / 'Contents/Info.plist'
    info = plistlib.loads(info_path.read_bytes())
    require(info['CFBundleIdentifier'] == bundle_id, 'Unexpected candidate bundle identifier')
    require(info['CFBundleName'] == product_name, 'Unexpected candidate product name')
    icon_name = info.get('CFBundleIconFile')
    require(isinstance(icon_name, str) and icon_name and Path(icon_name).name == icon_name,
            'The host app must declare a local icon for its Chromium helpers')
    host_icon = app / 'Contents/Resources' / icon_name
    if not host_icon.suffix:
        host_icon = host_icon.with_suffix('.icns')
    require(host_icon.is_file(), 'Host app icon is missing: ' + str(host_icon))
    # Match Foundation's canonical XML bytes before signing; Chromium supplies
    # those bytes when validating the current process through Security.framework.
    info_path.write_bytes(plistlib.dumps(info, sort_keys=True))
    binary = app / 'Contents/MacOS' / info['CFBundleExecutable']
    frameworks = app / 'Contents/Frameworks'
    frameworks.mkdir(exist_ok=True)
    framework = frameworks / 'Chromium Embedded Framework.framework'
    # Clear only this generated framework in a non-running candidate bundle;
    # the distribution, installed app, source, and archived releases are untouched.
    if framework.exists():
        require(not framework.is_symlink(), 'Unexpected candidate framework symlink')
        shutil.rmtree(framework)
    run(['ditto', CEF_ROOT / 'Release/Chromium Embedded Framework.framework', framework], log, env)
    required = ['Chromium Embedded Framework', 'Libraries/libcef_sandbox.dylib',
                'Resources/icudtl.dat', 'Resources/en.lproj/locale.pak', 'Resources/Info.plist']
    for relative in required:
        require((framework / relative).is_file(), 'CEF runtime component missing: ' + relative)

    helper_binary = CEF_BUILD / HELPER_BUILD_NAME
    require(helper_binary.is_file(), 'Native helper was not built: ' + str(helper_binary))
    helpers = []
    for suffix, id_suffix in HELPERS:
        name = HELPER_NAME + suffix
        # Preserve CEF's executable paths and identities while presenting the
        # current product name in macOS permission and notification settings.
        display_name = (product_name + ' Browser Notifications' if id_suffix == '.alerts'
                        else product_name + ' Helper' + suffix)
        helper = frameworks / (name + '.app')
        contents = helper / 'Contents'
        (contents / 'MacOS').mkdir(parents=True, exist_ok=True)
        (contents / 'Resources').mkdir(exist_ok=True)
        shutil.copy2(helper_binary, contents / 'MacOS' / name)
        shutil.copy2(host_icon, contents / 'Resources/icon.icns')
        (contents / 'PkgInfo').write_bytes(b'APPL????')
        helper_info = {
            'CFBundleDevelopmentRegion': 'en', 'CFBundleDisplayName': display_name,
            'CFBundleIconFile': 'icon.icns',
            'CFBundleExecutable': name, 'CFBundleIdentifier': bundle_id + '.chromium.helper' + id_suffix,
            'CFBundleInfoDictionaryVersion': '6.0', 'CFBundleName': name,
            'CFBundlePackageType': 'APPL', 'CFBundleSignature': '????',
            'CFBundleVersion': info['CFBundleVersion'],
            'CFBundleShortVersionString': info['CFBundleShortVersionString'],
            'LSEnvironment': {'MallocNanoZone': '0'}, 'LSFileQuarantineEnabled': True,
            'LSMinimumSystemVersion': '13.0', 'LSUIElement': True,
            'NSSupportsAutomaticGraphicsSwitching': True,
        }
        # CEF can receive TCC attribution in a helper process. Keep its camera,
        # microphone, location, and chosen-folder explanations equal to the host.
        helper_info.update({key: value for key, value in info.items()
                            if key.startswith('NS') and key.endswith('UsageDescription')})
        (contents / 'Info.plist').write_bytes(plistlib.dumps(helper_info))
        helpers.append((helper, suffix))
    notices = app / 'Contents/Resources/Chromium'
    notices.mkdir(parents=True, exist_ok=True)
    for name in ['LICENSE', 'NOTICE']:
        require((REPO / name).is_file(), 'Missing application notice: ' + name)
        shutil.copy2(REPO / name, app / 'Contents/Resources' / ('Aven-' + name + '.txt'))
    dependency_notices = REPO / 'THIRD_PARTY_NOTICES.txt'
    require(dependency_notices.is_file(), 'Generate THIRD_PARTY_NOTICES.txt before packaging')
    shutil.copy2(dependency_notices, app / 'Contents/Resources/THIRD_PARTY_NOTICES.txt')
    for name in ['LICENSE.txt', 'CREDITS.html']:
        shutil.copy2(CEF_ROOT / name, notices / name)

    # Finder/file-provider metadata can be inherited by generated .framework
    # folders. Remove only codesign-disallowed attributes from this candidate;
    # preserve provenance and the original downloaded framework unchanged.
    attribute_names = subprocess.check_output(['xattr', '-r', str(app)], text=True)
    for attribute in ['com.apple.FinderInfo', 'com.apple.ResourceFork']:
        if attribute in attribute_names.split():
            run(['xattr', '-dr', attribute, app], log, env)

    # Verify all native payloads before signing. CEF is loaded dynamically, so
    # binaries must not contain a link to the build machine's framework path.
    native = [p for p in app.rglob('*') if macho(p)]
    for path in native:
        arch = subprocess.check_output(['lipo', '-archs', str(path)], text=True).strip()
        require('arm64' in arch.split(), 'Missing arm64 payload: ' + str(path))
        # Apple's otool-classic interprets trailing parentheses as archive-member
        # syntax, including Chromium's conventional "Helper (Renderer)" name.
        # Inspect identical bytes under a plain temporary filename in that case.
        if path.name.endswith(')'):
            with tempfile.TemporaryDirectory(prefix='macho-inspect-', dir=SCRATCH) as folder:
                probe = Path(folder) / 'payload'
                shutil.copyfile(path, probe)
                links = subprocess.check_output(['otool', '-L', str(probe)], text=True)
        else:
            links = subprocess.check_output(['otool', '-L', str(path)], text=True)
        require(str(CEF_ROOT) not in links and str(CEF_BUILD) not in links,
                'Build-machine dynamic dependency: ' + str(path))

    common = ['codesign', '--force', '--sign', identity, '--options', 'runtime',
              '--timestamp=none' if identity == '-' else '--timestamp']
    for path in sorted([p for p in framework.rglob('*') if macho(p)], key=lambda p: len(p.parts), reverse=True):
        run(common + [path], log, env)
    run(common + [framework], log, env)
    for helper, suffix in helpers:
        kind = 'jit-helper' if suffix in (' (GPU)', ' (Renderer)') else 'helper'
        run(common + ['--entitlements', entitlements(kind, identity), helper], log, env)
    run(common + ['--entitlements', entitlements('host', identity), app], log, env)
    run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', app], log, env)
    run(['codesign', '-dvv', app], log, env)
    return binary, framework, helpers, native


def main():
    global CEF_ROOT, CEF_BUILD, SCRATCH
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True, help='Built .app under this checkout target directory')
    parser.add_argument('--cef-root', type=Path, default=os.environ.get('CEF_ROOT'))
    parser.add_argument('--cef-build-dir', type=Path, default=os.environ.get('CEF_BUILD_DIR'))
    parser.add_argument('--identity', default='-', help='Ad-hoc by default; optional shared Developer ID identity')
    parser.add_argument('--execute', action='store_true', help='Package and sign the existing candidate; otherwise print a plan')
    args = parser.parse_args()
    require(sys.platform == 'darwin', 'Packaging requires macOS command-line tools')
    app = args.app.absolute()
    require(not app.is_symlink() and app.resolve().is_relative_to((REPO / 'target').resolve()), 'Only candidate bundles under this checkout target directory may be packaged')
    require(not any(parent.name == 'Applications' for parent in app.resolve().parents), 'Installed application paths are never packaging targets')
    require(app.suffix == '.app' and app.is_dir(), 'A built .app is required')
    require(args.cef_root and args.cef_build_dir, 'Set CEF_ROOT and CEF_BUILD_DIR or pass both options')
    CEF_ROOT = args.cef_root.resolve()
    CEF_BUILD = args.cef_build_dir.resolve()
    require(('#define CEF_VERSION "' + CEF_VERSION + '"') in (CEF_ROOT / 'include/cef_version.h').read_text(), 'Wrong CEF version; update the pin and verification together')
    require(sha(CEF_ROOT / 'Release/Chromium Embedded Framework.framework/Chromium Embedded Framework') == CEF_FRAMEWORK_SHA256, 'CEF framework differs from the verified pinned distribution')
    require((CEF_BUILD / HELPER_BUILD_NAME).is_file(), 'Build the native Chromium helper first')
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    report = app.with_suffix('.chromium-package.json')
    log_path = app.with_suffix('.chromium-package.log')
    result = {'status': 'plan', 'app': str(app), 'cef_version': CEF_VERSION,
              'cef_root': str(CEF_ROOT), 'cef_build_dir': str(CEF_BUILD), 'signing_identity': args.identity,
              'installs_or_launches_app': False, 'report': str(report), 'log': str(log_path)}
    if not args.execute:
        print(json.dumps(result, indent=2))
        return
    assert_not_running(app)
    result['started_at'] = datetime.datetime.now().astimezone().isoformat()
    try:
        with tempfile.TemporaryDirectory(prefix='supermono-chromium-package-') as folder:
            SCRATCH = Path(folder)
            with log_path.open('w') as log:
                binary, framework, helpers, native = package(app, info['CFBundleName'], info['CFBundleIdentifier'], args.identity, log, os.environ.copy())
        files, fingerprint, size = manifest(app)
        manifest_path = app.with_suffix('.chromium-manifest.json')
        manifest_path.write_text(json.dumps(files, indent=2) + '\n')
        result.update(status='packaged', binary_sha256=sha(binary), bundle_files_sha256=fingerprint,
                      bundle_bytes=size, bundle_file_count=len(files), native_payload_count=len(native),
                      manifest=str(manifest_path), strict_signature_verification='passed',
                      library_validation_exception=args.identity == '-', chromium_sandbox_disabled=False,
                      verification_scope='Packaging only; run tests and native browser QA before installation')
    except Exception as error:
        result.update(status='failed', error=str(error))
        raise
    finally:
        result['completed_at'] = datetime.datetime.now().astimezone().isoformat()
        report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
