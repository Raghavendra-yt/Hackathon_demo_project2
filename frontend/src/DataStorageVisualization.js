import React, { useState } from 'react';

export default function DataStorageVisualization({
  incidentCatalog = [],
  backendConfig = {},
  reflection = null,
  onTriageIncident = () => {}
}) {
  const [activeTab, setActiveTab] = useState('pipeline'); // 'pipeline' | 'explorer' | 'hierarchy' | 'simulator'
  const [selectedPipelineStep, setSelectedPipelineStep] = useState('retain');
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [filterQuery, setFilterQuery] = useState('');
  
  // Simulator state
  const [simService, setSimService] = useState('Payment Gateway');
  const [simSeverity, setSimSeverity] = useState('P1');
  const [simSymptoms, setSimSymptoms] = useState('502 Bad Gateway during checkout authorization peak');
  const [simRootCause, setSimRootCause] = useState('Upstream TLS handshake timeout due to connection pool starvation');
  const [simRemediation, setSimRemediation] = useState('Increased keepalive connections from 50 to 250 and enabled HTTP/2 multiplexing');
  const [simMetric, setSimMetric] = useState('p99 authorization latency < 150ms; 502 error count = 0');
  const [simulating, setSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const [simSuccess, setSimSuccess] = useState(false);
  const [simPayload, setSimPayload] = useState(null);

  const bankId = backendConfig.bank_id || 'devops-demo-team';

  // Pipeline step definitions
  const pipelineSteps = [
    {
      id: 'input',
      name: '1. Incident Ingestion',
      category: 'Input Stream',
      icon: '🚨',
      storageMedium: 'HTTP Request / Webhook Buffer',
      durability: 'Transient (In-Flight)',
      latency: '< 5ms',
      description: 'Incoming alert telemetry from Prometheus, Datadog, or SRE triage engineer.',
      schema: {
        timestamp: '2026-09-29T22:30:00Z',
        source: 'SRE Console / AlertManager',
        raw_symptom: 'Production checkout is timing out again (504 Gateway Timeout)'
      }
    },
    {
      id: 'ram',
      name: '2. Working Context (RAM)',
      category: 'Volatile RAM',
      icon: '🧠',
      storageMedium: 'Groq LLM Context Window (openai/gpt-oss-120b)',
      durability: 'Volatile (Session Only - Evaporates on exit)',
      latency: '~250ms (Ultra-high speed inference)',
      description: 'Episodic working memory where active SRE diagnostic reasoning and synthesis occurs.',
      schema: {
        context_window_size: '128k tokens',
        active_session_id: 'inc_session_20260929',
        volatility_policy: 'Cleared after triage session completes',
        tokens_allocated: '4,096 tokens'
      }
    },
    {
      id: 'recall',
      name: '3. Vector Page-In (Recall)',
      category: 'Vector Search',
      icon: '📥',
      storageMedium: 'Hindsight Cloud Semantic Index',
      durability: 'Durable Vector Index',
      latency: '~65ms Cosine Similarity',
      description: 'Generates embedding of symptoms and queries Hindsight persistent disk for matching historical postmortems.',
      schema: {
        query_vector: '[0.042, -0.198, 0.412, ... 1536 dimensions]',
        top_k: 3,
        threshold: 0.75,
        paged_in_records: ['INC-184 (Redis Pool Exhaustion)', 'INC-127 (Lock Contention)']
      }
    },
    {
      id: 'retain',
      name: '4. Durable Storage (Page-Out / Retain)',
      category: 'Persistent Storage',
      icon: '💾',
      storageMedium: 'Hindsight Cloud Durable Storage Bank',
      durability: 'Permanent Secondary Storage',
      latency: '~120ms Write & Index',
      description: 'Newly diagnosed incident, root cause, and verified remediation are serialized and committed to persistent disk.',
      schema: {
        bank_id: bankId,
        incident_id: 'INC-2026-0929',
        service: 'Checkout API',
        severity: 'P1',
        status: 'resolved',
        symptoms: 'Observed 504 Gateway Timeouts under flash traffic',
        root_cause: 'Redis connection pool exhaustion',
        remediation: 'Scale spring.redis.jedis.pool.max-active from 50 to 200',
        verification_metric: 'Prometheus redis_connected_clients < 75%',
        embedding_dimension: 1536,
        stored_at: '2026-09-29T22:35:12Z'
      }
    },
    {
      id: 'reflect',
      name: '5. Knowledge Consolidation (Reflect)',
      category: 'Knowledge Synthesis',
      icon: '✨',
      storageMedium: 'Hindsight Long-term Heuristics Store',
      durability: 'Permanent Operational Rules',
      latency: 'Background Defragmentation Job',
      description: 'Periodic cross-incident synthesis consolidates individual incidents into high-level mental models and prescriptive rules.',
      schema: {
        mental_model: reflection?.mental_model || 'Checkout timeouts frequently correlate with Redis connection saturation during traffic spikes.',
        supporting_incidents: reflection?.supporting_incidents || ['INC-184', 'INC-127', 'INC-101'],
        prescriptive_rule: 'Check pool saturation before altering application code',
        consolidated_patterns: 4
      }
    }
  ];

  const currentStepData = pipelineSteps.find(s => s.id === selectedPipelineStep) || pipelineSteps[3];

  // Filter catalog
  const filteredCatalog = incidentCatalog.filter(inc => {
    const q = filterQuery.toLowerCase();
    return (
      (inc.incident_id || '').toLowerCase().includes(q) ||
      (inc.service || '').toLowerCase().includes(q) ||
      (inc.symptoms || '').toLowerCase().includes(q) ||
      (inc.root_cause || '').toLowerCase().includes(q)
    );
  });

  const activeSelectedIncident = selectedIncident || (filteredCatalog.length > 0 ? filteredCatalog[0] : null);

  // Run simulation
  const handleSimulateWrite = () => {
    setSimulating(true);
    setSimProgress(15);
    setSimSuccess(false);

    const payload = {
      bank_id: bankId,
      incident_id: `INC-${Math.floor(200 + Math.random() * 800)}`,
      service: simService,
      severity: simSeverity,
      status: 'resolved',
      symptoms: simSymptoms,
      root_cause: simRootCause,
      remediation: simRemediation,
      verification_metric: simMetric,
      timestamp: new Date().toISOString(),
      vector_embedding: Array.from({ length: 8 }, () => +(Math.random() * 2 - 1).toFixed(4)).concat(['... 1,528 more dimensions']),
      storage_meta: {
        codec: 'JSON-UTF8',
        engine: 'Hindsight Cloud Persistent Bank',
        durability: 'ACID-Compliant Vector Block',
        partition_key: bankId
      }
    };

    setTimeout(() => setSimProgress(45), 400);
    setTimeout(() => setSimProgress(80), 900);
    setTimeout(() => {
      setSimProgress(100);
      setSimulating(false);
      setSimSuccess(true);
      setSimPayload(payload);
    }, 1400);
  };

  return (
    <section className="bg-slate-900/90 rounded-2xl border border-slate-800 shadow-2xl p-4 md:p-6 mb-8 text-left">
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center text-lg shadow-sm">
              💾
            </div>
            <h2 className="text-lg md:text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <span>Data Storage & Virtual Memory Engine</span>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-normal">
                Hindsight Cloud Persistence
              </span>
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Visualizing how operational experience transforms from volatile LLM working RAM into durable, vector-indexed Hindsight Cloud storage.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800 flex-wrap">
          <button
            onClick={() => setActiveTab('pipeline')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
              activeTab === 'pipeline'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            🔄 Storage Pipeline
          </button>
          <button
            onClick={() => setActiveTab('explorer')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
              activeTab === 'explorer'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            🗄️ Storage Bank Explorer ({incidentCatalog.length})
          </button>
          <button
            onClick={() => setActiveTab('hierarchy')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
              activeTab === 'hierarchy'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            📊 Storage Tiers (RAM vs Disk)
          </button>
          <button
            onClick={() => setActiveTab('simulator')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
              activeTab === 'simulator'
                ? 'bg-gradient-to-r from-cyan-600 to-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            ⚡ Write Simulator
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: INTERACTIVE STORAGE PIPELINE FLOW                                   */}
      {/* ========================================================================= */}
      {activeTab === 'pipeline' && (
        <div className="mt-5 space-y-5">
          {/* Visual Step Pipeline Flow Diagram */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {pipelineSteps.map((step, idx) => {
              const isSelected = selectedPipelineStep === step.id;
              return (
                <div
                  key={step.id}
                  onClick={() => setSelectedPipelineStep(step.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                    isSelected
                      ? 'bg-slate-950 border-cyan-400 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-400'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-950'
                  }`}
                >
                  {/* Step Connector Arrow (Desktop) */}
                  {idx < pipelineSteps.length - 1 && (
                    <div className="hidden md:block absolute -right-2.5 top-1/2 -translate-y-1/2 z-10 text-slate-600 text-xs font-bold pointer-events-none">
                      ▶
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xl">{step.icon}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                        step.id === 'ram'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : (step.id === 'retain' || step.id === 'reflect'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-indigo-950 text-indigo-300 border border-indigo-800')
                      }`}>
                        {step.category}
                      </span>
                    </div>

                    <h4 className="font-bold text-xs md:text-sm text-slate-100 mb-1">
                      {step.name}
                    </h4>

                    <div className="text-[11px] font-mono text-slate-400 mb-2 leading-tight">
                      {step.storageMedium}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-850 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-500">Durability:</span>
                    <span className={step.id === 'ram' ? 'text-amber-400' : 'text-emerald-400'}>
                      {step.id === 'ram' ? 'Volatile' : 'Durable'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive Step Detail Inspector */}
          <div className="bg-slate-950 p-4 md:p-5 rounded-xl border border-slate-800 shadow-inner">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-850">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{currentStepData.icon}</span>
                <div>
                  <h3 className="text-sm md:text-base font-bold text-white flex items-center gap-2">
                    <span>{currentStepData.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                      {currentStepData.category}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">{currentStepData.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-slate-300">
                <div className="px-2.5 py-1 bg-slate-900 rounded border border-slate-800">
                  <span className="text-slate-500">Latency: </span>
                  <span className="text-cyan-300 font-semibold">{currentStepData.latency}</span>
                </div>
                <div className="px-2.5 py-1 bg-slate-900 rounded border border-slate-800">
                  <span className="text-slate-500">Medium: </span>
                  <span className="text-slate-200">{currentStepData.storageMedium}</span>
                </div>
              </div>
            </div>

            {/* Schema & Storage Payload Inspector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
                  Data Structure & In-Memory / Disk Representation:
                </span>
                <span className="text-[11px] font-mono text-slate-500">JSON Schema Payload</span>
              </div>

              <pre className="bg-slate-900 p-4 rounded-xl border border-slate-800/90 text-xs font-mono text-cyan-300 overflow-x-auto leading-relaxed shadow-sm">
                <code>{JSON.stringify(currentStepData.schema, null, 2)}</code>
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: PERSISTENT STORAGE BANK EXPLORER                                    */}
      {/* ========================================================================= */}
      {activeTab === 'explorer' && (
        <div className="mt-5 space-y-4">
          {/* Search & Metadata Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs font-mono text-slate-400">Search Records:</span>
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter by service (e.g. Redis, Kafka, Kubernetes)..."
                className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500 w-full sm:w-72"
              />
            </div>

            <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
              <span>Memory Bank: <strong className="text-cyan-300">{bankId}</strong></span>
              <span className="text-slate-700">|</span>
              <span>Total Stored: <strong className="text-emerald-400">{incidentCatalog.length} Records</strong></span>
            </div>
          </div>

          {/* Master-Detail Split Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            
            {/* Left: Stored Incident Disk Blocks (5 cols) */}
            <div className="lg:col-span-5 space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
              {filteredCatalog.length === 0 ? (
                <div className="p-8 text-center text-slate-500 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                  No stored incidents match query "{filterQuery}".
                </div>
              ) : (
                filteredCatalog.map((inc) => {
                  const isSelected = activeSelectedIncident?.incident_id === inc.incident_id;
                  return (
                    <div
                      key={inc.incident_id}
                      onClick={() => setSelectedIncident(inc)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-slate-950 border-cyan-400 shadow-md ring-1 ring-cyan-400/80'
                          : 'bg-slate-950/70 border-slate-850 hover:border-slate-700 hover:bg-slate-950'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded font-mono font-bold text-xs">
                            {inc.incident_id}
                          </span>
                          <span className="font-bold text-xs text-slate-100 font-mono">{inc.service}</span>
                        </div>
                        <span className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-bold ${
                          inc.severity === 'P1' ? 'bg-rose-950 text-rose-300' : 'bg-amber-950 text-amber-300'
                        }`}>
                          {inc.severity}
                        </span>
                      </div>

                      <div className="text-xs text-slate-300 line-clamp-1 mb-1 font-sans">
                        {inc.root_cause || inc.symptoms}
                      </div>

                      <div className="flex items-center justify-between pt-1.5 border-t border-slate-850 text-[10px] font-mono text-slate-500">
                        <span>Status: <strong className="text-emerald-400">{inc.status || 'resolved'}</strong></span>
                        <span className="text-cyan-400">Click to inspect payload →</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Right: Selected Stored Record Raw JSON & Schema View (7 cols) */}
            <div className="lg:col-span-7 bg-slate-950 rounded-xl border border-slate-800 p-4 flex flex-col justify-between max-h-[500px] overflow-hidden">
              {activeSelectedIncident ? (
                <div className="flex flex-col h-full overflow-hidden">
                  <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-850">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-cyan-400 font-bold text-sm">
                          {activeSelectedIncident.incident_id}
                        </span>
                        <span className="text-white font-bold text-sm">
                          {activeSelectedIncident.service}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        Durable vector record committed to bank '{bankId}'
                      </span>
                    </div>

                    <button
                      onClick={() => onTriageIncident(`Production degradation in ${activeSelectedIncident.service}: ${activeSelectedIncident.symptoms}`)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition-colors cursor-pointer"
                    >
                      ▶ Test Recall in Chat
                    </button>
                  </div>

                  {/* Formatted JSON Payload Viewer */}
                  <div className="flex-1 overflow-y-auto pr-1">
                    <pre className="bg-slate-900/90 p-3.5 rounded-lg border border-slate-850 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
                      <code>
                        {JSON.stringify(
                          {
                            incident_id: activeSelectedIncident.incident_id,
                            bank_id: bankId,
                            service: activeSelectedIncident.service,
                            severity: activeSelectedIncident.severity,
                            status: activeSelectedIncident.status || 'resolved',
                            symptoms: activeSelectedIncident.symptoms,
                            root_cause: activeSelectedIncident.root_cause,
                            remediation: activeSelectedIncident.remediation,
                            verification_metric: activeSelectedIncident.verification_steps || 'Prometheus error rate < 0.01%',
                            vector_embedding: '[0.0192, -0.0841, 0.4912, 0.2215, ... 1532 more floats]',
                            persisted_storage_tier: 'Hindsight Cloud Secondary Disk'
                          },
                          null,
                          2
                        )}
                      </code>
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 text-xs font-mono">
                  Select an incident from the storage bank to inspect its stored data payload.
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: STORAGE HIERARCHY COMPARISON (RAM vs DISK vs KNOWLEDGE)            */}
      {/* ========================================================================= */}
      {activeTab === 'hierarchy' && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* Tier 1: Volatile Working RAM */}
            <div className="p-4 bg-slate-950 rounded-xl border border-amber-900/40 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">🧠</span>
                  <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono text-[10px] font-bold">
                    Tier 1: Volatile RAM
                  </span>
                </div>
                <h4 className="font-bold text-sm text-white mb-1">
                  LLM Context Window
                </h4>
                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                  Fast, in-flight working memory powered by Groq (<code className="text-amber-300">openai/gpt-oss-120b</code>). Used solely during active triage.
                </p>

                <div className="space-y-2 text-xs font-mono">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-500">Persistence:</span>
                    <span className="text-rose-400 font-bold">0 Days (Volatile)</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-500">Access Speed:</span>
                    <span className="text-emerald-400 font-bold">&lt; 300ms</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-500">Capacity:</span>
                    <span className="text-slate-300">128,000 Tokens</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-850 text-[11px] text-slate-500 italic">
                *Evaporates immediately when session concludes.
              </div>
            </div>

            {/* Tier 2: Durable Episodic Bank */}
            <div className="p-4 bg-slate-950 rounded-xl border border-cyan-800/60 shadow-md flex flex-col justify-between ring-1 ring-cyan-500/20">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">💾</span>
                  <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono text-[10px] font-bold">
                    Tier 2: Persistent Disk
                  </span>
                </div>
                <h4 className="font-bold text-sm text-white mb-1">
                  Hindsight Memory Bank
                </h4>
                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                  Durable external secondary storage holding institutional postmortems, verified fixes, and vector embeddings.
                </p>

                <div className="space-y-2 text-xs font-mono">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-500">Persistence:</span>
                    <span className="text-emerald-400 font-bold">Permanent (Cloud)</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-500">Partition Key:</span>
                    <span className="text-cyan-300 font-bold">{bankId}</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-500">Indexing:</span>
                    <span className="text-slate-300">1536-dim Vector</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-850 text-[11px] text-cyan-400">
                ✓ Paged in on-demand via semantic Recall.
              </div>
            </div>

            {/* Tier 3: Consolidated Knowledge */}
            <div className="p-4 bg-slate-950 rounded-xl border border-purple-900/40 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">✨</span>
                  <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-mono text-[10px] font-bold">
                    Tier 3: Reflect Heuristics
                  </span>
                </div>
                <h4 className="font-bold text-sm text-white mb-1">
                  Operational Mental Models
                </h4>
                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                  Higher-level heuristics and prescriptive rules synthesized from cross-incident analysis across all services.
                </p>

                <div className="space-y-2 text-xs font-mono">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-500">Synthesis Engine:</span>
                    <span className="text-purple-300 font-bold">Reflect Worker</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-500">Supporting Incidents:</span>
                    <span className="text-slate-300">{reflection?.supporting_incidents?.length || 5} records</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-500">Output:</span>
                    <span className="text-emerald-400">Prescriptive Rules</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-850 text-[11px] text-purple-300">
                ✓ Updates institutional mental models automatically.
              </div>
            </div>

          </div>

          {/* Active Mental Model Banner */}
          <div className="p-3.5 bg-gradient-to-r from-purple-950/40 via-slate-950 to-indigo-950/40 rounded-xl border border-purple-800/40">
            <span className="text-[11px] font-mono font-bold text-purple-400 block mb-1">
              CURRENT CONSOLIDATED OPERATIONAL MENTAL MODEL:
            </span>
            <p className="text-xs md:text-sm text-slate-200 italic font-sans leading-relaxed">
              "{reflection?.mental_model || 'Checkout timeouts frequently correlate with Redis connection saturation during traffic spikes.'}"
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: INTERACTIVE WRITE SIMULATOR (PAGE-OUT / RETAIN)                    */}
      {/* ========================================================================= */}
      {activeTab === 'simulator' && (
        <div className="mt-5 space-y-4">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <span>⚡ Live "Page Out" Storage Write Simulator</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                Interactive
              </span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Test how MemOS captures newly verified incident resolutions, computes vector embeddings, and writes them into durable secondary storage.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs mb-4">
              <div>
                <label className="block text-slate-400 font-mono mb-1">Target Service:</label>
                <input
                  type="text"
                  value={simService}
                  onChange={(e) => setSimService(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-mono mb-1">Severity Level:</label>
                <select
                  value={simSeverity}
                  onChange={(e) => setSimSeverity(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                >
                  <option value="P1">P1 - Critical Outage</option>
                  <option value="P2">P2 - Major Degradation</option>
                  <option value="P3">P3 - Minor Disruption</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-slate-400 font-mono mb-1">Observed Symptoms:</label>
                <input
                  type="text"
                  value={simSymptoms}
                  onChange={(e) => setSimSymptoms(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-slate-400 font-mono mb-1">Diagnosed Root Cause:</label>
                <input
                  type="text"
                  value={simRootCause}
                  onChange={(e) => setSimRootCause(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-slate-400 font-mono mb-1">Verified Remediation:</label>
                <input
                  type="text"
                  value={simRemediation}
                  onChange={(e) => setSimRemediation(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-slate-400 font-mono mb-1">Verification Metric SLO:</label>
                <input
                  type="text"
                  value={simMetric}
                  onChange={(e) => setSimMetric(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                />
              </div>
            </div>

            {/* Action Button & Progress */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                onClick={handleSimulateWrite}
                disabled={simulating}
                className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-950/40 transition-all cursor-pointer disabled:opacity-50"
              >
                {simulating ? 'Writing to Hindsight Disk...' : '🚀 Simulate Write to Hindsight (Retain)'}
              </button>

              {simulating && (
                <div className="w-full sm:flex-1 bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="bg-emerald-400 h-full transition-all duration-300"
                    style={{ width: `${simProgress}%` }}
                  ></div>
                </div>
              )}
            </div>

            {/* Success Confirmation & Payload View */}
            {simSuccess && simPayload && (
              <div className="mt-4 p-3.5 bg-emerald-950/40 border border-emerald-600/60 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-emerald-300 font-mono text-xs font-bold">
                  <span>✓ Successfully Committed to Persistent Disk (HTTP 200)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700">
                    Bank: {bankId}
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  The incident record was structured, embedded with 1536-dimensional coordinates, and appended to durable storage. Future queries matching this failure signature will page this precedent into working RAM.
                </p>
                <pre className="p-3 bg-slate-950 rounded-lg text-emerald-300 font-mono text-xs overflow-x-auto border border-emerald-900/50">
                  <code>{JSON.stringify(simPayload, null, 2)}</code>
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

    </section>
  );
}
