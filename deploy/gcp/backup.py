#!/usr/bin/env python3
"""Daily logical database backup, authenticated with the VM's limited SA."""

import datetime
import json
import os
import pathlib
import subprocess
import tempfile
import urllib.request

ROOT = pathlib.Path('/opt/guangmo')


def metadata_token():
    request = urllib.request.Request(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        headers={'Metadata-Flavor': 'Google'},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)['access_token']


def main():
    bucket = (ROOT / 'backup-bucket').read_text().strip()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    with tempfile.TemporaryFile() as dump:
        subprocess.run(
            ['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f',
             str(ROOT / 'compose.yaml'), 'exec', '-T', 'postgres',
             'pg_dump', '-U', 'guangmo', '-d', 'guangmo', '-Fc'],
            stdout=dump, check=True, timeout=1800,
        )
        size = dump.tell()
        if size == 0:
            raise RuntimeError('Refusing to upload an empty backup')
        dump.seek(0)
        # Upload from disk, avoiding holding a growing database dump in RAM.
        token = metadata_token()
        config = ('header = "Authorization: Bearer ' + token + '"\n').encode()
        result = subprocess.run(
            ['curl', '--fail', '--silent', '--show-error', '--config', '-',
             '--request', 'POST', '--header', 'Content-Type: application/octet-stream',
             '--data-binary', '@/proc/self/fd/' + str(dump.fileno()),
             'https://storage.googleapis.com/upload/storage/v1/b/' + bucket +
             '/o?uploadType=media&ifGenerationMatch=0&name=postgres/' + stamp + '.dump'],
            input=config, pass_fds=(dump.fileno(),), capture_output=True, timeout=1800,
        )
        if result.returncode:
            raise RuntimeError('Backup upload failed: ' + result.stderr.decode())
        record = json.loads(result.stdout)
        if int(record['size']) != size:
            raise RuntimeError('Uploaded backup size does not match')
        print('Backup saved:', record['name'], 'bytes:', size)


if __name__ == '__main__':
    os.umask(0o077)
    main()
