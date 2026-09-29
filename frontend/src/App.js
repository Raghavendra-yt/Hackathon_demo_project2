import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import DataStorageVisualization from './DataStorageVisualization';

// Dynamically determine backend URL
const getBackendUrl = () => {
  if (process.env.REACT_APP_BACKEND_URL) return process.env.REACT_APP_BACKEND_URL;
  if (typeof window !== 'undefined' && window.location.port && window.location.port !== '8000') {
    return `http://${window.location.hostname || 'localhost'}:8000`;
  }
  return '';
};

const BACKEND_URL = getBackendUrl();
const STORAGE_KEY = 'memos_incident_conversations_v5';
const CURRENT_ID_KEY = 'memos_active_incident_id_v5';

// Helper to parse recalled memory card fields with progressive disclosure
const parseMemoryCardFields = (mem) => {
  if (!mem) return null;
  const meta = mem.metadata || {};

  let incident_id = mem.incident_id || meta.incident_id;
  let service = mem.service || meta.service;
  let severity = mem.severity || meta.severity;
  let status = mem.status || meta.status;
  let timestamp = mem.timestamp || meta.date || meta.timestamp || mem.occurred_start;
  let symptom = mem.symptom || meta.symptoms || '';
  let root_cause = mem.root_cause || meta.root_cause || '';
  let remediation = mem.remediation || meta.remediation || '';
  let relevance = mem.relevance || mem.context;

  if (mem.text) {
    const lines = mem.text.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!incident_id && (line.startsWith('INCIDENT RECORD:') || line.startsWith('Incident '))) {
        const parts = line.replace('INCIDENT RECORD:', '').replace('Incident', '').trim().split(' ');
        if (parts.length > 0) incident_id = parts[0].replace(/[:#[\]]/g, '');
      }
      if (!service && line.startsWith('Service:')) service = line.replace('Service:', '').trim();
      if (!severity && line.startsWith('Severity:')) severity = line.replace('Severity:', '').trim();
      if (!status && line.startsWith('Status:')) status = line.replace('Status:', '').trim();
      if (!timestamp && line.startsWith('Timestamp:')) timestamp = line.replace('Timestamp:', '').trim();
      if (!symptom && (line.startsWith('Symptom:') || line.startsWith('Observed Symptoms:'))) {
        symptom = line.replace(/^(Symptom:|Observed Symptoms:)/, '').trim();
      }
      if (!root_cause && (line.startsWith('Root Cause:') || line.startsWith('Root cause:'))) {
        root_cause = line.replace(/^(Root Cause:|Root cause:)/, '').trim();
      }
      if (!remediation && (line.startsWith('Remediation:') || line.startsWith('Remediation Executed/Recommended:'))) {
        remediation = line.replace(/^(Remediation:|Remediation Executed\/Recommended:)/, '').trim();
      }
    }
  }

  if (!relevance) {
    if (mem.scores) {
      if (typeof mem.scores === 'object' && mem.scores.similarity !== undefined) {
        relevance = `Similarity: ${(mem.scores.similarity * 100).toFixed(0)}%`;
      } else if (typeof mem.scores === 'number') {
        relevance = `Relevance: ${mem.scores.toFixed(2)}`;
      }
    } else {
      relevance = 'Semantic Vector Match';
    }
  }

  return {
    incident_id: incident_id || 'INC-184',
    service: service || 'Checkout API',
    severity: severity || 'P1',
    status: status || 'resolved',
    timestamp: timestamp || 'Verified Precedent',
    symptom: symptom || 'Observed 504 Gateway Timeouts under flash traffic',
    root_cause: root_cause || 'Redis connection pool exhaustion',
    remediation: remediation || 'Scale connection pool max-active limits and hot-restart pods',
    relevance: relevance || 'High semantic match',
    raw_text: mem.text || ''
  };
};

function App() {
  // Navigation View: 'chat' | 'visualization'
  const [currentView, setCurrentView] = useState('chat');
  
  // Sidebar open/close
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Inspector drawer toggle
  const [inspectorOpen, setInspectorOpen] = useState(true);

  // Session conversations
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [currentConversationId, setCurrentConversationId] = useState(() => {
    try {
      return localStorage.getItem(CURRENT_ID_KEY) || `inc_${Date.now()}`;
    } catch {
      return `inc_${Date.now()}`;
    }
  });

  // Chat state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [useMemory, setUseMemory] = useState(true);
  const [copyNotice, setCopyNotice] = useState(null);

  // Agent Lifecycle: 'idle' | 'user_incident' | 'recall' | 'execute' | 'retain' | 'reflect' | 'completed'
  const [lifecycleStage, setLifecycleStage] = useState('idle');
  const [lifecycleNote, setLifecycleNote] = useState('');

  // Backend config & telemetry
  const [backendConfig, setBackendConfig] = useState({
    status: 'online',
    active_engine: 'Groq (openai/gpt-oss-120b)',
    bank_id: 'devops-demo-team',
    has_groq: true,
    has_hindsight: false,
    seeded_incidents: 12
  });

  // Operational Reflection (Reflect consolidation)
  const [reflection, setReflection] = useState(null);
  const [reflecting, setReflecting] = useState(false);
  const [showSupportingIncidents, setShowSupportingIncidents] = useState(false);

  // Persistent Incident Catalog
  const [incidentCatalog, setIncidentCatalog] = useState([]);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState('');

  // Memory Used panel state
  const [recalledMemories, setRecalledMemories] = useState([]);
  const [expandedMemoryId, setExpandedMemoryId] = useState(null);

  // Modals & Panels
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showArchitectureModal, setShowArchitectureModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedNotice, setSeedNotice] = useState(null);

  // Phase 7: Memory Difference Evaluation
  const [compareQuery, setCompareQuery] = useState('Production checkout is timing out again.');
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState(null);
  const [compareError, setCompareError] = useState(null);

  // Settings inputs
  const [groqKeyInput, setGroqKeyInput] = useState('');
  const [hindsightKeyInput, setHindsightKeyInput] = useState('');
  const [bankIdInput, setBankIdInput] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Load active session from localStorage
  useEffect(() => {
    const existing = conversations.find(c => c.id === currentConversationId);
    if (existing) {
      setMessages(existing.messages || []);
      setRecalledMemories(existing.recalledMemories || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save conversations
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
      localStorage.setItem(CURRENT_ID_KEY, currentConversationId);
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }, [conversations, currentConversationId]);

  // Fetch backend config
  const fetchConfig = () => {
    axios.get(`${BACKEND_URL}/api/config`)
      .then(res => setBackendConfig(res.data))
      .catch(err => {
        console.error('Config fetch failed:', err);
      });
  };

  // Fetch reflect operational mental models
  const fetchReflection = async () => {
    setReflecting(true);
    try {
      const res = await axios.post(`${BACKEND_URL}/api/reflect`, {
        bank_id: backendConfig.bank_id || 'devops-demo-team'
      });
      setReflection(res.data);
    } catch (err) {
      console.error('Reflect fetch failed:', err);
    } finally {
      setReflecting(false);
    }
  };

  // Fetch persistent incidents catalog
  const fetchIncidentCatalog = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/api/incidents`);
      setIncidentCatalog(res.data.incidents || []);
    } catch (err) {
      console.error('Catalog fetch failed:', err);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchReflection();
    fetchIncidentCatalog();
    const interval = setInterval(fetchConfig, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync conversation state
  const syncCurrentConversation = (updatedMessages, recalled) => {
    setConversations(prev => {
      const userMsg = updatedMessages.find(m => m.role === 'user')?.content || 'Incident Triage';
      const title = userMsg.length > 28 ? userMsg.slice(0, 28) + '...' : userMsg;
      const updatedObj = {
        id: currentConversationId,
        title,
        updatedAt: new Date().toISOString(),
        messages: updatedMessages,
        recalledMemories: recalled
      };
      const idx = prev.findIndex(c => c.id === currentConversationId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updatedObj;
        return copy;
      }
      return [updatedObj, ...prev];
    });
  };

  // Start fresh incident session
  const startNewConversation = () => {
    const newId = `inc_${Date.now()}`;
    setCurrentConversationId(newId);
    setMessages([]);
    setRecalledMemories([]);
    setLifecycleStage('idle');
    setLifecycleNote('');
  };

  // Select existing session
  const handleSelectConversation = (conv) => {
    setCurrentConversationId(conv.id);
    setMessages(conv.messages || []);
    setRecalledMemories(conv.recalledMemories || []);
    setCurrentView('chat');
  };

  // Delete session
  const handleDeleteConversation = (e, convId) => {
    e.stopPropagation();
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (currentConversationId === convId) {
      startNewConversation();
    }
  };

  // Seed 12 historical incidents
  const handleSeedIncidents = async () => {
    setSeeding(true);
    setSeedNotice(null);
    try {
      const res = await axios.post(`${BACKEND_URL}/api/seed-incidents`);
      setSeedNotice({
        type: 'success',
        text: `Successfully saved ${res.data.seeded_count}/${res.data.total_incidents} historical incident precedents into persistent memory.`
      });
      fetchConfig();
      fetchReflection();
      fetchIncidentCatalog();
      setTimeout(() => setSeedNotice(null), 6000);
    } catch (err) {
      console.error(err);
      setSeedNotice({
        type: 'error',
        text: 'Failed to seed incidents: ' + (err.response?.data?.detail || err.message)
      });
    } finally {
      setSeeding(false);
    }
  };

  // Run Controlled Memory Comparison Demo
  const handleRunCompare = async (customQuery) => {
    const q = (typeof customQuery === 'string' ? customQuery : compareQuery).trim() || 'Production checkout is timing out again.';
    setCompareQuery(q);
    setComparing(true);
    setCompareError(null);
    try {
      const res = await axios.post(`${BACKEND_URL}/api/demo/compare-memory`, {
        query: q,
        bank_id: backendConfig.bank_id || 'devops-demo-team'
      });
      setCompareResult(res.data);
    } catch (err) {
      console.error('Compare memory failed:', err);
      setCompareError(err.response?.data?.detail || err.message || 'Comparison failed');
    } finally {
      setComparing(false);
    }
  };

  // Quick Scenarios
  const quickScenarios = [
    {
      id: 'checkout',
      title: 'Checkout 504 Timeouts',
      icon: '⚡',
      service: 'Checkout API',
      prompt: 'Production checkout is timing out again.'
    },
    {
      id: 'postgres',
      title: 'Postgres Lock Contention',
      icon: '🐘',
      service: 'Customer Database',
      prompt: 'PostgreSQL database query locks causing connection pool backlog and query timeouts.'
    },
    {
      id: 'k8s',
      title: 'K8s Pod OOMKilled Loop',
      icon: '☸️',
      service: 'Order Processor',
      prompt: 'Kubernetes checkout-service pods crashing repeatedly with Exit Code 137 OOMKilled.'
    },
    {
      id: 'kafka',
      title: 'Kafka Lag Critical Spike',
      icon: '📨',
      service: 'Event Streaming',
      prompt: 'Kafka payment-events consumer group lag exceeded 50,000 messages during flash sale.'
    }
  ];

  // Submit Incident Prompt & Drive the 4-Stage Lifecycle
  const handleSend = async (messageText) => {
    const textToSend = typeof messageText === 'string' ? messageText : input;
    if (!textToSend.trim()) return;

    const userMsgIndex = messages.length;
    const newMessages = [...messages, { role: 'user', content: textToSend, id: userMsgIndex, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setCurrentView('chat');

    // Stage 1: User Incident Ingest & REMEMBER (Recall)
    setLifecycleStage('user_incident');
    setLifecycleNote('User Incident Ingestion — Remembering similar incidents from persistent memory...');

    // Timed progression simulating the transparent Virtual Memory pipeline
    setTimeout(() => {
      setLifecycleStage('recall');
      setLifecycleNote('Remembering similar incidents...');
    }, 300);

    setTimeout(() => {
      setLifecycleStage('execute');
      setLifecycleNote('Reasoning with historical experience...');
    }, 700);

    try {
      const response = await axios.post(`${BACKEND_URL}/api/chat`, {
        messages: newMessages,
        use_memory: useMemory,
        bank_id: backendConfig.bank_id || 'devops-demo-team'
      });

      const data = response.data;
      const currentRecalled = data.recalled_memories || [];
      const currentIncident = data.incident || null;

      // Stage 3: SAVE (Retain)
      setLifecycleStage('retain');
      setLifecycleNote('Saving this incident to persistent memory...');

      const assistantMsg = {
        role: 'assistant',
        id: userMsgIndex + 1,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: data.response,
        analysis: data.analysis,
        root_cause_hypotheses: data.root_cause_hypotheses || [],
        investigation_steps: data.investigation_steps || [],
        recommended_actions: data.recommended_actions || [],
        verification_steps: data.verification_steps || [],
        memoryImpact: data.memory_impact,
        incident: currentIncident,
        recalledMemories: currentRecalled,
        usedHistoricalMemory: currentRecalled.length > 0
      };

      const updatedMessages = [...newMessages, assistantMsg];
      setMessages(updatedMessages);
      setRecalledMemories(currentRecalled);
      syncCurrentConversation(updatedMessages, currentRecalled);

      // Stage 4: LEARN (Reflect)
      setTimeout(() => {
        setLifecycleStage('reflect');
        setLifecycleNote('Learning from accumulated incidents...');
      }, 500);

      setTimeout(() => {
        setLifecycleStage('completed');
        setLifecycleNote(`Triage complete. ${currentRecalled.length} precedent(s) remembered, experience saved.`);
      }, 1000);

    } catch (err) {
      console.error(err);
      setLifecycleStage('idle');
      const errMsg = err.response?.data?.detail || err.message || 'Unknown network error';
      setMessages([
        ...newMessages,
        {
          role: 'assistant',
          id: userMsgIndex + 1,
          isError: true,
          content: `⚠️ Error communicating with MemOS backend: ${errMsg}. Please ensure the server is running on port 8000.`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Copy Triage Report
  const handleCopyLastTriage = (targetMsg) => {
    const msg = targetMsg || [...messages].reverse().find(m => m.role === 'assistant' && !m.isError);
    if (!msg) return;
    const text = `MemOS Incident Triage Report:\nService: ${msg.incident?.service || 'N/A'}\nSeverity: ${msg.incident?.severity || 'P1'}\n\nAnalysis:\n${msg.analysis || msg.content}\n\nRoot Causes:\n${(msg.root_cause_hypotheses || []).map((h, i) => `${i+1}. ${h}`).join('\n')}\n\nRemediation:\n${(msg.recommended_actions || []).map((a, i) => `${i+1}. ${a}`).join('\n')}\n\nVerification:\n${(msg.verification_steps || []).join('\n')}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopyNotice('✓ Triage report copied to clipboard!');
    setTimeout(() => setCopyNotice(null), 3000);
  };

  // Export Session JSON
  const handleExportSession = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
      conversationId: currentConversationId,
      exportedAt: new Date().toISOString(),
      bankId: backendConfig.bank_id,
      messages
    }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `memos_session_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setCopyNotice('✓ Incident session exported as JSON!');
    setTimeout(() => setCopyNotice(null), 3000);
  };

  // Save settings
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    try {
      const payload = {};
      if (groqKeyInput.trim()) payload.groq_api_key = groqKeyInput.trim();
      if (hindsightKeyInput.trim()) payload.hindsight_api_key = hindsightKeyInput.trim();
      if (bankIdInput.trim()) payload.bank_id = bankIdInput.trim();

      const res = await axios.post(`${BACKEND_URL}/api/config`, payload);
      setBackendConfig(res.data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      alert('Failed to update config: ' + (err.response?.data?.detail || err.message));
    }
  };

  const suggestedDemoPrompt = "Production checkout is timing out again.";

  const filteredCatalog = incidentCatalog.filter(inc => {
    const q = catalogFilter.toLowerCase();
    return (
      (inc.incident_id || '').toLowerCase().includes(q) ||
      (inc.service || '').toLowerCase().includes(q) ||
      (inc.symptoms || '').toLowerCase().includes(q) ||
      (inc.root_cause || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100 antialiased selection:bg-cyan-500/30">
      
      {/* ========================================================================= */}
      {/* 1. TRADITIONAL CHATBOT SIDEBAR                                            */}
      {/* ========================================================================= */}
      <aside className={`transition-all duration-300 ease-in-out border-r border-slate-800/80 bg-slate-900/95 flex flex-col shrink-0 z-30 ${
        sidebarOpen ? 'w-72 sm:w-80' : 'w-0 -translate-x-full overflow-hidden border-r-0'
      }`}>
        {/* Sidebar Header */}
        <div className="p-3.5 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 flex items-center justify-center text-lg font-bold shadow-md shadow-indigo-500/20">
              ⚡
            </div>
            <div>
              <div className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
                <span>MemOS SRE</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                  Autonomous
                </span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Persistent AI Assistant
              </div>
            </div>
          </div>

          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition-colors"
            title="Collapse sidebar"
          >
            ◀
          </button>
        </div>

        {/* New Incident Chat Button */}
        <div className="p-3">
          <button
            onClick={startNewConversation}
            className="w-full py-2.5 px-3.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-cyan-950/40 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span className="text-base font-bold">+</span>
            <span>New Incident Triage</span>
          </button>
        </div>

        {/* Navigation Section */}
        <div className="px-3 pb-2">
          <div className="text-[10px] uppercase font-mono font-bold text-slate-500 mb-1.5 px-2">
            Views
          </div>
          <div className="space-y-1">
            <button
              onClick={() => setCurrentView('chat')}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                currentView === 'chat'
                  ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/80 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2">
                <span>💬</span>
                <span>Incident Chat</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">{messages.length} msgs</span>
            </button>

            <button
              onClick={() => setCurrentView('visualization')}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                currentView === 'visualization'
                  ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/80 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
              title="Visualize how the chat bot stores data in Hindsight persistent memory"
            >
              <span className="flex items-center gap-2">
                <span>📊</span>
                <span>Data Storage Visualization</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-900/50 text-indigo-300 font-mono">
                {incidentCatalog.length} Records
              </span>
            </button>
          </div>
        </div>

        {/* Quick Incident Templates */}
        <div className="px-3 pb-2 pt-1 border-t border-slate-800/80">
          <div className="text-[10px] uppercase font-mono font-bold text-slate-500 mb-1.5 px-2">
            Quick Incident Templates
          </div>
          <div className="space-y-1">
            {quickScenarios.map(sc => (
              <button
                key={sc.id}
                onClick={() => handleSend(sc.prompt)}
                disabled={loading}
                className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-cyan-200 hover:bg-slate-800/80 transition-colors flex items-center gap-2 truncate cursor-pointer disabled:opacity-50"
                title={sc.prompt}
              >
                <span>{sc.icon}</span>
                <span className="truncate">{sc.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Past Sessions List */}
        <div className="flex-1 overflow-y-auto px-3 py-2 border-t border-slate-800/80">
          <div className="text-[10px] uppercase font-mono font-bold text-slate-500 mb-1.5 px-2 flex items-center justify-between">
            <span>Recent Conversations</span>
            <span>({conversations.length})</span>
          </div>

          {conversations.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-xs italic">
              No previous conversations yet.
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  className={`w-full group px-2.5 py-2 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    currentConversationId === conv.id
                      ? 'bg-slate-800 text-white font-medium border border-slate-700'
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span>💬</span>
                    <span className="truncate">{conv.title || 'Incident Triage'}</span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(e, conv.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-slate-500 transition-opacity"
                    title="Delete session"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar Footer: Engine & Memory Bank Status */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-slate-400">Memory Bank:</span>
            <span className="text-cyan-300 font-semibold truncate max-w-[120px]">{backendConfig.bank_id}</span>
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-slate-400">Engine:</span>
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Groq 120b</span>
            </span>
          </div>
          
          <div className="pt-2 border-t border-slate-850 flex items-center gap-1.5">
            <button
              onClick={() => {
                setShowCompareModal(true);
                if (!compareResult) handleRunCompare(suggestedDemoPrompt);
              }}
              title="Phase 7 Controlled Demonstration: Cold Agent vs Memory-Enabled Agent"
              className="flex-1 py-1.5 bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white rounded-lg text-[10px] font-bold shadow transition-all cursor-pointer text-center"
            >
              ⚖️ Cold vs Memory
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg border border-slate-800 text-xs transition-colors"
              title="API Keys & Settings"
            >
              ⚙️
            </button>
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. MAIN TRADITIONAL CHAT WORKSPACE                                        */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
        
        {/* Workspace Top Header Bar */}
        <header className="h-14 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-4 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Expand sidebar"
              >
                ☰
              </button>
            )}

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm md:text-base font-bold text-white flex items-center gap-2">
                  <span>MemOS Agent</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                    v2.0 SRE
                  </span>
                </h1>
                <span className="hidden sm:inline text-slate-600">•</span>
                <span className="hidden sm:inline text-xs text-slate-400">
                  Virtual Memory Architecture for Autonomous AI Agents
                </span>
              </div>
            </div>
          </div>

          {/* View Switcher & Action Controls */}
          <div className="flex items-center gap-2">
            {/* View Switcher: Chat vs Visualization */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setCurrentView('chat')}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                  currentView === 'chat'
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                💬 Incident Chat
              </button>
              <button
                onClick={() => setCurrentView('visualization')}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                  currentView === 'visualization'
                    ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="How does the chat bot visualize data storage"
              >
                📊 Data Storage Visualization
              </button>
            </div>

            {/* Memory Sync Toggle */}
            <div className="hidden sm:flex items-center text-xs bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800">
              <input
                id="memory-toggle"
                type="checkbox"
                checked={useMemory}
                onChange={(e) => setUseMemory(e.target.checked)}
                className="mr-1.5 accent-cyan-500 cursor-pointer"
              />
              <label htmlFor="memory-toggle" className="cursor-pointer select-none text-[11px] text-cyan-300 font-mono font-semibold">
                Memory Enabled
              </label>
            </div>

            {/* Seed 12 Incidents */}
            <button
              onClick={handleSeedIncidents}
              disabled={seeding}
              className="hidden lg:flex px-2.5 py-1.5 bg-slate-950 hover:bg-slate-850 text-slate-300 border border-slate-800 rounded-xl text-xs font-mono transition-colors items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Seed 12 realistic incidents into persistent memory"
            >
              <span>{seeding ? '⚡ Seeding...' : '⚡ Seed 12'}</span>
            </button>

            {/* Export Session */}
            <button
              onClick={handleExportSession}
              className="hidden md:flex px-2.5 py-1.5 bg-slate-950 hover:bg-slate-850 text-slate-300 border border-slate-800 rounded-xl text-xs font-mono transition-colors items-center gap-1 cursor-pointer"
              title="Export active incident conversation as JSON"
            >
              <span>💾 Export</span>
            </button>

            {/* Toggle Memory Inspector Drawer */}
            <button
              onClick={() => setInspectorOpen(!inspectorOpen)}
              className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                inspectorOpen
                  ? 'bg-cyan-950/70 border-cyan-800 text-cyan-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
              title="Toggle Memory Inspector panel"
            >
              🧠 Inspector
            </button>
          </div>
        </header>

        {/* Global Agent Lifecycle Ribbon */}
        <div className="bg-slate-900 border-b border-slate-800/80 px-4 py-2 shrink-0">
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-1.5">
            <div className="flex items-center gap-2 overflow-x-auto text-[11px] font-mono no-scrollbar">
              <span className={`px-2 py-0.5 rounded border transition-all ${
                lifecycleStage === 'user_incident' || lifecycleStage === 'recall'
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-500 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800'
              }`}>
                1. RECALL (Page In)
              </span>
              <span className="text-slate-600">→</span>
              <span className={`px-2 py-0.5 rounded border transition-all ${
                lifecycleStage === 'execute'
                  ? 'bg-indigo-950 text-indigo-300 border-indigo-500 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800'
              }`}>
                2. REASON (RAM)
              </span>
              <span className="text-slate-600">→</span>
              <span className={`px-2 py-0.5 rounded border transition-all ${
                lifecycleStage === 'retain'
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800'
              }`}>
                3. RETAIN (Page Out)
              </span>
              <span className="text-slate-600">→</span>
              <span className={`px-2 py-0.5 rounded border transition-all ${
                lifecycleStage === 'reflect'
                  ? 'bg-purple-950 text-purple-300 border-purple-500 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800'
              }`}>
                4. REFLECT (Consolidate)
              </span>
            </div>

            {lifecycleNote ? (
              <div className="text-[11px] font-mono text-cyan-300 flex items-center gap-1.5 animate-pulse truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                <span className="truncate">{lifecycleNote}</span>
              </div>
            ) : (
              <div className="text-[11px] font-mono text-slate-500">
                Persistent Memory Bank: {backendConfig.bank_id}
              </div>
            )}
          </div>
        </div>

        {/* Notices */}
        {seedNotice && (
          <div className={`p-2 px-4 text-xs font-mono flex items-center justify-between ${
            seedNotice.type === 'success' ? 'bg-emerald-950/90 text-emerald-200 border-b border-emerald-800' : 'bg-rose-950/90 text-rose-200 border-b border-rose-800'
          }`}>
            <span>{seedNotice.text}</span>
            <button onClick={() => setSeedNotice(null)} className="text-slate-400 hover:text-white px-2">✕</button>
          </div>
        )}

        {copyNotice && (
          <div className="p-2 px-4 text-xs font-mono bg-indigo-950/90 text-cyan-200 border-b border-indigo-800 flex items-center justify-between">
            <span>{copyNotice}</span>
            <button onClick={() => setCopyNotice(null)} className="text-slate-400 hover:text-white px-2">✕</button>
          </div>
        )}

        {/* ======================================================================= */}
        {/* WORKSPACE CONTENT AREA                                                  */}
        {/* ======================================================================= */}
        <div className="flex-1 flex overflow-hidden relative">

          {/* VIEW 1: TRADITIONAL INCIDENT CHAT */}
          {currentView === 'chat' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              
              {/* Message Scroll Container */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
                <div className="max-w-3xl mx-auto w-full space-y-5">
                  
                  {/* Empty Chat Welcome Hero */}
                  {messages.length === 0 ? (
                    <div className="py-8 md:py-12 flex flex-col items-center text-center space-y-6">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-600 via-indigo-600 to-purple-600 flex items-center justify-center text-3xl shadow-xl shadow-indigo-500/20">
                        🤖
                      </div>
                      
                      <div className="space-y-2 max-w-lg">
                        <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                          Ready for Incident Triage
                        </h2>
                        <p className="text-xs md:text-sm text-slate-400 leading-relaxed">
                          MemOS is an autonomous SRE assistant that recalls matching past outages from persistent memory, diagnoses active symptoms with Groq, and writes verified remediations back to disk.
                        </p>
                      </div>

                      {/* Demo Scenario Box */}
                      <div className="w-full max-w-xl p-3.5 bg-slate-900 rounded-xl border border-indigo-500/30 flex items-center justify-between gap-3 shadow-md">
                        <div className="text-left truncate">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400 block">
                            Demo Scenario:
                          </span>
                          <span className="text-xs font-mono text-cyan-200 truncate font-semibold block">
                            "{suggestedDemoPrompt}"
                          </span>
                        </div>
                        <button
                          onClick={() => handleSend(suggestedDemoPrompt)}
                          disabled={loading}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          ▶ Run Scenario
                        </button>
                      </div>

                      {/* 4 Clickable Quick Prompt Cards */}
                      <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                        {quickScenarios.map(sc => (
                          <div
                            key={sc.id}
                            onClick={() => handleSend(sc.prompt)}
                            className="p-3 bg-slate-900/70 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-xl text-left transition-all cursor-pointer group shadow-sm"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-base">{sc.icon}</span>
                              <span className="font-semibold text-xs text-white group-hover:text-cyan-300 transition-colors">
                                {sc.title}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                              {sc.prompt}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Visualize Storage CTA */}
                      <div className="pt-2">
                        <button
                          onClick={() => setCurrentView('visualization')}
                          className="text-xs font-mono text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 cursor-pointer underline"
                        >
                          <span>📊 Want to see how data is stored? Open Data Storage Visualization →</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    messages.map((msg, idx) => {
                      if (msg.role === 'user') {
                        return (
                          <div key={idx} className="flex justify-end">
                            <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-3.5 text-xs shadow-md font-sans">
                              <div className="flex items-center justify-between gap-4 text-[10px] text-blue-200 font-semibold mb-1 font-mono uppercase tracking-wider">
                                <span>🧑‍💻 SRE Incident Report</span>
                                <span>{msg.timestamp || 'Just now'}</span>
                              </div>
                              <div className="text-sm font-medium leading-relaxed">{msg.content}</div>
                            </div>
                          </div>
                        );
                      }

                      if (msg.isError) {
                        return (
                          <div key={idx} className="p-4 bg-rose-950/80 border border-rose-600 rounded-xl text-xs text-rose-200 font-mono">
                            {msg.content}
                          </div>
                        );
                      }

                      // Assistant Response
                      return (
                        <div key={idx} className="flex gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-sm shadow-md shrink-0">
                            🤖
                          </div>

                          <div className="flex-1 space-y-3">
                            
                            {/* Incident Summary Banner */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded font-mono font-bold text-xs">
                                  {msg.incident?.incident_id || 'INC-TRIAGE'}
                                </span>
                                <span className="font-bold text-sm text-white">
                                  {msg.incident?.service || 'Target Service'}
                                </span>
                                <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                  (msg.incident?.severity || 'P1') === 'P1'
                                    ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                    : 'bg-amber-950 text-amber-300 border border-amber-800'
                                }`}>
                                  {msg.incident?.severity || 'P1'}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                {msg.usedHistoricalMemory ? (
                                  <span className="px-2.5 py-1 bg-indigo-950 text-cyan-300 border border-cyan-500/40 rounded-full text-[11px] font-mono flex items-center gap-1 font-semibold">
                                    <span>⚡ Recalled from persistent memory</span>
                                    <span>({msg.recalledMemories?.length || 1})</span>
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-[10px] font-mono">
                                    Stateless Zero-Shot
                                  </span>
                                )}

                                {/* Option: Visualize this incident's storage */}
                                <button
                                  onClick={() => setCurrentView('visualization')}
                                  className="px-2.5 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-lg text-[10px] font-mono transition-colors cursor-pointer"
                                  title="View how this incident and memory are stored"
                                >
                                  📊 Visualize Data
                                </button>
                              </div>
                            </div>

                            {/* Card 1: Situation Analysis */}
                            <div className="p-3.5 bg-slate-900 rounded-xl border border-slate-800 shadow-sm text-xs">
                              <div className="flex items-center gap-2 font-bold text-slate-200 text-xs uppercase tracking-wider mb-1.5 font-mono">
                                <span>📋</span>
                                <span>Situation Analysis</span>
                              </div>
                              <p className="text-slate-300 leading-relaxed font-sans text-xs">
                                {msg.analysis || msg.content?.split('#### 🔍')[0]?.replace(/###[^\n]+\n/, '').trim() || msg.content}
                              </p>
                            </div>

                            {/* Card 2: Root Cause Hypotheses */}
                            {msg.root_cause_hypotheses && msg.root_cause_hypotheses.length > 0 && (
                              <div className="p-3.5 bg-slate-900 rounded-xl border border-slate-800 shadow-sm text-xs">
                                <div className="flex items-center gap-2 font-bold text-amber-400 text-xs uppercase tracking-wider mb-2 font-mono">
                                  <span>🔍</span>
                                  <span>Root-Cause Hypotheses</span>
                                </div>
                                <div className="space-y-1.5">
                                  {msg.root_cause_hypotheses.map((hyp, hIdx) => (
                                    <div key={hIdx} className="p-2 rounded bg-slate-950/70 border border-slate-850 flex items-start gap-2">
                                      <span className="text-amber-400 font-mono font-bold">{hIdx + 1}.</span>
                                      <span className="text-slate-200 font-sans leading-snug">{hyp}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Card 3: Recommended Actions */}
                            {msg.recommended_actions && msg.recommended_actions.length > 0 && (
                              <div className="p-3.5 bg-slate-900 rounded-xl border border-slate-800 shadow-sm text-xs">
                                <div className="flex items-center gap-2 font-bold text-indigo-300 text-xs uppercase tracking-wider mb-2 font-mono">
                                  <span>🛠️</span>
                                  <span>Recommended Actions</span>
                                </div>
                                <div className="space-y-1.5">
                                  {msg.recommended_actions.map((act, aIdx) => (
                                    <div key={aIdx} className="p-2 rounded bg-indigo-950/30 border border-indigo-900/40 flex items-start gap-2">
                                      <span className="text-indigo-400 font-mono font-bold">{aIdx + 1}.</span>
                                      <span className="text-slate-200 font-sans leading-snug">{act}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Card 4: Verification Steps */}
                            {msg.verification_steps && msg.verification_steps.length > 0 && (
                              <div className="p-3.5 bg-slate-900 rounded-xl border border-slate-800 shadow-sm text-xs">
                                <div className="flex items-center gap-2 font-bold text-emerald-400 text-xs uppercase tracking-wider mb-2 font-mono">
                                  <span>✅</span>
                                  <span>Verification Steps</span>
                                </div>
                                <div className="space-y-1.5">
                                  {msg.verification_steps.map((ver, vIdx) => (
                                    <div key={vIdx} className="p-2 rounded bg-emerald-950/20 border border-emerald-900/40 flex items-start gap-2">
                                      <span className="text-emerald-400 font-mono font-bold">✓</span>
                                      <span className="text-slate-200 font-sans leading-snug">{ver}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Memory Impact Note */}
                            {msg.memoryImpact && (
                              <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/40 text-[11px] text-cyan-200 font-sans flex items-start gap-2">
                                <span className="text-sm">🧠</span>
                                <div>
                                  <strong className="text-cyan-300 font-mono">Persistent Memory Impact: </strong>
                                  <span>{msg.memoryImpact}</span>
                                </div>
                              </div>
                            )}

                            {/* Message Action Footer */}
                            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono pt-1">
                              <span>Triage generated by Groq (openai/gpt-oss-120b)</span>
                              <button
                                onClick={() => handleCopyLastTriage(msg)}
                                className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                              >
                                <span>📋</span>
                                <span>Copy Playbook</span>
                              </button>
                            </div>

                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* Live Loading Lifecycle Tracker */}
                  {loading && (
                    <div className="p-4 bg-slate-900 rounded-xl border border-cyan-500/40 shadow-lg text-xs space-y-2 animate-pulse max-w-3xl mx-auto">
                      <div className="flex items-center justify-between text-cyan-300 font-mono font-bold">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping"></span>
                          <span>{lifecycleNote || 'User Incident Ingestion — Remembering similar incidents...'}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider">Virtual Memory Pipeline</span>
                      </div>
                      <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-gradient-to-r from-cyan-400 via-indigo-500 to-purple-500 h-full w-full animate-indeterminate"></div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Bottom Traditional Chat Prompt Input Dock */}
              <div className="p-4 bg-slate-900/90 border-t border-slate-800 shrink-0">
                <div className="max-w-3xl mx-auto w-full space-y-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend(input);
                    }}
                    className="flex items-center gap-2 bg-slate-950 p-2 rounded-2xl border border-slate-800 focus-within:border-cyan-500 shadow-xl transition-all"
                  >
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Describe incident symptoms (e.g. 'Production checkout is timing out again')..."
                      className="flex-1 bg-transparent px-3 py-2 text-xs md:text-sm text-white placeholder-slate-500 focus:outline-none font-mono"
                      disabled={loading}
                    />
                    <button
                      type="submit"
                      disabled={loading || !input.trim()}
                      className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white rounded-xl text-xs md:text-sm font-bold shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      Triage
                    </button>
                  </form>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 px-2">
                    <span>Press Enter to triage • Powered by Groq 120b & Hindsight Cloud</span>
                    <button
                      onClick={() => setCurrentView('visualization')}
                      className="text-cyan-400 hover:underline cursor-pointer"
                    >
                      How is data stored? Click to visualize →
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* VIEW 2: DATA STORAGE VISUALIZATION */}
          {currentView === 'visualization' && (
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-950">
              <div className="max-w-6xl mx-auto w-full">
                
                {/* Visualizer Header Bar with Back Button */}
                <div className="mb-4 flex items-center justify-between">
                  <button
                    onClick={() => setCurrentView('chat')}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-slate-800 text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>←</span>
                    <span>Back to Incident Chat</span>
                  </button>
                  <span className="text-xs font-mono text-cyan-300">
                    Showing Data Architecture for Bank: <strong>{backendConfig.bank_id}</strong>
                  </span>
                </div>

                {/* The Data Storage Visualization Component */}
                <DataStorageVisualization
                  incidentCatalog={incidentCatalog}
                  backendConfig={backendConfig}
                  reflection={reflection}
                  onTriageIncident={handleSend}
                />
              </div>
            </div>
          )}

          {/* RIGHT SIDEBAR: MEMORY INSPECTOR & OPERATIONAL LEARNING */}
          {inspectorOpen && (
            <aside className="w-80 lg:w-96 border-l border-slate-800 bg-slate-900/90 flex flex-col shrink-0 overflow-hidden z-10">
              
              {/* Inspector Header */}
              <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
                <span className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                  <span>🧠 Memory Inspector</span>
                </span>
                <button
                  onClick={() => setInspectorOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                
                {/* Panel 1: Memory Used (Recalled Precedents) */}
                <div className="bg-slate-950 rounded-xl border border-slate-800 p-3 shadow-sm">
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-850">
                    <span className="text-xs font-bold text-cyan-400 font-mono">
                      Memory Used
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                      {recalledMemories.length} Precedent(s)
                    </span>
                  </div>

                  {recalledMemories.length === 0 ? (
                    <div className="py-6 text-center text-slate-500 text-xs font-mono">
                      <div className="text-xl mb-1">📥</div>
                      <div>No Precedents Recalled Yet</div>
                      <p className="text-[10px] text-slate-500 mt-1 max-w-xs mx-auto">
                        Report an incident to see Hindsight page matching institutional precedents into working RAM.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recalledMemories.map((rawMem, i) => {
                        const mem = parseMemoryCardFields(rawMem);
                        const isExpanded = expandedMemoryId === i;
                        return (
                          <div key={i} className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 text-xs">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold text-cyan-400 font-mono text-xs">{mem.incident_id}</span>
                              <span className="text-[10px] font-mono text-slate-400">{mem.service}</span>
                            </div>
                            <div className="text-slate-200 text-xs font-medium mb-1.5 leading-snug">
                              {mem.root_cause}
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[10px] font-mono">
                              <span className="text-cyan-400">⚡ Recalled from persistent memory</span>
                              <button
                                onClick={() => setExpandedMemoryId(isExpanded ? null : i)}
                                className="text-slate-400 hover:text-white underline cursor-pointer"
                              >
                                {isExpanded ? 'Hide ▲' : 'Details ▼'}
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="mt-2 pt-2 border-t border-slate-800 space-y-1.5 text-[11px] font-sans">
                                <div>
                                  <span className="text-[10px] font-mono text-amber-400 font-bold block">Symptom:</span>
                                  <span className="text-slate-300">{mem.symptom}</span>
                                </div>
                                <div>
                                  <span className="text-[10px] font-mono text-emerald-400 font-bold block">Verified Fix:</span>
                                  <span className="text-slate-300">{mem.remediation}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Panel 2: What the Agent Learned (Reflect Consolidation) */}
                <div className="bg-slate-950 rounded-xl border border-slate-800 p-3 shadow-sm">
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-850">
                    <span className="text-xs font-bold text-purple-300 font-mono">
                      What the agent learned
                    </span>
                    <button
                      onClick={fetchReflection}
                      disabled={reflecting}
                      className="text-[10px] font-mono text-purple-300 hover:underline cursor-pointer"
                    >
                      {reflecting ? 'Learning...' : 'Refresh'}
                    </button>
                  </div>

                  <div className="p-2.5 rounded-lg bg-purple-950/30 border border-purple-800/40 text-xs space-y-2">
                    <p className="text-slate-200 italic leading-relaxed text-xs">
                      "{reflection?.mental_model || reflection?.reflection || 'Checkout timeouts frequently correlate with Redis connection saturation during traffic spikes.'}"
                    </p>

                    <div className="flex items-center justify-between pt-1 border-t border-purple-900/40 text-[10px] font-mono">
                      <span className="text-purple-300 font-semibold">
                        Based on {reflection?.supporting_incidents?.length || 5} incidents
                      </span>
                      <button
                        onClick={() => setShowSupportingIncidents(!showSupportingIncidents)}
                        className="text-purple-400 hover:text-purple-200 underline cursor-pointer"
                      >
                        {showSupportingIncidents ? 'Hide ▲' : 'View supporting incidents ▼'}
                      </button>
                    </div>

                    {showSupportingIncidents && (
                      <div className="pt-2 border-t border-purple-900/40 space-y-2 text-[10px] font-mono">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-slate-400">Incidents:</span>
                          {(reflection?.supporting_incidents || ['INC-184', 'INC-127', 'INC-101']).map((id, sIdx) => (
                            <span key={sIdx} className="px-1.5 py-0.2 bg-purple-900/60 text-purple-200 rounded border border-purple-700">
                              {id}
                            </span>
                          ))}
                        </div>

                        {reflection?.recommended_operational_rules && reflection.recommended_operational_rules.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-emerald-400 font-bold block uppercase">
                              Prescriptive Rule:
                            </span>
                            <div className="p-1.5 bg-slate-900 rounded border border-slate-800 text-slate-300 leading-snug">
                              {reflection.recommended_operational_rules[0]}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Link to Data Storage Visualization */}
                <div className="p-3 bg-gradient-to-r from-cyan-950/40 to-indigo-950/40 rounded-xl border border-cyan-800/40 text-center">
                  <div className="text-xs font-bold text-white mb-1">
                    Visual Storage Engine
                  </div>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Inspect the 1536-dim vector embeddings and disk blocks in Hindsight.
                  </p>
                  <button
                    onClick={() => setCurrentView('visualization')}
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow transition-colors cursor-pointer"
                  >
                    Open Data Visualization →
                  </button>
                </div>

              </div>
            </aside>
          )}

        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: CONTROLLED MEMORY DIFFERENCE DEMONSTRATION (Phase 7)             */}
      {/* ========================================================================= */}
      {showCompareModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 overflow-y-auto">
          <div className="bg-slate-900 rounded-2xl border border-indigo-500/70 shadow-2xl max-w-4xl w-full p-5 max-h-[90vh] overflow-y-auto text-left">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                  <span>⚖️ Controlled Memory Impact Demonstration</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                    Cold vs Memory
                  </span>
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  See how persistent incident memory fundamentally transforms autonomous SRE triage.
                </p>
              </div>
              <button
                onClick={() => setShowCompareModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 mb-4">
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <input
                  type="text"
                  value={compareQuery}
                  onChange={(e) => setCompareQuery(e.target.value)}
                  placeholder="Enter incident query to evaluate in both modes..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs md:text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono w-full"
                  disabled={comparing}
                />
                <button
                  onClick={() => handleRunCompare(compareQuery)}
                  disabled={comparing || !compareQuery.trim()}
                  className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-amber-500 via-rose-600 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white text-xs md:text-sm font-bold rounded-lg shadow transition-all cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {comparing ? 'Evaluating Both Modes...' : 'Run Controlled Comparison'}
                </button>
              </div>
            </div>

            {compareError && (
              <div className="p-3 bg-rose-950/80 border border-rose-600 rounded-xl text-xs text-rose-200 font-mono mb-4">
                {compareError}
              </div>
            )}

            {compareResult && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Cold Agent */}
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                      <span className="font-bold text-amber-400 text-xs font-mono">
                        COLD AGENT
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                        Stateless Zero-Shot
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mb-3">{compareResult.cold_agent?.analysis}</p>
                    <div className="space-y-1 text-xs">
                      <span className="text-slate-400 font-mono text-[10px] font-bold block uppercase">Hypothesis:</span>
                      <div className="p-2 rounded bg-slate-900 border border-slate-800 text-slate-300">
                        {compareResult.cold_agent?.root_cause_hypotheses?.[0] || 'Generic investigation'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-850 text-[10px] text-slate-500 font-mono">
                    Memory Precedents: 0
                  </div>
                </div>

                {/* MemOS Memory-Enabled Agent */}
                <div className="p-4 bg-slate-950 rounded-xl border border-cyan-800 shadow-md flex flex-col justify-between ring-1 ring-cyan-500/40">
                  <div>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                      <span className="font-bold text-cyan-300 text-xs font-mono">
                        MEMOS AGENT
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                        Virtual Memory Enabled
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 mb-3">{compareResult.memory_agent?.analysis}</p>
                    <div className="space-y-1 text-xs">
                      <span className="text-cyan-400 font-mono text-[10px] font-bold block uppercase">
                        Precedent-Informed Hypothesis:
                      </span>
                      <div className="p-2 rounded bg-cyan-950/40 border border-cyan-800/80 text-cyan-200">
                        {compareResult.memory_agent?.root_cause_hypotheses?.[0] || 'Redis connection pool exhaustion'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-850 text-[10px] text-cyan-400 font-mono">
                    Paged-in: {compareResult.memory_agent?.recalled_incident_ids?.join(', ') || 'INC-184'}
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ARCHITECTURE MODAL                                               */}
      {/* ========================================================================= */}
      {showArchitectureModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 overflow-y-auto">
          <div className="bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl max-w-2xl w-full p-5 text-left">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>📐 How MemOS Virtual Memory Architecture Works</span>
              </h3>
              <button
                onClick={() => setShowArchitectureModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-xs leading-relaxed text-slate-300">
              <p>
                MemOS maps classical computer operating system virtual memory primitives to autonomous AI agent memory:
              </p>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <span className="font-bold text-cyan-400 font-mono block mb-1">RAM = Groq Context Window</span>
                <p className="text-slate-300 text-[11px]">Volatile, ultra-fast working memory for active incident triage.</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <span className="font-bold text-emerald-400 font-mono block mb-1">Disk = Hindsight Persistent Memory</span>
                <p className="text-slate-300 text-[11px]">Durable external secondary storage holding institutional postmortems and runbooks.</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <span className="font-bold text-purple-400 font-mono block mb-1">Reflect = Memory Consolidation</span>
                <p className="text-slate-300 text-[11px]">Extracts overarching operational mental models from accumulated incident history.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: INCIDENT CATALOG                                                 */}
      {/* ========================================================================= */}
      {showCatalogModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 overflow-y-auto">
          <div className="bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl max-w-3xl w-full p-5 max-h-[90vh] overflow-y-auto text-left">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>📚 Persistent Incident Catalog ({incidentCatalog.length})</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Historical incidents currently saved in persistent memory bank '{backendConfig.bank_id}'.
                </p>
              </div>
              <button
                onClick={() => setShowCatalogModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="mb-3">
              <input
                type="text"
                placeholder="Filter incidents by service, symptom, or root cause..."
                value={catalogFilter}
                onChange={(e) => setCatalogFilter(e.target.value)}
                className="w-full text-xs p-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
              />
            </div>

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {filteredCatalog.map((inc) => (
                <div key={inc.incident_id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-cyan-400 font-mono text-xs">{inc.incident_id}</span>
                      <span className="text-slate-200 font-semibold">{inc.service}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      inc.severity === 'P1' ? 'bg-rose-950 text-rose-300' : 'bg-amber-950 text-amber-300'
                    }`}>
                      {inc.severity}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs mb-2 leading-snug">{inc.symptoms}</p>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-850 text-[11px] font-mono">
                    <span className="text-slate-500">Cause: {inc.root_cause?.slice(0, 50)}...</span>
                    <button
                      onClick={() => {
                        setShowCatalogModal(false);
                        handleSend(`Production degradation in ${inc.service}: ${inc.symptoms}`);
                      }}
                      className="text-cyan-400 hover:text-cyan-200 font-semibold cursor-pointer"
                    >
                      Triage This →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: SETTINGS (KEYS & BANK ID)                                        */}
      {/* ========================================================================= */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 overflow-y-auto">
          <div className="bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl max-w-lg w-full p-5 text-left">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>⚙️ Engine & Memory Configuration</span>
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Groq API Key (openai/gpt-oss-120b)
                </label>
                <input
                  type="password"
                  placeholder={backendConfig.has_groq ? "•••••••••••• (Configured)" : "Enter gsk_..."}
                  value={groqKeyInput}
                  onChange={(e) => setGroqKeyInput(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Hindsight Cloud API Key
                </label>
                <input
                  type="password"
                  placeholder={backendConfig.has_hindsight ? "•••••••••••• (Configured)" : "Enter Hindsight key..."}
                  value={hindsightKeyInput}
                  onChange={(e) => setHindsightKeyInput(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Hindsight Memory Bank ID
                </label>
                <input
                  type="text"
                  placeholder="devops-demo-team"
                  value={bankIdInput}
                  onChange={(e) => setBankIdInput(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white font-mono"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <span className="text-emerald-400 text-xs">
                  {saveSuccess ? "✓ Settings saved!" : ""}
                </span>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded shadow cursor-pointer"
                >
                  Save & Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
