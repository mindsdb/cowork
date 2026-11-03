"""Exercise the shipped nginx configuration and stderr sanitizer with real requests."""
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NginxLoggingTests(unittest.TestCase):
    def test_runtime_matrix(self):
        nginx = shutil.which('nginx')
        self.assertIsNotNone(nginx, 'Install nginx to run the runtime logging checks')
        for mode in ('errors', 'all'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                for folder in ('conf.d', 'templates', 'www', 'bin'):
                    (base / folder).mkdir()
                (base / 'www/index.html').write_text('ready')
                (base / 'www/index-web.html').write_text('ready')
                (base / 'www/asset.txt').write_text('ordinary success')
                (base / 'www/brand').mkdir()
                (base / 'www/brand/brand.js').write_text('window.COWORK_DEPLOYMENT_BRAND = {};')
                (base / 'diagnostic-logging.conf.template').write_text((ROOT / 'scripts/nginx-logging.conf.template').read_text())
                wrapper = (ROOT / 'scripts/nginx-diagnostics.sh').read_text().replace('/etc/nginx', str(base))
                (base / 'run.sh').write_text(wrapper)
                (base / 'run.sh').chmod(0o755)
                with socket.socket() as listener:
                    listener.bind(('127.0.0.1', 0))
                    port = listener.getsockname()[1]
                source = ROOT / 'scripts/nginx-frontend.conf'
                if not source.exists():
                    source = ROOT / 'nginx.conf'
                server = source.read_text().replace('/usr/share/nginx/html', str(base / 'www'))
                server = server.replace('listen       8080;', f'listen 127.0.0.1:{port};')
                server = server.replace('listen 3000;', f'listen 127.0.0.1:{port};')
                server = server.replace('${HUB_API_BACKEND}', '127.0.0.1:1')
                server = server.replace('/etc/nginx/staff-hub-proxy.conf', str(base / 'staff-hub-proxy.conf'))
                (base / 'staff-hub-proxy.conf').write_text('')
                # Failed readiness uses the exact shipped route with a forced
                # failure, so a success-only filter must leave this record in.
                server = server.replace('return 200 "ok\\n";', 'try_files /index-web.html =503;')
                server = server.replace('server {', 'server {\n location = /diagnostic-upstream { proxy_pass http://127.0.0.1:1; }', 1)
                (base / 'server.conf').write_text(server)
                (base / 'nginx.conf').write_text(
                    f'pid {base}/nginx.pid;\nerror_log stderr warn;\nevents {{}}\nhttp {{\n'
                    f'access_log /dev/stdout combined;\ninclude {base}/conf.d/00-logging.conf;\ninclude {base}/server.conf;\n}}\n')
                (base / 'bin/nginx').write_text(f'#!/bin/sh\nexec "{nginx}" -p "{base}" -c "{base}/nginx.conf" "$@"\n')
                (base / 'bin/nginx').chmod(0o755)
                with (base / 'stdout').open('w') as stdout, (base / 'stderr').open('w') as stderr:
                    process = subprocess.Popen(['sh', str(base / 'run.sh')], stdout=stdout, stderr=stderr,
                        env={**os.environ, 'PATH': str(base / 'bin') + os.pathsep + os.environ['PATH'],
                             'ACCESS_LOG_MODE': mode, 'LOG_LEVEL': 'WARNING'})
                    try:
                        for _ in range(100):
                            if process.poll() is not None:
                                self.fail((base / 'stderr').read_text())
                            try:
                                with socket.create_connection(('127.0.0.1', port), timeout=.1):
                                    break
                            except OSError:
                                time.sleep(.05)
                        def fetch(target):
                            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
                            connection.request('GET', target)
                            response = connection.getresponse()
                            response.read()
                            connection.close()
                            return response
                        def get(target):
                            return fetch(target).status
                        self.assertEqual(get('/healthz?code=private-query'), 200)
                        self.assertEqual(get('/asset.txt?code=private-query'), 200)
                        # A deployment swaps the brand's files without a new
                        # image, so they revalidate, and a missing one is no shell.
                        brand = fetch('/brand/brand.js?v=private-query')
                        self.assertEqual((brand.status, brand.getheader('Cache-Control')), (200, 'no-cache'))
                        self.assertEqual(get('/brand/icon.png?v=private-query'), 404)
                        self.assertEqual(get('/diagnostic-upstream?token=private-query'), 502)
                        (base / 'www/index.html').unlink()
                        (base / 'www/index-web.html').unlink()
                        self.assertEqual(get('/healthz?code=private-query'), 503)
                    finally:
                        process.terminate()
                        process.wait(timeout=5)
                raw = (base / 'stdout').read_text() + (base / 'stderr').read_text()
                self.assertNotIn('private-query', raw)
                events = [json.loads(line) for line in raw.splitlines()]
                accesses = [event for event in events if event['logger'] == 'nginx.access']
                self.assertEqual([event['status_code'] for event in accesses], [404, 502, 503] if mode == 'errors' else [200, 200, 404, 502, 503])
                self.assertEqual(accesses[-1]['log_level'], 'ERROR')
                self.assertTrue(any(event.get('reason') == 'upstream_connect_failed' for event in events))
                self.assertTrue(all(event['event'] for event in events))
                self.assertFalse((base / 'nginx.pid').exists(), 'nginx must stop when its wrapper receives TERM')
                self.assertEqual(process.returncode, 143)
                # A broken configuration must fail startup visibly, while its
                # potentially private directive value never reaches stderr.
                with (base / 'server.conf').open('a') as config:
                    config.write('\nprivate-directive private-value;\n')
                startup = subprocess.run(['sh', str(base / 'run.sh')], capture_output=True, text=True, timeout=5,
                    env={**os.environ, 'PATH': str(base / 'bin') + os.pathsep + os.environ['PATH'],
                         'ACCESS_LOG_MODE': mode, 'LOG_LEVEL': 'WARNING'})
                self.assertNotEqual(startup.returncode, 0)
                self.assertNotIn('private-', startup.stderr)
                self.assertTrue(any(json.loads(line).get('reason') == 'configuration_failed' for line in startup.stderr.splitlines()))


if __name__ == '__main__':
    unittest.main()
