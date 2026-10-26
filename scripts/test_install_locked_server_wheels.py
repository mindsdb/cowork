"""Check the installer's uv flags against real local artifacts, without a network.

The command-order tests cover the production call site. These tests exercise uv's
hash/cache and wheel-only behavior. CI installs the Docker image's uv 0.7.22;
local runs use the available uv and clearly skip when it is absent.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile


def write_wheel(directory: Path) -> Path:
    name = "locked_server_probe"
    info = f"{name}-1.0.0.dist-info"
    files = {
        f"{name}/__init__.py": b'VALUE = "exact wheel"\n',
        f"{info}/METADATA": (
            b"Metadata-Version: 2.1\nName: locked-server-probe\nVersion: 1.0.0\n\n"
        ),
        f"{info}/WHEEL": (
            b"Wheel-Version: 1.0\nGenerator: stdlib-test-fixture\n"
            b"Root-Is-Purelib: true\nTag: py3-none-any\n\n"
        ),
    }
    records = io.StringIO()
    writer = csv.writer(records, lineterminator="\n")
    for path, data in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        writer.writerow((path, "sha256=" + digest, len(data)))
    writer.writerow((f"{info}/RECORD", "", ""))
    files[f"{info}/RECORD"] = records.getvalue().encode()
    wheel = directory / f"{name}-1.0.0-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, data in files.items():
            archive.writestr(path, data)
    return wheel


class WheelInstallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.uv = shutil.which("uv")
        if cls.uv is None:
            message = "real-wheel tests require uv; install uv==0.7.22 to run them"
            if os.environ.get("CI"):
                raise RuntimeError(message)
            raise unittest.SkipTest(message)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="locked-server-wheels-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.wheelhouse = self.root / "wheels"
        self.wheelhouse.mkdir()
        self.wheel = write_wheel(self.wheelhouse)
        digest = hashlib.sha256(self.wheel.read_bytes()).hexdigest()
        self.good_lock = self.root / "good.lock"
        self.good_lock.write_text(f"locked-server-probe==1.0.0 --hash=sha256:{digest}\n")
        self.bad_lock = self.root / "bad.lock"
        self.bad_lock.write_text("locked-server-probe==1.0.0 --hash=sha256:" + "0" * 64 + "\n")
        self.cache = self.root / "cache"
        # A developer's uv settings must not alter the isolated fixture install.
        self.environment = {
            key: value for key, value in os.environ.items()
            if not key.startswith(("UV_", "PYTHON")) and key != "VIRTUAL_ENV"
        }

    def command(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, env=self.environment, cwd=self.root,
                              text=True, capture_output=True, timeout=30)

    def new_venv(self, name: str) -> Path:
        venv = self.root / name
        result = self.command([
            self.uv, "venv", "--no-config", "--no-python-downloads", "--offline",
            "--cache-dir", str(self.cache), "--python", sys.executable, str(venv),
        ])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

    def install(self, python: Path, lock: Path, directory: Path | None = None):
        return self.command([
            self.uv, "pip", "install", "--no-config", "--python", str(python),
            "--no-deps", "--require-hashes", "--only-binary", ":all:",
            "--no-index", "--offline", "--find-links", str(directory or self.wheelhouse),
            "--cache-dir", str(self.cache), "-r", str(lock),
        ])

    def assert_installed(self, python: Path, installed: bool):
        if installed:
            code = "import locked_server_probe; assert locked_server_probe.VALUE == 'exact wheel'"
        else:
            code = "import importlib.util; assert importlib.util.find_spec('locked_server_probe') is None"
        result = self.command([str(python), "-I", "-c", code])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_correct_hash_with_cold_and_warm_cache(self):
        for state in ("cold", "warm"):
            with self.subTest(cache=state):
                python = self.new_venv(state)
                result = self.install(python, self.good_lock)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assert_installed(python, True)

    def test_wrong_hash_with_cold_cache(self):
        python = self.new_venv("cold-bad")
        result = self.install(python, self.bad_lock)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Hash mismatch", result.stderr)
        self.assert_installed(python, False)

    def test_wrong_hash_with_warm_cache(self):
        seed = self.new_venv("seed")
        result = self.install(seed, self.good_lock)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_installed(seed, True)
        # A fresh venv is essential: uv does not recheck a matching installed
        # version's hash. The production installer separately refuses reuse.
        python = self.new_venv("warm-bad")
        result = self.install(python, self.bad_lock)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Hash mismatch", result.stderr)
        self.assert_installed(python, False)

    def test_sdist_only_candidate_is_rejected_without_running_its_backend(self):
        directory = self.root / "sdists"
        directory.mkdir()
        attempted = self.root / "backend-ran"
        backend = (
            "from pathlib import Path\n"
            "def attempted(*args, **kwargs):\n"
            f"    Path({str(attempted)!r}).touch()\n"
            "    raise RuntimeError('wheel-only installation must not build an sdist')\n"
            "get_requires_for_build_wheel = attempted\n"
            "prepare_metadata_for_build_wheel = attempted\n"
            "build_wheel = attempted\n"
        )
        files = {
            "PKG-INFO": "Metadata-Version: 2.1\nName: locked-server-sdist\nVersion: 1.0.0\n\n",
            "pyproject.toml": (
                '[build-system]\nrequires = []\nbuild-backend = "probe_backend"\n'
                'backend-path = ["."]\n'
            ),
            "probe_backend.py": backend,
        }
        sdist = directory / "locked_server_sdist-1.0.0.tar.gz"
        with tarfile.open(sdist, "w:gz") as archive:
            for filename, text in files.items():
                data = text.encode()
                info = tarfile.TarInfo("locked_server_sdist-1.0.0/" + filename)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        digest = hashlib.sha256(sdist.read_bytes()).hexdigest()
        lock = self.root / "sdist.lock"
        lock.write_text(f"locked-server-sdist==1.0.0 --hash=sha256:{digest}\n")
        python = self.new_venv("sdist-only")
        result = self.install(python, lock, directory)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("has no usable wheels", " ".join(result.stderr.split()))
        self.assertFalse(attempted.exists(), result.stderr)
        check = self.command([
            str(python), "-I", "-c",
            "from importlib.metadata import distributions; assert not list(distributions())",
        ])
        self.assertEqual(check.returncode, 0, check.stdout + check.stderr)


if __name__ == "__main__":
    unittest.main()
