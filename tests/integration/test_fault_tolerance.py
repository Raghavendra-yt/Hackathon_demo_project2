"""
Fault Tolerance Tests (Sections 12, 13, 14, 15)

Validates robust failure handling across all MemOS components:
- Section 12: Hindsight failure simulation (unavailable/error during recall)
- Section 13: LLM failure simulation (timeout/exception/unavailable Groq)
- Section 14: Retain failure simulation (failed persistence after LLM response)
- Section 15: Reflect failure simulation (failed consolidation does not break chat)
"""

import pytest
from unittest.mock import MagicMock, patch
from starlette.testclient import TestClient
from backend.main import app
from backend.memory import (
    execute_recall,
    execute_retain,
    execute_reflect,
    parse_reflect_response,
    IncidentRecord
)


# =========================================================================
# Section 12: Hindsight Failure Test
# =========================================================================
def test_hindsight_recall_failure_graceful_fallback():
    """
    Simulate Hindsight throwing network/API error during recall.
    Verify:
    - execute_recall does not crash and returns []
    - /api/chat does not crash (returns 200)
    - App does not claim memories were recalled
    - Fallback response is cleanly produced
    """
    failing_client = MagicMock()
    failing_client.recall.side_effect = ConnectionError("Hindsight API unreachable: 503 Service Unavailable")

    failing_fallback = MagicMock()
    failing_fallback.recall.side_effect = RuntimeError("Local fallback storage corrupted")

    # 1. Direct function call test
    recalled = execute_recall(
        client=failing_client,
        query="Production checkout is timing out again.",
        bank_id="test-bank",
        fallback_bank=failing_fallback
    )
    assert recalled == [], "On total Hindsight failure, execute_recall must return empty list safely"

    # 2. API endpoint integration test with patched execute_recall failure
    client = TestClient(app)
    with patch("backend.main.execute_recall", side_effect=Exception("Hindsight connection timeout")):
        response = client.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "Checkout service is timing out"}],
                "use_memory": True
            }
        )
        assert response.status_code == 200, "Chat API must not crash if recall fails"
        data = response.json()
        assert data.get("recalled_memories") == [], "App must not claim memories were recalled when recall fails"
        assert "analysis" in data
        assert "root_cause_hypotheses" in data


# =========================================================================
# Section 13: LLM Failure Test
# =========================================================================
def test_llm_failure_simulation():
    """
    Simulate Groq API timeout or service failure.
    Verify:
    - API handles failure gracefully via autonomous DevOps fallback engine
    - Response structure is maintained
    - No corrupted incident data is created
    """
    client = TestClient(app)

    # Patch groq_client to raise TimeoutError
    failing_groq = MagicMock()
    failing_groq.chat.completions.create.side_effect = TimeoutError("Groq gateway timed out after 30s")

    with patch("backend.main.groq_client", failing_groq):
        response = client.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "Production payment gateway returns 502"}],
                "use_memory": False
            }
        )
        assert response.status_code == 200
        data = response.json()

        # Autonomous fallback engine should have kicked in
        assert "analysis" in data
        assert "root_cause_hypotheses" in data
        assert "recommended_actions" in data
        assert "verification_steps" in data
        assert len(data["root_cause_hypotheses"]) > 0


# =========================================================================
# Section 14: Retain Failure Test
# =========================================================================
def test_retain_failure_simulation():
    """
    Simulate Retain failure after a successful LLM generation.
    Verify:
    - User response is still delivered to client (chat doesn't crash)
    - System does NOT report successful retention
    - Failure is flagged in memory_lifecycle and retained_record
    """
    client = TestClient(app)

    with patch("backend.main.execute_retain", side_effect=IOError("Disk quota exceeded on memory store")):
        response = client.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "Redis memory saturation incident"}],
                "use_memory": True
            }
        )
        assert response.status_code == 200
        data = response.json()

        # The chat response was still generated
        assert "response" in data
        # Retained record must indicate failure, not success
        lifecycle = data.get("memory_lifecycle", {})
        assert lifecycle.get("retained") is False, "System must not claim experience was retained when retain failed"
        retained = data.get("retained_record", {})
        assert retained.get("success") is False
        assert "Disk quota exceeded" in str(retained.get("error", ""))


# =========================================================================
# Section 15: Reflect Failure Test
# =========================================================================
def test_reflect_failure_simulation():
    """
    Simulate Reflect failure during consolidation.
    Verify:
    - /api/reflect returns controlled result instead of unhandled 500 crash
    - Mental model does not invent fake facts
    - Normal chat continues uninterrupted
    """
    client = TestClient(app)

    # 1. Direct parse_reflect_response on None
    fallback_reflection = parse_reflect_response(None, bank_id="test-bank")
    assert fallback_reflection["mental_model"] == "No operational reflection available."
    assert fallback_reflection["supporting_incidents"] == []
    assert fallback_reflection["patterns"] == []

    # 2. Reflect endpoint when backend throws error
    with patch("backend.main.execute_reflect", side_effect=RuntimeError("Vector index corrupted")):
        response = client.post("/api/reflect", json={"query": "Synthesize patterns"})
        assert response.status_code == 200
        data = response.json()
        assert data.get("mental_model") == "No operational reflection available."
        assert data.get("supporting_incidents") == []

    # 3. Verify normal chat endpoint continues to function without degradation
    chat_resp = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": "Health check query"}],
            "use_memory": False
        }
    )
    assert chat_resp.status_code == 200
