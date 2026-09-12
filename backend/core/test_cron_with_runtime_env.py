import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .cron_with_runtime_env import load_runtime_environment, main


class CronRuntimeEnvironmentTests(unittest.TestCase):
    def test_loads_valid_pid1_entries_without_printing_values(self):
        with tempfile.NamedTemporaryFile(delete=False) as stream:
            stream.write(b"DATABASE_URL=postgres://runtime\0REDIS_URL=redis://runtime\0BAD-KEY=x\0")
            env_path = Path(stream.name)
        try:
            with patch.dict(os.environ, {}, clear=True):
                loaded = load_runtime_environment(env_path)
                self.assertEqual(loaded, 2)
                self.assertEqual(os.environ["DATABASE_URL"], "postgres://runtime")
                self.assertEqual(os.environ["REDIS_URL"], "redis://runtime")
                self.assertNotIn("BAD-KEY", os.environ)
        finally:
            env_path.unlink(missing_ok=True)

    @patch("core.cron_with_runtime_env.os.execvp")
    @patch("core.cron_with_runtime_env.load_runtime_environment")
    @patch("core.cron_with_runtime_env.os.chdir")
    def test_main_executes_requested_python_command(self, chdir_mock, load_mock, exec_mock):
        with patch("sys.argv", ["cron_with_runtime_env.py", "manage.py", "check"]):
            main()

        load_mock.assert_called_once_with()
        chdir_mock.assert_called_once_with("/app")
        exec_mock.assert_called_once()
        executable, argv = exec_mock.call_args.args
        self.assertEqual(executable, argv[0])
        self.assertEqual(argv[1:], ["manage.py", "check"])


if __name__ == "__main__":
    unittest.main()
