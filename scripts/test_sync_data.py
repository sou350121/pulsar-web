"""Local tempfile tests; no pipeline data, sudo command, or network is used."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("sync_data", Path(__file__).with_name("sync-data.py"))
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


class AtomicSyncTests(unittest.TestCase):
    def setUp(self):
        temp_root = Path(os.environ.get("SYNC_TEST_TMPDIR", tempfile.gettempdir())).resolve()
        self.temp = tempfile.TemporaryDirectory(prefix="pulsar-sync-test-", dir=temp_root)
        self.root = Path(self.temp.name).resolve()
        self.root.relative_to(temp_root)  # Check containment before recursive fixture cleanup.
        self.addCleanup(self.temp.cleanup)
        self.memory = self.root / "memory"
        self.data = self.root / "data"
        self.memory.mkdir()
        self.data.mkdir()
        self.src = self.memory / "sample.json"
        self.dst = self.data / "sample.json"
        self.src.write_text('{"new": true}', encoding="utf-8")
        self.old = b'{"old": true}'
        self.dst.write_bytes(self.old)
        self.output = io.StringIO()
        self.redirect = contextlib.redirect_stdout(self.output)
        self.redirect.__enter__()
        self.addCleanup(self.redirect.__exit__, None, None, None)

    def copy(self, symlink=False, dry_run=False):
        return SYNC.copy_file(self.src, self.dst, dry_run, symlink, False)

    def assert_old_preserved(self):
        self.assertEqual(self.dst.read_bytes(), self.old)
        self.assertEqual(list(self.data.glob(".*.tmp")), [])

    def test_success_replaces_existing_file_and_preserves_source_mtime(self):
        os.utime(self.src, (1000000000, 1000000000))
        self.assertTrue(self.copy())
        self.assertEqual(json.loads(self.dst.read_text()), {"new": True})
        self.assertEqual(self.dst.stat().st_mtime_ns, self.src.stat().st_mtime_ns)
        self.assertEqual(list(self.data.glob(".*.tmp")), [])

    def test_interrupted_copy_preserves_previous_destination(self):
        def interrupted(_src, stage):
            self.assertEqual(stage.parent, self.dst.parent)
            self.assertNotEqual(stage, self.dst)
            stage.write_bytes(b'{"partial":')
            raise OSError("PRIVATE_CONTENT_MUST_NOT_BE_LOGGED")
        with patch.object(SYNC.shutil, "copy2", side_effect=interrupted), patch.object(SYNC.subprocess, "run") as sudo:
            self.assertFalse(self.copy())
            sudo.assert_not_called()
        self.assert_old_preserved()
        self.assertNotIn("PRIVATE_CONTENT_MUST_NOT_BE_LOGGED", self.output.getvalue())

    def test_invalid_json_preserves_previous_destination_without_content_in_logs(self):
        self.src.write_text('{"PRIVATE_CONTENT_MUST_NOT_BE_LOGGED":', encoding="utf-8")
        self.assertFalse(self.copy())
        self.assert_old_preserved()
        self.assertNotIn("PRIVATE_CONTENT_MUST_NOT_BE_LOGGED", self.output.getvalue())

    def test_nonfinite_json_is_rejected_for_browser_compatibility(self):
        self.src.write_text('{"value": NaN}', encoding="utf-8")
        self.assertFalse(self.copy())
        self.assert_old_preserved()

    def test_replace_failure_preserves_previous_destination(self):
        with patch.object(SYNC.os, "replace", side_effect=OSError("replace denied")):
            self.assertFalse(self.copy())
        self.assert_old_preserved()

    def test_failed_symlink_and_failed_fallback_preserve_previous_destination(self):
        with patch.object(Path, "symlink_to", side_effect=OSError("links unavailable")), patch.object(SYNC.shutil, "copy2", side_effect=OSError("copy interrupted")):
            self.assertFalse(self.copy(symlink=True))
        self.assert_old_preserved()

    def test_symlink_replace_failure_preserves_previous_destination(self):
        # Mock link creation so this failure test also runs without Windows link privileges.
        with patch.object(Path, "symlink_to") as link, patch.object(SYNC.os, "replace", side_effect=OSError("replace denied")):
            self.assertFalse(self.copy(symlink=True))
            link.assert_called_once_with(self.src.resolve())
        self.assert_old_preserved()

    def test_invalid_json_is_rejected_before_symlink_creation(self):
        self.src.write_text("not JSON", encoding="utf-8")
        with patch.object(Path, "symlink_to") as link:
            self.assertFalse(self.copy(symlink=True))
            link.assert_not_called()
        self.assert_old_preserved()

    def test_symlink_to_destination_itself_preserves_existing_file(self):
        self.src = self.dst
        self.assertFalse(self.copy(symlink=True))
        self.assert_old_preserved()

    def test_actual_symlink_atomically_replaces_old_file_when_supported(self):
        probe = self.root / "symlink-probe"
        try:
            probe.symlink_to(self.src)
        except OSError:
            self.skipTest("OS does not grant symlink creation")
        probe.unlink()
        self.assertTrue(self.copy(symlink=True))
        self.assertTrue(self.dst.is_symlink())
        self.assertEqual(self.dst.resolve(), self.src.resolve())
        self.assertEqual(json.loads(self.dst.read_text()), {"new": True})

    def test_permission_fallback_writes_only_staging_path(self):
        commands = []
        def sudo(args, **_kwargs):
            commands.append(args)
            if args[1] == "cp":
                stage = Path(args[-1])
                self.assertEqual(stage.parent, self.data)
                self.assertNotEqual(stage, self.dst)
                stage.write_bytes(self.src.read_bytes())
            return subprocess.CompletedProcess(args, 0, "", "")
        with patch.object(SYNC.shutil, "copy2", side_effect=PermissionError("protected source")), patch.object(SYNC.subprocess, "run", side_effect=sudo), patch.object(SYNC.os, "getuid", return_value=1000, create=True), patch.object(SYNC.os, "getgid", return_value=1000, create=True):
            self.assertTrue(self.copy())
        self.assertEqual([args[1] for args in commands], ["cp", "chown"])
        self.assertEqual(json.loads(self.dst.read_text()), {"new": True})

    def test_failed_sudo_does_not_expose_stderr_or_destroy_old_file(self):
        result = subprocess.CompletedProcess([], 1, "", "PRIVATE_CREDENTIAL_MUST_NOT_BE_LOGGED")
        with patch.object(SYNC.shutil, "copy2", side_effect=PermissionError()), patch.object(SYNC.subprocess, "run", return_value=result):
            self.assertFalse(self.copy())
        self.assert_old_preserved()
        self.assertNotIn("PRIVATE_CREDENTIAL_MUST_NOT_BE_LOGGED", self.output.getvalue())

    def test_dry_run_creates_no_directory_or_staging_file(self):
        self.dst = self.root / "absent-output" / "sample.json"
        self.assertTrue(self.copy(dry_run=True))
        self.assertFalse(self.dst.parent.exists())

    def test_manifest_success_records_transfer_errors_and_missing(self):
        self.assertTrue(SYNC.write_manifest(self.data, ["sample.json"], False, ["broken.json"], ["missing.json"]))
        manifest = json.loads((self.data / "_manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["files"], ["sample.json"])
        self.assertEqual(manifest["errors"], ["broken.json"])
        self.assertEqual(manifest["missing"], ["missing.json"])
        self.assertNotIn("source_updated_at", manifest)

    def test_failed_manifest_replace_preserves_previous_manifest(self):
        manifest = self.data / "_manifest.json"
        manifest.write_bytes(self.old)
        with patch.object(SYNC.os, "replace", side_effect=OSError("replace denied")):
            self.assertFalse(SYNC.write_manifest(self.data, [], False))
        self.assertEqual(manifest.read_bytes(), self.old)
        self.assertEqual(list(self.data.glob(".*.tmp")), [])

    def test_manifest_dry_run_creates_nothing(self):
        output = self.root / "absent-manifest-output"
        self.assertTrue(SYNC.write_manifest(output, ["sample.json"], True))
        self.assertFalse(output.exists())

    def test_data_dir_override_isolated_export_and_manifest_failures(self):
        output = self.root / "isolated-export"
        self.src.write_text("not JSON", encoding="utf-8")
        with patch.object(SYNC, "MEMORY_DIR", self.memory), patch.object(SYNC, "MEMORY_TMP_DIR", self.root / "missing-tmp"), patch.object(SYNC, "DATA_DIR", self.data), patch.object(SYNC, "JSON_FILES", ["sample.json", "missing.json"]), patch.object(SYNC, "MARKDOWN_PATTERNS", []), patch.object(sys, "argv", ["sync-data.py", "--data-dir", str(output)]):
            with self.assertRaises(SystemExit) as failure:
                SYNC.main()
        self.assertEqual(failure.exception.code, 1)
        self.assert_old_preserved()
        manifest = json.loads((output / "_manifest.json").read_text())
        self.assertEqual(manifest["errors"], ["sample.json"])
        self.assertEqual(manifest["missing"], ["missing.json"])

    def test_main_dry_run_keeps_override_directory_absent(self):
        output = self.root / "isolated-dry-run"
        with patch.object(SYNC, "MEMORY_DIR", self.memory), patch.object(SYNC, "MEMORY_TMP_DIR", self.root / "missing-tmp"), patch.object(SYNC, "JSON_FILES", ["sample.json"]), patch.object(SYNC, "MARKDOWN_PATTERNS", []), patch.object(sys, "argv", ["sync-data.py", "--data-dir", str(output), "--dry-run"]):
            SYNC.main()
        self.assertFalse(output.exists())
        self.assert_old_preserved()


if __name__ == "__main__":
    unittest.main()
