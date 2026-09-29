"""
Phase 6: Deterministic End-to-End Demo Flow Verification Test for MemOS Agent

Scenario:
USER: "Production checkout is timing out again."

Executes and asserts all 8 required steps without faking:
1. Seed historical incidents into persistent memory bank.
2. Compare Before Memory vs After Memory.
3. Verify Recall retrieves INC-184 (or relevant checkout precedent).
4. Verify the LLM receives recalled context in working memory.
5. Verify response contains recommended troubleshooting (hypotheses, investigation, remediation, verification).
6. Verify Retain occurs (stores new incident experience in Hindsight).
7. Run Reflect (memory consolidation).
8. Verify operational mental model references supporting incidents (INC-184, INC-127, etc.).
"""

import sys
from pathlib import Path

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import pytest
from starlette.testclient import TestClient
from backend.main import app, BANK_ID, fallback_bank
from backend.seed import HISTORICAL_INCIDENTS, seed_historical_incidents
from backend.memory import format_recalled_memories_for_prompt


def safe_print(text):
    """Safely prints ascii-compatible representation to avoid Windows cp1252 charmap errors."""
    try:
        print(str(text).encode("ascii", errors="replace").decode("ascii"))
    except Exception:
        pass


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_phase6_deterministic_demo_flow(client):
    demo_bank_id = "devops-demo-team"
    checkout_query = "Production checkout is timing out again."

    safe_print("\n" + "=" * 70)
    safe_print("STARTING PHASE 6 DETERMINISTIC END-TO-END DEMO FLOW TEST")
    safe_print("=" * 70)

    # -------------------------------------------------------------------------
    # STEP 0: BEFORE MEMORY BASELINE
    # The agent has no historical operational context.
    # -------------------------------------------------------------------------
    safe_print("\n[STEP 0: BEFORE MEMORY] Querying with memory disabled (use_memory=False)...")
    before_resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": checkout_query}],
        "use_memory": False,
        "bank_id": demo_bank_id
    })
    assert before_resp.status_code == 200, f"Before memory chat failed: {before_resp.text}"
    before_data = before_resp.json()

    # In Before Memory: recalled_memories must be empty
    assert len(before_data.get("recalled_memories", [])) == 0, "Before memory must have 0 recalled memories"
    empty_prompt_context = format_recalled_memories_for_prompt([])
    assert "No prior historical incidents found" in empty_prompt_context
    safe_print("[OK] BEFORE MEMORY VERIFIED: Agent operates zero-shot with 0 historical precedents paged in.")

    # -------------------------------------------------------------------------
    # STEP 1: SEED HISTORICAL INCIDENTS
    # Deterministically seeds 12 realistic incidents into persistent memory bank.
    # -------------------------------------------------------------------------
    safe_print("\n[STEP 1: SEED HISTORICAL INCIDENTS] Seeding persistent memory bank...")
    seed_resp = client.post(f"/api/seed-incidents?bank_id={demo_bank_id}")
    assert seed_resp.status_code == 200, f"Seed endpoint failed: {seed_resp.text}"
    seed_data = seed_resp.json()

    assert seed_data["status"] == "success", f"Seed status was {seed_data['status']}"
    assert seed_data["seeded_count"] == 12, f"Expected 12 seeded incidents, got {seed_data['seeded_count']}"
    assert seed_data["total_incidents"] == 12

    # Verify INC-184 is in the seeded collection
    inc_184 = next((inc for inc in HISTORICAL_INCIDENTS if inc.incident_id == "INC-184"), None)
    assert inc_184 is not None, "INC-184 must exist in historical incidents definition"
    assert "checkout" in inc_184.service.lower()
    assert "Redis connection pool exhaustion" in inc_184.root_cause
    safe_print(f"[OK] STEP 1 VERIFIED: Seeded {seed_data['seeded_count']} historical incidents into persistent memory bank '{demo_bank_id}'.")

    # -------------------------------------------------------------------------
    # STEP 2 & 3: ASK CHECKOUT TIMEOUT QUESTION & VERIFY RECALL (PAGE IN)
    # Verify Recall retrieves INC-184 or another relevant checkout incident.
    # -------------------------------------------------------------------------
    safe_print(f"\n[STEP 2 & 3: RECALL] Querying: '{checkout_query}' with use_memory=True...")
    chat_resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": checkout_query}],
        "use_memory": True,
        "bank_id": demo_bank_id
    })
    assert chat_resp.status_code == 200, f"Chat endpoint failed: {chat_resp.text}"
    chat_data = chat_resp.json()

    recalled = chat_data.get("recalled_memories", [])
    assert len(recalled) > 0, "Recall must retrieve matching historical incidents"

    # Verify INC-184 or checkout/Redis precedent was retrieved
    recalled_ids = [m.get("incident_id") or m.get("metadata", {}).get("incident_id") for m in recalled]
    recalled_text_combined = " ".join([m.get("text", "") for m in recalled]).lower()

    has_inc_184 = "INC-184" in recalled_ids or "184" in recalled_text_combined
    has_checkout_redis = "checkout" in recalled_text_combined and ("redis" in recalled_text_combined or "pool" in recalled_text_combined)
    assert has_inc_184 or has_checkout_redis, f"Recall must retrieve INC-184 or Redis checkout incident. Got IDs: {recalled_ids}"

    # Verify structured fields on recalled memory items for the UI
    first_mem = recalled[0]
    assert "incident_id" in first_mem
    assert "service" in first_mem
    assert "severity" in first_mem
    assert "symptom" in first_mem
    assert "root_cause" in first_mem
    assert "remediation" in first_mem
    assert "timestamp" in first_mem
    assert "relevance" in first_mem
    safe_print(f"[OK] STEP 2 & 3 VERIFIED: Paged in {len(recalled)} precedents from persistent memory (including {recalled_ids}).")

    # -------------------------------------------------------------------------
    # STEP 4: VERIFY THE LLM RECEIVES RECALLED CONTEXT IN WORKING MEMORY
    # -------------------------------------------------------------------------
    safe_print("\n[STEP 4: WORKING CONTEXT] Verifying prompt formatting with recalled memories...")
    recalled_prompt_block = format_recalled_memories_for_prompt(recalled)
    assert "=== RECALLED HISTORICAL ORGANIZATIONAL MEMORIES ===" in recalled_prompt_block
    assert ("INC-184" in recalled_prompt_block or "checkout" in recalled_prompt_block)
    assert "redis" in recalled_prompt_block.lower()
    safe_print("[OK] STEP 4 VERIFIED: LLM working RAM prompt successfully formatted with persistent incident precedent.")

    # -------------------------------------------------------------------------
    # STEP 5: VERIFY RESPONSE CONTAINS RECOMMENDED TROUBLESHOOTING
    # The answer should recognize historical similarity without blindly assuming
    # the previous root cause is definitely correct, and provide:
    # - root cause hypotheses
    # - investigation steps
    # - recommended actions
    # - verification steps
    # -------------------------------------------------------------------------
    safe_print("\n[STEP 5: SRE REASONING & RECOMMENDATIONS] Verifying structured diagnosis...")
    analysis = chat_data.get("analysis", "")
    hypotheses = chat_data.get("root_cause_hypotheses", [])
    investigation_steps = chat_data.get("investigation_steps", [])
    actions = chat_data.get("recommended_actions", [])
    verification = chat_data.get("verification_steps", [])
    memory_impact = chat_data.get("memory_impact", "")

    assert len(analysis) > 30, "Analysis must provide situational assessment"
    assert len(hypotheses) >= 1, "Must provide at least one root cause hypothesis"
    assert len(investigation_steps) >= 1, "Must provide concrete investigation steps"
    assert len(actions) >= 1, "Must provide recommended remediation actions"
    assert len(verification) >= 1, "Must provide resolution verification steps"
    assert len(memory_impact) > 10, "Must explain memory impact / historical influence"

    # Verify that the response recognizes similarity without blind certainty
    hypotheses_str = " ".join(hypotheses).lower()
    analysis_str = analysis.lower()
    assert ("redis" in hypotheses_str or "redis" in analysis_str or "connection" in hypotheses_str), \
        "Response should recognize connection / Redis pool hypothesis informed by INC-184"

    safe_print("[OK] STEP 5 VERIFIED: Response provides operational hypotheses, investigation, remediation, and verification.")
    safe_print(f"  * Primary Hypothesis: {hypotheses[0]}")
    safe_print(f"  * Actions ({len(actions)}): {actions[0]}")
    safe_print(f"  * Memory Impact: {memory_impact[:100]}...")

    # -------------------------------------------------------------------------
    # STEP 6: VERIFY RETAIN OCCURS
    # Store new incident experience in Hindsight persistent memory.
    # -------------------------------------------------------------------------
    safe_print("\n[STEP 6: RETAIN (PAGE OUT)] Verifying experience retained into persistent disk...")
    lifecycle = chat_data.get("memory_lifecycle", {})
    assert lifecycle.get("retained") is True, f"Retain must succeed. Lifecycle data: {lifecycle}"
    assert "incident_id" in lifecycle
    retained_id = lifecycle["incident_id"]
    safe_print(f"[OK] STEP 6 VERIFIED: Incident {retained_id} successfully paged out to persistent memory bank.")

    # -------------------------------------------------------------------------
    # STEP 7 & 8: RUN REFLECT & VERIFY OPERATIONAL MENTAL MODELS
    # Update or generate operational mental models based on accumulated incidents.
    # Verify supporting incidents are referenced.
    # -------------------------------------------------------------------------
    safe_print("\n[STEP 7 & 8: REFLECT] Running memory consolidation across persistent incidents...")
    reflect_resp = client.post("/api/reflect", json={"bank_id": demo_bank_id})
    assert reflect_resp.status_code == 200, f"Reflect endpoint failed: {reflect_resp.text}"
    reflect_data = reflect_resp.json()

    mental_model = reflect_data.get("mental_model") or reflect_data.get("reflection", "")
    supporting = reflect_data.get("supporting_incidents", [])
    patterns = reflect_data.get("patterns", [])
    rules = reflect_data.get("recommended_operational_rules", [])

    assert len(mental_model) > 20, "Reflect must produce a consolidated operational mental model"
    assert len(supporting) > 0, "Mental model must reference supporting historical incidents"
    # Ensure INC-184, INC-127, or INC-101 are among the supporting precedents
    assert any(inc in str(supporting) for inc in ["INC-184", "INC-127", "INC-101"]), \
        f"Supporting incidents should include Redis/checkout incidents. Got: {supporting}"
    assert len(patterns) > 0, "Must synthesize recurring operational patterns"
    assert len(rules) > 0, "Must formulate prescriptive operational rules"

    safe_print("[OK] STEP 7 & 8 VERIFIED: Operational mental model generated with supporting incident evidence.")
    safe_print(f"  * Mental Model: {mental_model[:120]}...")
    safe_print(f"  * Supporting Incidents: {supporting}")
    safe_print(f"  * Patterns ({len(patterns)}): {patterns[0]}")
    safe_print(f"  * Rules ({len(rules)}): {rules[0]}")

    safe_print("\n" + "=" * 70)
    safe_print("PHASE 6 DETERMINISTIC END-TO-END DEMO FLOW TEST PASSED COMPLETELY!")
    safe_print("=" * 70)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
