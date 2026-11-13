"""In CI the season's table needs the private data (ADR 0029); a local run may go without it."""

import pytest
from rows import require_private_data


def test_ci_without_private_data_is_refused_naming_it():
    with pytest.raises(SystemExit, match="PRIVATE_DATA is not set"):
        require_private_data({"CI": "true"})
    with pytest.raises(SystemExit, match="PRIVATE_DATA"):
        require_private_data({"CI": "true", "PRIVATE_DATA": ""})


def test_a_local_run_and_a_ci_run_with_it_go_ahead():
    require_private_data({})
    require_private_data({"CI": "true", "PRIVATE_DATA": "/w/private"})
