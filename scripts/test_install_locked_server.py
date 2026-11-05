"""Exercise the supplied-lock installer without contacting a package index."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("install_locked_server.py")
spec = importlib.util.spec_from_file_location("install_locked_server", SCRIPT)
installer = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = installer
spec.loader.exec_module(installer)

LOCK = "pyjwt==2.15.1 \\\n    --hash=sha256:" + "a" * 64 + "\n"
SERVER = "1" * 40
ANTON = "2" * 40


class Distribution:
    def __init__(self, name, version, direct=None):
        self.metadata = {"Name": name}
        self.version = version
        self.direct = direct

    def read_text(self, name):
        return json.dumps(self.direct) if self.direct else None


def distributions():
    result = [Distribution("PyJWT", "2.15.1")]
    for name, commit in (("cowork-server", SERVER), ("anton-agent", ANTON)):
        result.append(Distribution(name, "1.0.0", {
            "url": installer.GIT_PACKAGES[name],
            "vcs_info": {"vcs": "git", "commit_id": commit},
        }))
    return result


def contract(root: Path) -> tuple[Path, Path]:
    lock = root / "requirements.lock"
    lock.write_text(LOCK)
    sources = root / "sources.json"
    sources.write_text(json.dumps({"sources": {
        "cowork-server": {"version": "1.0.0", "commit": SERVER},
        "anton-agent": {"version": "1.0.0", "commit": ANTON},
    }}))
    return lock, sources


class ContractTests(unittest.TestCase):
    def test_lock_requires_hashes_and_rejects_install_options(self):
        self.assertEqual(installer.read_lock(LOCK), {"pyjwt": "2.15.1"})
        for invalid in ("pyjwt==2.15.1\n", LOCK + "--index-url https://example.test\n",
                        LOCK + LOCK, LOCK.replace("pyjwt", "anton-agent"),
                        LOCK.replace("==", ">="), LOCK.replace("sha256:", "md5:")):
            with self.subTest(lock=invalid), self.assertRaises(ValueError):
                installer.read_lock(invalid)

    def test_every_distribution_and_git_origin_must_match(self):
        expected = installer.expected_packages(LOCK, "1.0.0", SERVER, "1.0.0", ANTON)
        installer.verify_packages(expected, distributions())
        changed = distributions()
        changed[0].version = "2.16.0"
        cases = [changed, distributions()[1:], distributions() + [Distribution("extra", "1.0")],
                 distributions() + [distributions()[0]]]
        changed = distributions()
        changed[1].direct["vcs_info"]["commit_id"] = ANTON
        cases.append(changed)
        changed = distributions()
        changed[0].direct = {"url": "https://example.test/pyjwt.whl"}
        cases.append(changed)
        for actual in cases:
            with self.subTest(actual=actual), self.assertRaises(ValueError):
                installer.verify_packages(expected, actual)

    def test_git_packages_require_the_recorded_origin(self):
        expected = installer.expected_packages(LOCK, "1.0.0", SERVER, "1.0.0", ANTON)
        for index in (1, 2):
            for change in ("missing", "repository", "vcs", "commit"):
                actual = distributions()
                if change == "missing":
                    actual[index].direct = None
                elif change == "repository":
                    actual[index].direct["url"] = "https://example.test/other.git"
                elif change == "vcs":
                    actual[index].direct["vcs_info"]["vcs"] = "hg"
                else:
                    del actual[index].direct["vcs_info"]["commit_id"]
                with self.subTest(package=index, change=change), self.assertRaises(ValueError):
                    installer.verify_packages(expected, actual)

    def test_floor_and_immutable_source_pins(self):
        for lock, commit in ((LOCK.replace("2.15.1", "2.12.0"), SERVER),
                             (LOCK.replace("2.15.1", "2.13.0rc1"), SERVER),
                             (LOCK, "main")):
            with self.subTest(lock=lock, commit=commit), self.assertRaises(ValueError):
                installer.expected_packages(lock, "1.0.0", commit, "1.0.0", ANTON)

    def test_install_commands_disable_dependency_resolution_before_import(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock, sources = contract(root)
            venv = root / "venv"
            calls = []

            def run(command, **kwargs):
                self.assertTrue(kwargs.get("check"))
                calls.append(command)
                if command[:2] == ["uv", "venv"]:
                    venv.mkdir()
                return subprocess.CompletedProcess(command, 0)

            with patch.object(installer.subprocess, "run", side_effect=run):
                installer.install(lock, sources, venv)
            installs = [call for call in calls if call[:3] == ["uv", "pip", "install"]]
            self.assertEqual(len(installs), 2)
            self.assertTrue(all("--no-deps" in call for call in installs))
            self.assertIn("--require-hashes", installs[0])
            self.assertIn("--only-binary", installs[0])
            self.assertEqual(installs[0][installs[0].index("--only-binary") + 1], ":all:")
            self.assertTrue(any(SERVER in part for part in installs[1]))
            self.assertTrue(any(ANTON in part for part in installs[1]))
            self.assertIn("check", calls[-2])
            self.assertIn("from cowork.server import app", calls[-1][-1])
            self.assertEqual((venv / installer.MARKER_NAME).read_text().strip(),
                             hashlib.sha256(LOCK.encode()).hexdigest())

    def test_existing_environment_is_refused_before_any_installer_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock, sources = contract(root)
            venv = root / "venv"
            venv.mkdir()
            existing = venv / "keep.txt"
            existing.write_text("existing environment")
            with patch.object(installer.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "requires a new environment"):
                    installer.install(lock, sources, venv)
            run.assert_not_called()
            self.assertEqual(existing.read_text(), "existing environment")
            self.assertFalse((venv / installer.MARKER_NAME).exists())

    def test_each_failed_stage_stops_before_success_marker(self):
        stages = ("venv", "registry", "git", "verify", "check", "import")
        for failed in stages:
            with self.subTest(stage=failed), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                lock, sources = contract(root)
                venv = root / "venv"
                calls = []

                def run(command, **kwargs):
                    if command[:2] == ["uv", "venv"]:
                        stage = "venv"
                    elif "--require-hashes" in command:
                        stage = "registry"
                    elif command[:3] == ["uv", "pip", "install"]:
                        stage = "git"
                    elif "verify" in command:
                        stage = "verify"
                    elif command[:3] == ["uv", "pip", "check"]:
                        stage = "check"
                    else:
                        self.assertIn("from cowork.server import app", command[-1])
                        stage = "import"
                    calls.append(stage)
                    self.assertTrue(kwargs.get("check"))
                    if stage == failed:
                        raise subprocess.CalledProcessError(1, command)
                    if stage == "venv":
                        venv.mkdir()
                    return subprocess.CompletedProcess(command, 0)

                with patch.object(installer.subprocess, "run", side_effect=run):
                    with self.assertRaises(subprocess.CalledProcessError):
                        installer.install(lock, sources, venv)
                self.assertEqual(calls, list(stages[:stages.index(failed) + 1]))
                self.assertFalse((venv / installer.MARKER_NAME).exists())


if __name__ == "__main__":
    unittest.main()
