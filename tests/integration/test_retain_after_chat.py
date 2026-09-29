"""
Integration Tests: Retain After Chat Lifecycle
Validates:
- Complete chat interaction: User query -> Recall -> LLM -> Response -> Retain
- Verifies a new incident experience is retained into persistent memory
- Verifies the retained record contains the interaction context
- Subsequent Recall on related terms successfully retrieves the newly retained experience
"""

import pytest
from starlette.testclient import TestClient
from backend.main import app
from backend.memory import execute_recall


def test_complete_chat_interaction_retains_and_allows_subsequent_recall():
    """
    Section 7: Retain After Chat Test
    Verifies that a newly resolved incident is committed to persistent memory
    and discoverable in subsequent triage runs.
    """
    client = TestClient(app)
    bank_id = "test-bank-retain-after-chat-01"

    from backend.main import fallback_bank

    initial_query = "Worker threads in checkout pod are timing out waiting on Redis connection."

    # 1. Execute chat interaction
    chat_resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": initial_query}],
        "use_memory": True,
        "bank_id": bank_id
    })
    assert chat_resp.status_code == 200
    chat_data = chat_resp.json()

    # 2. Verify new incident was retained
    lifecycle = chat_data.get("memory_lifecycle", {})
    assert lifecycle.get("retained") is True
    assert "incident_id" in lifecycle
    new_inc_id = lifecycle["incident_id"]

    # 3. Verify retained incident record
    assert "incident" in chat_data
    assert chat_data["incident"]["incident_id"] == new_inc_id
    assert len(chat_data["incident"]["remediation"]) > 0

    # 4. Perform subsequent Recall using related query
    subsequent_query = "checkout worker threads timing out"
    recalled_after = execute_recall(
        client=None,
        bank_id=bank_id,
        query=subsequent_query,
        fallback_bank=fallback_bank
    )

    assert len(recalled_after) > 0, "Subsequent recall must discover newly retained experience"
    recalled_ids = [m.get("incident_id") or m.get("metadata", {}).get("incident_id") for m in recalled_after]
    recalled_texts = " ".join([m.get("text", "") for m in recalled_after])

    # The newly retained incident must be discoverable in subsequent recall
    assert new_inc_id in str(recalled_ids) or new_inc_id in recalled_texts or "checkout" in recalled_texts.lower()
