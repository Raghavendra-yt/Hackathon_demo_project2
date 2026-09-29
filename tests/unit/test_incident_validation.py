"""
Unit Tests: Incident Data Model Validation
Validates:
- Valid IncidentRecord initialization
- Required fields (incident_id, service, symptoms, root_cause, investigation, remediation, verification)
- Default values (environment='production', severity='P2', status='resolved', tags=[])
- Missing required fields validation error
- Summary generation and serialization
"""

import pytest
from pydantic import ValidationError
from backend.memory import IncidentRecord, format_incident_for_retention


def test_valid_incident_record():
    """Verify that a fully specified IncidentRecord is valid."""
    inc = IncidentRecord(
        incident_id="INC-VALID-01",
        service="Checkout API",
        environment="production",
        severity="P1",
        symptoms="504 Gateway Timeouts under load",
        investigation="Active Redis connection pool hit max limits",
        root_cause="Redis connection pool exhaustion",
        remediation="Scaled maxclients from 1000 to 10000",
        verification="Checked error rate normalized to 0.0%",
        status="resolved",
        tags=["checkout", "redis", "p1"]
    )
    assert inc.incident_id == "INC-VALID-01"
    assert inc.service == "Checkout API"
    assert inc.severity == "P1"
    assert "redis" in inc.tags
    assert len(inc.timestamp) > 0


def test_incident_record_defaults():
    """Verify default values when optional fields are omitted."""
    inc = IncidentRecord(
        incident_id="INC-DEFAULT-02",
        service="Auth Service",
        symptoms="Token validation latency",
        investigation="Inspected auth worker CPU",
        root_cause="JWKS endpoint rate-limited",
        remediation="Added caching layer for public keys",
        verification="Latency dropped to 10ms"
    )
    assert inc.environment == "production"
    assert inc.severity == "P2"
    assert inc.status == "resolved"
    assert inc.tags == []
    assert len(inc.timestamp) > 0


def test_missing_required_fields_raises_validation_error():
    """Verify missing required fields raise Pydantic ValidationError."""
    with pytest.raises(ValidationError):
        # Missing service, symptoms, root_cause
        IncidentRecord(incident_id="INC-INVALID")

    with pytest.raises(ValidationError):
        # Missing root_cause
        IncidentRecord(
            incident_id="INC-NO-CAUSE",
            service="Database",
            symptoms="Deadlock detected",
            investigation="Checked pg_stat_activity",
            remediation="Terminated blocking PID",
            verification="Queries unblocked"
        )


def test_incident_summary_generation():
    """Verify to_summary produces clean operational text."""
    inc = IncidentRecord(
        incident_id="INC-SUM-01",
        service="PostgreSQL",
        severity="P1",
        symptoms="Connection pool saturated (500/500)",
        investigation="Unindexed queries held locks",
        root_cause="Missing index on orders.customer_id",
        remediation="Created concurrent index",
        verification="Active connections dropped to 45"
    )
    summary = inc.to_summary()
    assert "INC-SUM-01" in summary
    assert "PostgreSQL - P1" in summary
    assert "Missing index" in summary


def test_format_incident_for_retention_structure():
    """Verify format_incident_for_retention builds complete metadata and content payload."""
    inc = IncidentRecord(
        incident_id="INC-RETAIN-TEST",
        service="Payment Service",
        severity="P1",
        symptoms="Stripe webhook drops",
        investigation="Thread pool saturation",
        root_cause="External webhook listener blocked by synchronous DB write",
        remediation="Made webhook handling asynchronous via Kafka",
        verification="Webhook latency dropped to 12ms",
        tags=["payment", "kafka"]
    )
    formatted = format_incident_for_retention(inc)

    assert "INCIDENT RECORD: INC-RETAIN-TEST" in formatted["content"]
    assert "Payment Service" in formatted["content"]
    assert formatted["metadata"]["incident_id"] == "INC-RETAIN-TEST"
    assert formatted["metadata"]["service"] == "Payment Service"
    assert "payment" in formatted["tags"]
    assert "kafka" in formatted["tags"]
