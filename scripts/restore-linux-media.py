#!/usr/bin/env python3
"""Recover the unchanged, pinned media tools from our verified v1.74.6 bundle.

BtbN's moving `latest` archive no longer matches the original pin. This build
bootstrap keeps the shipped media binaries identical instead of updating them
implicitly. No application data or executable from the bundle is loaded.
"""
import hashlib
import json
from pathlib import Path
import sys
import tarfile

ARCHIVE_SHA = '901568b9c7f7918e6565c86c60f8c7b42ae17024b67026773cb81c28346ad694'
UPSTREAM_SHA = '80742938a95f9ecf9e0635192b417b7af61ddd53c4ab511898a11da5dad81667'
URL = 'https://github.com/yxt02/hongguo-drama-linux/releases/download/v1.74.6-linux/hongguo-drama-1.74.6-linux-x64.tar.gz'
BINARIES = {'ffmpeg': '00550c65fc35d8e21acae12c4262bdbf74df9b79fa996eb71c85a014571d8542',
            'ffprobe': 'effc9977f8dcb67e8f459822138b0663c44434aafaf4fef058b5c67dfb6dd8c4'}


def main():
    archive = Path(sys.argv[1])
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != ARCHIVE_SHA:
            raise ValueError('Base bundle checksum mismatch')
    dest = Path(__file__).resolve().parent.parent / 'build/ffmpeg/linux-x64'
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, 'r:gz') as bundle:
        for name, expected in BINARIES.items():
            member = bundle.getmember('hongguo-linux-x64/app/resources/bin/' + name)
            if not member.isfile() or member.size > 200_000_000:
                raise ValueError('Unexpected media entry')
            data = bundle.extractfile(member).read()
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError(name + ' checksum mismatch')
            target = dest / name
            target.write_bytes(data)
            target.chmod(0o755)
    (dest / 'build-manifest.json').write_text(json.dumps({
        'source': URL, 'recovered_bundle_sha256': ARCHIVE_SHA,
        'artifact_sha256': UPSTREAM_SHA, 'binaries': BINARIES,
    }, indent=2) + '\n')
    print('Recovered unchanged FFmpeg/FFprobe; bundle and both binaries verified')


if __name__ == '__main__':
    main()
