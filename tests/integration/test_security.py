"""
Section 17: Security & Data Privacy Tests

Validates:
- API keys (Groq, Hindsight) are never exposed in API responses
- .env is listed in .gitignore
- Frontend source contains no hardcoded API keys
- Internal Python/SDK objects (<RecallResult...>, <Object...>) are not leaked
- Unhandled stack traces are not returned to clients
- User input containing HTML/script tags or SQL/JSON characters is handled safely
- Workspace isolation prevents cross-workspace memory access
"""

import os
from pathlib import Path
import pytest
from starlette.testclient import TestClient
from backend.main import (
    app,
    HINDSIGHT_API_KEY,
    GROQ_API_KEY
)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_api_keys_not_exposed_in_api_responses(client):
    """
    Ensure secret API keys are never included in responses from health, config, chat, or reflect.
    """
    endpoints = [
        client.get("/api/health"),
        client.get("/api/config"),
        client.post("/api/chat", json={"messages": [{"role": "user", "content": "Security check"}], "use_memory": False}),
        client.get("/api/incidents"),
        client.get("/api/reflect")
    ]

    for resp in endpoints:
        assert resp.status_code == 200
        text = resp.text
        if GROQ_API_KEY and len(GROQ_API_KEY) > 8 and not GROQ_API_KEY.startswith("your_"):
            assert GROQ_API_KEY not in text, f"SECURITY LEAK: GROQ_API_KEY exposed in {resp.url}"
        if HINDSIGHT_API_KEY and len(HINDSIGHT_API_KEY) > 8 and not HINDSIGHT_API_KEY.startswith("your_"):
            assert HINDSIGHT_API_KEY not in text, f"SECURITY LEAK: HINDSIGHT_API_KEY exposed in {resp.url}"


def test_env_is_ignored_in_gitignore():
    """
    Ensure .env is explicitly excluded in .gitignore to prevent secret leaks to VCS.
    """
    gitignore_path = Path(__file__).resolve().parent.parent.parent / ".gitignore"
    assert gitignore_path.exists(), ".gitignore file must exist"
    content = gitignore_path.read_text(encoding="utf-8")
    assert ".env" in content, ".env must be ignored in .gitignore"


def test_no_hardcoded_secrets_in_frontend_source():
    """
    Scan frontend source files to ensure no hardcoded API keys or secret tokens exist.
    """
    src_dir = Path(__file__).resolve().parent.parent.parent / "frontend" / "src"
    if not src_dir.exists():
        pytest.skip("frontend/src directory not present")

    import re
    for file_path in src_dir.rglob("*.js*"):
        content = file_path.read_text(encoding="utf-8")
        # Ensure no actual live Groq secret key (which begins with gsk_ followed by 20+ alphanumerics)
        assert not re.search(r'gsk_[a-zA-Z0-9]{20,}', content), f"Actual Groq secret key found in {file_path.name}"
        assert "HINDSIGHT_API_KEY = " not in content, f"Hardcoded Hindsight key found in {file_path.name}"


def test_internal_python_objects_not_serialized(client):
    """
    Verify raw Python repr strings (e.g. <RecallResult ...> or <hindsight_client ...>)
    are never returned to frontend clients.
    """
    resp = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": "Production checkout is timing out again."}],
            "use_memory": True
        }
    )
    assert resp.status_code == 200
    text = resp.text
    assert "<RecallResult" not in text
    assert "<backend." not in text
    assert "object at 0x" not in text


def test_malicious_user_input_safety(client):
    """
    Verify user queries with script tags, injection payloads, or nested control characters
    do not crash the backend or cause 500 exceptions.
    """
    payloads = [
        "<script>alert('xss')</script>",
        "'; DROP TABLE incidents; --",
        '{"nested": {"injection": true}}',
        "A" * 5000,  # Large payload buffer
        "\x00\x01\x02\x03",  # Non-printable control characters
    ]

    for p in payloads:
        resp = client.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": p}],
                "use_memory": False
            }
        )
        assert resp.status_code == 200, f"API failed on payload: {p[:30]}"
        data = resp.json()
        assert "response" in data
        assert "analysis" in data


def test_workspace_isolation_security():
    """
    Verify workspace identifiers cannot accidentally access another workspace's memory.
    """
    from backend.memory import execute_retain, execute_recall, IncidentRecord
    from backend.main import hindsight_client, fallback_bank

    bank_alpha = "workspace-alpha-restricted"
    bank_beta = "workspace-beta-restricted"

    secret_incident = IncidentRecord(
        incident_id="INC-SEC-ALPHA-CONFIDENTIAL",
        service="AuthVault",
        environment="production",
        severity="P1",
        symptoms="Vault token decryption failure",
        investigation="Investigated internal alpha encryption key",
        root_cause="Alpha key rotation mismatch",
        remediation="Rotated master key for workspace alpha",
        verification="Verified auth tokens decrypted",
        tags=["alpha", "confidential"]
    )

    execute_retain(
        client=hindsight_client,
        bank_id=bank_alpha,
        incident_data=secret_incident,
        fallback_bank=fallback_bank
    )

    # Attempt to recall from workspace beta
    beta_memories = execute_recall(
        client=hindsight_client,
        query="Vault token decryption failure and alpha key",
        bank_id=bank_beta,
        fallback_bank=fallback_bank
    )

    combined = " ".join([m.get("text", "") for m in beta_memories]).lower()
    assert "inc-sec-alpha-confidential" not in combined
    assert "alpha key rotation mismatch" not in combined
