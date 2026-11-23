import os
import tempfile

# Must be set before mago.config is imported: tests never touch the real library.
os.environ["MAGO_DATA"] = tempfile.mkdtemp(prefix="mago-test-")

import pytest  # noqa: E402

from mago import db  # noqa: E402


@pytest.fixture
def conn(tmp_path):
    connection = db.connect(tmp_path / "test.db")
    yield connection
    connection.close()
