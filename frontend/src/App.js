import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

// Dynamically determine the backend URL based on how the app is accessed:
// 1. If REACT_APP_BACKEND_URL is set, use it.
// 2. If running on a dedicated static/dev port (e.g., 3000, 4000, 5000), route to backend on 8000.
// 3. If running on port 8000 or through a tunnel/proxy, use relative path ('').
const getBackendUrl = () => {
  if (process.env.REACT_APP_BACKEND_URL) return process.env.REACT_APP_BACKEND_URL;
  if (typeof window !== 'undefined' && window.location.port && window.location.port !== '8000') {
    return `http://${window.location.hostname || 'localhost'}:8000`;
  }
  return '';
};

const BACKEND_URL = getBackendUrl();
const STORAGE_KEY = 'emotion_agent_conversations_v1';
const CURRENT_ID_KEY = 'emotion_agent_active_conv_id';

function App() {
  // Past conversations list
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Current conversation ID
  const [currentConversationId, setCurrentConversationId] = useState(() => {
    try {
      return localStorage.getItem(CURRENT_ID_KEY) || `conv_${Date.now()}`;
    } catch {
      return `conv_${Date.now()}`;
    }
  });

  // Active chat state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [useMemory, setUseMemory] = useState(true);
  
  // Backend config
  const [backendConfig, setBackendConfig] = useState({ 
    status: 'connecting', 
    active_engine: 'Checking...',
    has_groq: false,
    has_gemini: false,
    has_hindsight: false
  });
  const [reflection, setReflection] = useState(null);
  const [reflecting, setReflecting] = useState(false);
  
  // Settings modal & History drawer
  const [showSettings, setShowSettings] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [groqKeyInput, setGroqKeyInput] = useState('');
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [hindsightKeyInput, setHindsightKeyInput] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Dashboard state (Current / Latest Turn)
  const [latestEmotions, setLatestEmotions] = useState([]);
  const [latestNeeds, setLatestNeeds] = useState([]);
  const [latestThemes, setLatestThemes] = useState([]);
  const [memoryOperations, setMemoryOperations] = useState([]);

  // Prompt History & Conversation Bullet Points Table (Column 3)
  const [conversationTurns, setConversationTurns] = useState([]);
  const [selectedTurnId, setSelectedTurnId] = useState(null);
  const [tableSearch, setTableSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load the active conversation on initial mount
  useEffect(() => {
    const existing = conversations.find(c => c.id === currentConversationId);
    if (existing) {
      setMessages(existing.messages || []);
      setConversationTurns(existing.conversationTurns || []);
      setLatestEmotions(existing.latestEmotions || []);
      setLatestNeeds(existing.latestNeeds || []);
      setLatestThemes(existing.latestThemes || []);
      setMemoryOperations(existing.memoryOperations || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save conversations to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
      localStorage.setItem(CURRENT_ID_KEY, currentConversationId);
    } catch (e) {
      console.error("Failed to save to localStorage:", e);
    }
  }, [conversations, currentConversationId]);

  const fetchConfig = () => {
    axios.get(`${BACKEND_URL}/api/config`)
      .then(res => {
        setBackendConfig(res.data);
      })
      .catch((err) => {
        console.error("Backend health check failed:", err);
        setBackendConfig(prev => ({ ...prev, status: 'offline', active_engine: 'Backend Offline (Port 8000)' }));
      });
  };

  useEffect(() => {
    fetchConfig();
    const interval = setInterval(fetchConfig, 10000);
    return () => clearInterval(interval);
  }, []);

  // Helper to persist/sync the current conversation into the conversations array
  const syncCurrentConversation = (updatedMessages, updatedTurns, emotions, needs, themes, memOps) => {
    setConversations(prev => {
      const title = updatedTurns[0]?.prompt 
        ? (updatedTurns[0].prompt.length > 35 ? updatedTurns[0].prompt.slice(0, 35) + '...' : updatedTurns[0].prompt)
        : (themes[0] || 'New Conversation');

      const updatedObj = {
        id: currentConversationId,
        title,
        updatedAt: new Date().toISOString(),
        messages: updatedMessages,
        conversationTurns: updatedTurns,
        latestEmotions: emotions,
        latestNeeds: needs,
        latestThemes: themes,
        memoryOperations: memOps
      };

      const existingIndex = prev.findIndex(c => c.id === currentConversationId);
      if (existingIndex >= 0) {
        const copy = [...prev];
        copy[existingIndex] = updatedObj;
        return copy;
      } else {
        return [updatedObj, ...prev];
      }
    });
  };

  // Start a brand new conversation
  const startNewConversation = () => {
    // If the active one has messages, ensure it's saved
    if (messages.length > 0) {
      syncCurrentConversation(messages, conversationTurns, latestEmotions, latestNeeds, latestThemes, memoryOperations);
    }

    const newId = `conv_${Date.now()}`;
    setCurrentConversationId(newId);
    setMessages([]);
    setConversationTurns([]);
    setLatestEmotions([]);
    setLatestNeeds([]);
    setLatestThemes([]);
    setMemoryOperations([]);
    setSelectedTurnId(null);
    setShowHistoryDrawer(false);
  };

  // Load a past conversation
  const loadConversation = (conv) => {
    // Save current if it has messages
    if (messages.length > 0 && currentConversationId !== conv.id) {
      syncCurrentConversation(messages, conversationTurns, latestEmotions, latestNeeds, latestThemes, memoryOperations);
    }

    setCurrentConversationId(conv.id);
    setMessages(conv.messages || []);
    setConversationTurns(conv.conversationTurns || []);
    setLatestEmotions(conv.latestEmotions || []);
    setLatestNeeds(conv.latestNeeds || []);
    setLatestThemes(conv.latestThemes || []);
    setMemoryOperations(conv.memoryOperations || []);
    setSelectedTurnId(null);
    setShowHistoryDrawer(false);
  };

  // Delete a conversation from history
  const deleteConversation = (e, convId) => {
    e.stopPropagation();
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (currentConversationId === convId) {
      startNewConversation();
    }
  };

  const handleSend = async (messageText) => {
    const textToSend = typeof messageText === 'string' ? messageText : input;
    if (!textToSend.trim()) return;

    const userMsgIndex = messages.length;
    const newMessages = [...messages, { role: 'user', content: textToSend, id: userMsgIndex }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post(`${BACKEND_URL}/api/chat`, {
        messages: newMessages,
        use_memory: useMemory
      });

      const data = response.data;
      const updatedMessages = [...newMessages, { role: 'assistant', content: data.response, id: userMsgIndex + 1 }];
      setMessages(updatedMessages);
      
      // Update latest dashboard signals
      const nextEmotions = data.emotions || [];
      const nextNeeds = data.needs || [];
      const nextThemes = data.themes || [];
      const nextMemOps = data.memory_operations && data.memory_operations.length > 0
        ? [...memoryOperations, ...data.memory_operations]
        : memoryOperations;

      setLatestEmotions(nextEmotions);
      setLatestNeeds(nextNeeds);
      setLatestThemes(nextThemes);
      setMemoryOperations(nextMemOps);

      // Generate or retrieve formatted bullet points for this conversation turn
      let turnBullets = [];
      if (data.bullet_points && Array.isArray(data.bullet_points) && data.bullet_points.length > 0) {
        turnBullets = data.bullet_points;
      } else {
        turnBullets = [
          `Detected emotional state: ${nextEmotions.join(', ') || 'Attentive'}`,
          `Identified underlying need: ${nextNeeds.join(', ') || 'Insightful guidance'}`,
          `Conversation themes: ${nextThemes.join(', ') || 'General Collaboration'}`,
          data.memory_operations?.length 
            ? `Memory operation: ${data.memory_operations.map(m => `${m.action} -> ${m.data}`).join('; ')}`
            : 'Memory status: Context retained in cognitive memory bank'
        ];
      }

      // Create new prompt journey log entry
      const newTurn = {
        turnNumber: conversationTurns.length + 1,
        messageIndex: userMsgIndex,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        prompt: textToSend,
        response: data.response,
        emotions: nextEmotions,
        needs: nextNeeds,
        themes: nextThemes,
        memoryOperations: data.memory_operations || [],
        bulletPoints: turnBullets
      };

      const updatedTurns = [newTurn, ...conversationTurns];
      setConversationTurns(updatedTurns);

      // Sync to conversation history
      syncCurrentConversation(updatedMessages, updatedTurns, nextEmotions, nextNeeds, nextThemes, nextMemOps);

    } catch (err) {
      console.error(err);
      const errMsg = err.response?.data?.detail || err.message || 'Unknown network error';
      setMessages([
        ...newMessages, 
        { 
          role: 'assistant', 
          content: `⚠️ Error reaching server: ${errMsg}. Please ensure the backend is running on port 8000.` 
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const scrollToPromptInChat = (msgIdx, turnNumber) => {
    setSelectedTurnId(turnNumber);
    const element = document.getElementById(`msg-${msgIdx}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('ring-4', 'ring-indigo-400', 'transition-all');
      setTimeout(() => {
        element.classList.remove('ring-4', 'ring-indigo-400');
      }, 2500);
    }
  };

  const handleReflect = async () => {
    setReflecting(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/reflect`);
      setReflection(res.data.reflection);
    } catch (err) {
      console.error(err);
      setReflection("Unable to synthesize reflections right now. Please verify the backend on port 8000.");
    } finally {
      setReflecting(false);
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    try {
      const payload = {};
      if (groqKeyInput.trim()) payload.groq_api_key = groqKeyInput.trim();
      if (geminiKeyInput.trim()) payload.gemini_api_key = geminiKeyInput.trim();
      if (hindsightKeyInput.trim()) payload.hindsight_api_key = hindsightKeyInput.trim();
      
      const res = await axios.post(`${BACKEND_URL}/api/config`, payload);
      setBackendConfig(res.data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      alert("Failed to update config: " + (err.response?.data?.detail || err.message));
    }
  };

  const quickPrompts = [
    "I'm feeling really stressed about our upcoming demo deadline.",
    "Can you remember that I prefer clear bullet points in our summaries?",
    "We just resolved all the errors and the project looks awesome!",
    "Do you remember what my main concern was earlier?"
  ];

  const filteredTurns = conversationTurns.filter(turn => 
    turn.prompt.toLowerCase().includes(tableSearch.toLowerCase()) ||
    turn.bulletPoints.some(bp => bp.toLowerCase().includes(tableSearch.toLowerCase()))
  );

  const filteredConversations = conversations.filter(c =>
    (c.title || '').toLowerCase().includes(historySearch.toLowerCase()) ||
    (c.latestThemes || []).some(t => t.toLowerCase().includes(historySearch.toLowerCase()))
  );

  const currentConvTitle = conversations.find(c => c.id === currentConversationId)?.title || 'Current Conversation';

  return (
    <div className="min-h-screen bg-slate-100 p-3 md:p-4 font-sans text-gray-800 flex flex-col">
      {/* Header */}
      <header className="mb-3.5 text-center max-w-[1700px] mx-auto w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
          <div className="text-left flex items-center gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-indigo-700 flex items-center gap-2">
                <span>🧠 Emotionally Aware Memory Agent</span>
              </h1>
              <p className="text-xs md:text-sm text-gray-500">
                Active Sentiment Tracking • Psychological Needs Reasoning • Conversation History • Cognitive Memory
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* New Conversation Button */}
            <button
              onClick={startNewConversation}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Start a fresh conversation"
            >
              <span>➕ New Conversation</span>
            </button>

            {/* Past Conversations Button */}
            <button
              onClick={() => setShowHistoryDrawer(!showHistoryDrawer)}
              className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>📂 Past Conversations</span>
              <span className="px-1.5 py-0.2 bg-indigo-200 text-indigo-800 rounded-full text-[10px]">
                {conversations.length}
              </span>
            </button>

            {/* Active Engine Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-full border border-gray-200 shadow-xs text-xs font-medium">
              <span className={`w-2.5 h-2.5 rounded-full ${backendConfig.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
              <span className="text-gray-700 font-semibold">{backendConfig.active_engine}</span>
            </div>

            {/* Reflect Button */}
            <button
              onClick={handleReflect}
              disabled={reflecting}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <span>{reflecting ? 'Reflecting...' : '✨ Reflect On Memories'}</span>
            </button>

            {/* Config Button */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              ⚙️ Settings
            </button>
          </div>
        </div>
      </header>

      {/* Past Conversations Drawer / Modal */}
      {showHistoryDrawer && (
        <div className="max-w-[1700px] mx-auto w-full mb-3 bg-white p-4 rounded-xl border border-indigo-200 shadow-lg relative animate-fade-in text-left">
          <div className="flex justify-between items-center mb-3 border-b pb-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">📂</span>
              <div>
                <h3 className="font-bold text-gray-900 text-sm">Past Conversations History</h3>
                <p className="text-xs text-gray-500">
                  Select any previous session to restore its messages, detected emotions, and turn breakdown.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={startNewConversation}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer"
              >
                + New Conversation
              </button>
              <button 
                onClick={() => setShowHistoryDrawer(false)}
                className="text-gray-400 hover:text-gray-700 text-base font-bold px-2 py-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>

          {conversations.length > 2 && (
            <div className="mb-3">
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search past conversations by title or theme..."
                className="w-full text-xs p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}

          {conversations.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-xs">
              No saved conversations yet. Chat with the agent, and your sessions will appear here automatically!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[300px] overflow-y-auto pr-1">
              {filteredConversations.map((conv) => {
                const isActive = conv.id === currentConversationId;
                const dateStr = conv.updatedAt ? new Date(conv.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                return (
                  <div
                    key={conv.id}
                    onClick={() => loadConversation(conv)}
                    className={`p-3 rounded-lg border text-xs cursor-pointer transition-all flex flex-col justify-between ${
                      isActive 
                        ? 'bg-indigo-50 border-indigo-400 ring-2 ring-indigo-200' 
                        : 'bg-slate-50 hover:bg-white border-gray-200 hover:border-indigo-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <span className="font-semibold text-gray-800 line-clamp-1">
                          {conv.title || 'Untitled Conversation'}
                        </span>
                        {isActive && (
                          <span className="px-1.5 py-0.2 bg-indigo-600 text-white text-[9px] rounded font-medium">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 mb-2">
                        {dateStr} • {conv.conversationTurns?.length || 0} turns ({conv.messages?.length || 0} msgs)
                      </div>
                      {/* Emotion preview */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        {(conv.latestEmotions || []).slice(0, 2).map((em, idx) => (
                          <span key={idx} className="px-1.5 py-0.2 bg-rose-50 text-rose-600 border border-rose-100 rounded text-[9px]">
                            {em}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t border-gray-200/60 mt-1">
                      <span className="text-[10px] text-indigo-600 font-medium">
                        {isActive ? 'Current session' : 'Click to load →'}
                      </span>
                      <button
                        onClick={(e) => deleteConversation(e, conv.id)}
                        className="text-gray-400 hover:text-rose-600 text-[11px] p-0.5"
                        title="Delete conversation"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="max-w-[1700px] mx-auto w-full mb-3 bg-white p-4 md:p-5 rounded-xl border border-gray-300 shadow-lg relative animate-fade-in text-left">
          <div className="flex justify-between items-center mb-3 border-b pb-2">
            <div>
              <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                <span>⚙️ AI Engine & Memory Configuration</span>
              </h3>
              <p className="text-xs text-gray-500">
                Configure your preferred LLM and Hindsight Cloud keys, or leave blank to use the built-in interactive demo engine.
              </p>
            </div>
            <button 
              onClick={() => setShowSettings(false)}
              className="text-gray-400 hover:text-gray-700 text-base font-bold px-2 py-1 cursor-pointer"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSaveConfig} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Groq API Key (Fast OSS Inference)
              </label>
              <input
                type="password"
                placeholder={backendConfig.has_groq ? "•••••••••••• (Configured)" : "Enter gsk_..."}
                value={groqKeyInput}
                onChange={(e) => setGroqKeyInput(e.target.value)}
                className="w-full text-xs p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Google Gemini API Key
              </label>
              <input
                type="password"
                placeholder={backendConfig.has_gemini ? "•••••••••••• (Configured)" : "Enter AIzaSy..."}
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                className="w-full text-xs p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Hindsight Cloud API Key
              </label>
              <input
                type="password"
                placeholder={backendConfig.has_hindsight ? "•••••••••••• (Configured)" : "Enter Hindsight Key..."}
                value={hindsightKeyInput}
                onChange={(e) => setHindsightKeyInput(e.target.value)}
                className="w-full text-xs p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="md:col-span-3 flex items-center justify-between pt-2 border-t mt-1">
              <span className="text-xs text-emerald-600 font-medium">
                {saveSuccess ? "✓ Configuration updated successfully!" : ""}
              </span>
              <button
                type="submit"
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors cursor-pointer"
              >
                Save & Apply Keys
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reflection Banner / Modal */}
      {reflection && (
        <div className="max-w-[1700px] mx-auto w-full mb-3 bg-indigo-950 text-indigo-100 p-4 rounded-xl border border-indigo-700 shadow-lg relative animate-fade-in">
          <div className="flex justify-between items-start gap-4">
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-2">
                <span>🌟 Hindsight Overarching Synthesis</span>
              </h4>
              <p className="mt-1 text-sm leading-relaxed text-slate-200">{reflection}</p>
            </div>
            <button 
              onClick={() => setReflection(null)}
              className="text-indigo-400 hover:text-white text-sm font-bold px-2 py-0.5 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main 3-Column Layout */}
      <div className="max-w-[1700px] mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
        
        {/* Column 1: Interactive Chat (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-xl shadow-md flex flex-col overflow-hidden border border-gray-200 h-[77vh]">
          <div className="bg-indigo-600 text-white p-3 font-semibold flex justify-between items-center shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-base">💬 Chat</span>
              <span className="text-[11px] bg-indigo-500/50 text-indigo-100 px-2 py-0.5 rounded-full font-normal max-w-[150px] truncate" title={currentConvTitle}>
                {currentConvTitle}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={startNewConversation}
                className="text-xs bg-emerald-500/80 hover:bg-emerald-500 text-white px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer font-normal"
                title="Start a new conversation"
              >
                <span>+ New</span>
              </button>
              <div className="flex items-center text-xs font-normal bg-indigo-700/60 px-2 py-1 rounded-md">
                <input 
                  id="memory-toggle" 
                  type="checkbox" 
                  checked={useMemory}
                  onChange={(e) => setUseMemory(e.target.checked)}
                  className="mr-1 accent-indigo-400 cursor-pointer"
                />
                <label htmlFor="memory-toggle" className="cursor-pointer select-none text-[11px]">
                  Memory Sync
                </label>
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50">
            {messages.length === 0 && (
              <div className="text-center py-8 px-3">
                <div className="w-11 h-11 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-2 text-xl">
                  👋
                </div>
                <h3 className="font-semibold text-gray-700 text-sm mb-1">New Conversation</h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto mb-3">
                  Ask a question or share your thoughts. Every question is recorded in the prompt table with conversation bullet points.
                </p>
                <div className="flex flex-col gap-1.5 max-w-md mx-auto">
                  {quickPrompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(prompt)}
                      className="text-left text-xs bg-white hover:bg-indigo-50 border border-gray-200 hover:border-indigo-300 text-gray-700 hover:text-indigo-700 py-1.5 px-3 rounded-lg shadow-2xs transition-all cursor-pointer"
                    >
                      "{prompt}"
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {messages.map((msg, idx) => (
              <div 
                key={idx} 
                id={`msg-${idx}`}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-2xs leading-relaxed ${
                  msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-tr-none' 
                    : 'bg-white text-gray-800 border border-gray-200 rounded-tl-none'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white text-gray-500 border border-gray-200 shadow-2xs rounded-2xl rounded-tl-none px-3.5 py-2 text-xs italic flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
                  Analyzing emotional cues and recalling memories...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleSend(input); }} className="p-2.5 bg-white border-t border-gray-200 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question or share how you're feeling..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={loading}
            />
            <button 
              type="submit" 
              disabled={loading || !input.trim()}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-xs md:text-sm font-medium transition-colors shadow-2xs cursor-pointer"
            >
              Send
            </button>
          </form>
        </div>

        {/* Column 2: Live Turn Metadata Dashboard (3 cols) */}
        <div className="lg:col-span-3 bg-slate-900 rounded-xl shadow-md flex flex-col overflow-hidden text-gray-100 border border-slate-800 h-[77vh]">
          <div className="bg-slate-950 p-3 font-semibold text-indigo-400 border-b border-slate-800 flex justify-between items-center">
            <span className="flex items-center gap-1.5 text-sm">
              <span>📊 Live Metadata</span>
            </span>
            <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-normal">
              Latest Turn
            </span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            
            {/* Emotions */}
            <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/80">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-1.5 font-bold flex items-center justify-between">
                <span>Detected Emotions</span>
                <span>❤️</span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {latestEmotions.length === 0 ? <span className="text-slate-500 text-xs italic">Waiting for input...</span> : null}
                {latestEmotions.map((em, i) => (
                  <span key={i} className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full text-xs font-medium">
                    {em}
                  </span>
                ))}
              </div>
            </div>

            {/* Needs */}
            <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/80">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-1.5 font-bold flex items-center justify-between">
                <span>Identified Needs</span>
                <span>🎯</span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {latestNeeds.length === 0 ? <span className="text-slate-500 text-xs italic">Waiting for input...</span> : null}
                {latestNeeds.map((need, i) => (
                  <span key={i} className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-xs font-medium">
                    {need}
                  </span>
                ))}
              </div>
            </div>

            {/* Themes */}
            <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/80">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-1.5 font-bold flex items-center justify-between">
                <span>Themes</span>
                <span>🧭</span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {latestThemes.length === 0 ? <span className="text-slate-500 text-xs italic">Waiting for input...</span> : null}
                {latestThemes.map((theme, i) => (
                  <span key={i} className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-xs font-medium">
                    {theme}
                  </span>
                ))}
              </div>
            </div>

            {/* Memory Operations Stream */}
            <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 flex-1 flex flex-col min-h-[190px]">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs uppercase tracking-wider text-slate-400 font-bold flex items-center gap-1.5">
                  <span>Memory Log</span>
                </h3>
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30">
                  Hindsight
                </span>
              </div>
              <div className="space-y-1.5 font-mono text-xs max-h-[200px] overflow-y-auto pr-1">
                {memoryOperations.length === 0 ? (
                  <div className="text-slate-500 italic text-xs py-3 text-center">No memory operations recorded yet...</div>
                ) : (
                  memoryOperations.map((op, i) => (
                    <div key={i} className="flex flex-col p-1.5 bg-slate-900 rounded border border-slate-800">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                          op.action === 'CREATE' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                          op.action === 'UPDATE' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                          'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}>
                          {op.action}
                        </span>
                      </div>
                      <span className="text-slate-300 break-words leading-relaxed text-[10px]">{op.data}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Column 3: Prompts & Conversation Breakdown Table (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-xl shadow-md flex flex-col overflow-hidden border border-gray-200 h-[77vh]">
          <div className="bg-slate-800 text-white p-3 font-semibold flex justify-between items-center shadow-sm">
            <span className="flex items-center gap-2">
              <span className="text-sm font-bold text-indigo-300">📋 Prompt & Conversation Log</span>
              <span className="text-xs bg-indigo-500/30 text-indigo-200 px-2 py-0.5 rounded-full font-mono">
                {conversationTurns.length} Prompts
              </span>
            </span>
            <span className="text-[11px] text-slate-400 font-normal hidden sm:inline">
              Click prompt to jump to chat
            </span>
          </div>

          {/* Search bar within table */}
          {conversationTurns.length > 2 && (
            <div className="p-2 border-b border-gray-200 bg-slate-50">
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Filter prompts or bullet points..."
                className="w-full text-xs p-1.5 px-2.5 border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Table Container */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50">
            {conversationTurns.length === 0 ? (
              <div className="text-center py-12 px-4 text-gray-400">
                <div className="text-3xl mb-2">📋</div>
                <h4 className="font-semibold text-gray-700 text-sm mb-1">No Prompts Logged Yet</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  As you converse with the agent in this session, each question you ask will create an entry in this table with a direct link and bullet points breaking down emotional signals, needs, and memory updates.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTurns.map((turn) => {
                  const isSelected = selectedTurnId === turn.turnNumber;
                  return (
                    <div 
                      key={turn.turnNumber}
                      className={`p-3 rounded-lg border transition-all shadow-2xs ${
                        isSelected 
                          ? 'bg-indigo-50/70 border-indigo-400 ring-2 ring-indigo-200' 
                          : 'bg-white border-gray-200 hover:border-indigo-300'
                      }`}
                    >
                      {/* Prompt Row Header & Clickable Link */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <button
                          onClick={() => scrollToPromptInChat(turn.messageIndex, turn.turnNumber)}
                          className="text-left font-semibold text-xs text-indigo-700 hover:text-indigo-900 flex items-center gap-1.5 group cursor-pointer"
                          title="Click to jump and highlight this message in the chat"
                        >
                          <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-mono group-hover:bg-indigo-200">
                            #{turn.turnNumber}
                          </span>
                          <span className="line-clamp-2 underline decoration-indigo-300 group-hover:decoration-indigo-600">
                            "{turn.prompt}"
                          </span>
                          <span className="text-[11px] opacity-60 group-hover:opacity-100 transition-opacity">
                            ↗
                          </span>
                        </button>
                        <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap">
                          {turn.timestamp}
                        </span>
                      </div>

                      {/* Key Badges */}
                      <div className="flex flex-wrap gap-1 mb-2.5">
                        {turn.emotions.slice(0, 2).map((em, i) => (
                          <span key={i} className="px-2 py-0.2 bg-rose-50 text-rose-600 border border-rose-200 rounded text-[10px] font-medium">
                            ❤️ {em}
                          </span>
                        ))}
                        {turn.needs.slice(0, 1).map((need, i) => (
                          <span key={i} className="px-2 py-0.2 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px] font-medium">
                            🎯 {need}
                          </span>
                        ))}
                      </div>

                      {/* Conversation Turn Bullet Points */}
                      <div className="bg-slate-50 rounded p-2 border border-slate-200 text-xs">
                        <div className="font-semibold text-gray-700 text-[11px] mb-1.5 flex items-center justify-between">
                          <span>Conversation Turn Breakdown:</span>
                          <span className="text-[10px] text-slate-400 font-normal">Active Turn Analysis</span>
                        </div>
                        <ul className="space-y-1 text-gray-600 text-[11px] list-disc list-inside">
                          {turn.bulletPoints.map((bp, bpIdx) => (
                            <li key={bpIdx} className="leading-snug">
                              <span className="text-gray-800">{bp}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
