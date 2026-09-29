"""
Section 10: Multi-Tenant / Workspace Isolation Test

Validates that memory banks partition memories by team/workspace identifier,
preventing cross-workspace memory leakage:
- TEAM-A retains a checkout Redis incident
- TEAM-B retains a checkout PostgreSQL incident
- Recall from TEAM-A must never return TEAM-B's PostgreSQL memory
- Recall from TEAM-B must never return TEAM-A's Redis memory
"""

import pytest
from backend.memory import (
    execute_retain,
    execute_recall,
    IncidentRecord,
    SimulatedMemoryBank
)
from backend.main import hindsight_client, fallback_bank


def test_multi_tenant_workspace_isolation():
    """
    Verify complete isolation between TEAM-A and TEAM-B memory banks.
    """
    team_a_bank = "team-a-checkout"
    team_b_bank = "team-b-checkout"

    # Define distinct operational incidents for each team
    incident_team_a = IncidentRecord(
        incident_id="INC-TEAM-A-REDIS",
        service="checkout",
        environment="production",
        severity="P1",
        symptoms="Checkout API reporting 504 timeouts due to Redis buffer exhaustion",
        investigation="Redis maxclients exceeded on cluster node 2",
        root_cause="Redis connection pool starvation in checkout microservice",
        remediation="Scaled Redis cluster node connection limits and pool sizing",
        verification="Redis active connections normalized below 60%",
        tags=["team-a", "checkout", "redis"]
    )

    incident_team_b = IncidentRecord(
        incident_id="INC-TEAM-B-POSTGRES",
        service="checkout",
        environment="production",
        severity="P1",
        symptoms="Checkout API reporting 500 errors due to PostgreSQL deadlocks",
        investigation="PostgreSQL pg_stat_activity shows concurrent UPDATE lock contention on orders table",
        root_cause="PostgreSQL row-level lock contention on checkout orders",
        remediation="Applied SELECT FOR UPDATE SKIP LOCKED pattern and added composite index",
        verification="PostgreSQL lock wait times dropped to 0ms",
        tags=["team-b", "checkout", "postgres"]
    )

    # 1. Retain into TEAM-A workspace
    res_a = execute_retain(
        client=hindsight_client,
        incident_data=incident_team_a,
        bank_id=team_a_bank,
        fallback_bank=fallback_bank
    )
    assert res_a is not None

    # 2. Retain into TEAM-B workspace
    res_b = execute_retain(
        client=hindsight_client,
        incident_data=incident_team_b,
        bank_id=team_b_bank,
        fallback_bank=fallback_bank
    )
    assert res_b is not None

    # 3. Recall from TEAM-A workspace with a query that could match either if not partitioned
    query = "checkout database lock and connection timeouts"
    recalled_a = execute_recall(
        client=hindsight_client,
        query=query,
        bank_id=team_a_bank,
        fallback_bank=fallback_bank
    )

    # Verify TEAM-A only receives TEAM-A memories
    assert len(recalled_a) > 0, "TEAM-A recall should retrieve TEAM-A incident"
    all_text_a = " ".join([m.get("text", "") for m in recalled_a]).lower()
    all_meta_a = " ".join([str(m.get("metadata", {})) for m in recalled_a]).lower()
    combined_a = all_text_a + " " + all_meta_a

    assert "redis" in combined_a or "inc-team-a-redis" in combined_a, "TEAM-A memory should contain Redis incident"
    assert "postgres" not in combined_a, "LEAKAGE DETECTED: TEAM-A retrieved TEAM-B's private postgres memory"
    assert "inc-team-b-postgres" not in combined_a, "LEAKAGE DETECTED: TEAM-A retrieved TEAM-B incident ID"

    # 4. Recall from TEAM-B workspace with the same query
    recalled_b = execute_recall(
        client=hindsight_client,
        query=query,
        bank_id=team_b_bank,
        fallback_bank=fallback_bank
    )

    # Verify TEAM-B only receives TEAM-B memories
    assert len(recalled_b) > 0, "TEAM-B recall should retrieve TEAM-B incident"
    all_text_b = " ".join([m.get("text", "") for m in recalled_b]).lower()
    all_meta_b = " ".join([str(m.get("metadata", {})) for m in recalled_b]).lower()
    combined_b = all_text_b + " " + all_meta_b

    assert "postgres" in combined_b or "inc-team-b-postgres" in combined_b, "TEAM-B memory should contain PostgreSQL incident"
    assert "redis" not in combined_b, "LEAKAGE DETECTED: TEAM-B retrieved TEAM-A's private Redis memory"
    assert "inc-team-a-redis" not in combined_b, "LEAKAGE DETECTED: TEAM-B retrieved TEAM-A incident ID"
