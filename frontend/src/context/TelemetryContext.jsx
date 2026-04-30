import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const CHART_POINTS = 60;
const emptyArr = () => Array(CHART_POINTS).fill(0);

const STORAGE_KEY = 'sparrowx_telemetry_v2';
const LEGACY_STORAGE_KEY = 'sbs_telemetry_v2';

// -- Persist / restore helpers -------------------------------------------------
function saveToStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...data,
      savedAt: Date.now(),
    }));
  } catch {
    // Ignore localStorage write failures; telemetry can continue live.
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Only restore if saved within the last 10 minutes
    if (Date.now() - (parsed.savedAt || 0) > 10 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

const TelemetryContext = createContext(null);

export function useTelemetry() {
  return useContext(TelemetryContext);
}

export function TelemetryProvider({ token, children }) {
  // -- Restore persisted state on first render -------------------------------
  const saved = loadFromStorage();

  const [wsState,     setWsState]     = useState('connecting');
  const [agentStatus, setAgentStatus] = useState(saved?.agentStatus || 'unknown');
  const [lastEvent,   setLastEvent]   = useState(null);

  const [stats, setStats] = useState(saved?.stats ?? {
    connections: 0, bannedIPs: 0, sbsBanTotal: 642, cpuPercent: 0,
    memPercent: 0, synRate: 0, pps: 0, uptime: 0,
    inMbps: 0, outMbps: 0, udpConns: 0,
    avgPacketBytes: 0,
    packetDiff: 0, rxPacketDiff: 0, txPacketDiff: 0,
    rxPackets: 0, txPackets: 0, rxBytes: 0, txBytes: 0,
    telemetrySource: '', telemetryAgentBuild: '', agentBuild: '',
    hostname: '-', ip: '-', os: '-', iface: '-',
  });

  const [cpuHistory,  setCpuHistory]  = useState(saved?.cpuHistory  ?? { cpu: emptyArr(), mem: emptyArr() });
  const [netHistory,  setNetHistory]  = useState(saved?.netHistory  ?? { inb: emptyArr(), out: emptyArr() });
  const [connHistory, setConnHistory] = useState(saved?.connHistory ?? { tcp: emptyArr(), udp: emptyArr() });
  const [logs,        setLogs]        = useState(saved?.logs ?? []);
  const [trafficEvents, setTrafficEvents] = useState(saved?.trafficEvents ?? []);

  // -- Guard Stats (Global View) ---------------------------------------------
  const [guardStats, setGuardStats] = useState({
    connections: 0, bannedIPs: 0, sbsBanTotal: 642, cpuPercent: 0,
    memPercent: 0, synRate: 0, pps: 0, uptime: 0,
    inMbps: 0, outMbps: 0, udpConns: 0,
    avgPacketBytes: 0,
    packetDiff: 0, rxPacketDiff: 0, txPacketDiff: 0,
    rxPackets: 0, txPackets: 0, rxBytes: 0, txBytes: 0,
    telemetrySource: 'guard', telemetryAgentBuild: 'native', agentBuild: 'v1',
    hostname: 'Guard', ip: 'Guard', os: 'Linux', iface: '-',
  });
  const [guardCpuHistory,  setGuardCpuHistory]  = useState({ cpu: emptyArr(), mem: emptyArr() });
  const [guardNetHistory,  setGuardNetHistory]  = useState({ inb: emptyArr(), out: emptyArr() });
  const [guardConnHistory, setGuardConnHistory] = useState({ tcp: emptyArr(), udp: emptyArr() });
  const [guardLogs,        setGuardLogs]        = useState([]);
  const [guardTrafficEvents, setGuardTrafficEvents] = useState([]);

  const [lastUpdateMs, setLastUpdateMs] = useState(saved?.lastUpdateMs ?? null);
  const [lastGuardUpdateMs, setLastGuardUpdateMs] = useState(null);
  const [guardBlocklist, setGuardBlocklist] = useState({
    count: Number(saved?.stats?.bannedIPs || 0),
    totalBanned: Number(saved?.stats?.sbsBanTotal || 0),
    totalBannedUpdatedAt: null,
    table: '',
    updatedAt: null,
    ready: false,
    error: '',
  });

  const [notifications, setNotifications] = useState([]);
  const [viewMode, setViewMode] = useState(localStorage.getItem('sparrowx_view_mode') || 'global'); // 'global' or 'agent'

  useEffect(() => {
    try {
      localStorage.setItem('sparrowx_view_mode', viewMode);
    } catch (e) {
      // Ignore
    }
  }, [viewMode]);

  // -- Persist to localStorage whenever key state changes --------------------
  const statsRef      = useRef(stats);
  const cpuHistRef    = useRef(cpuHistory);
  const netHistRef    = useRef(netHistory);
  const connHistRef   = useRef(connHistory);
  const logsRef       = useRef(logs);
  const trafficEventsRef = useRef(trafficEvents);
  const guardBlocklistRef = useRef(guardBlocklist);
  const lastUpdateRef = useRef(lastUpdateMs);
  const agentStatRef  = useRef(agentStatus);

  // Keep refs up-to-date
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { cpuHistRef.current = cpuHistory; }, [cpuHistory]);
  useEffect(() => { netHistRef.current = netHistory; }, [netHistory]);
  useEffect(() => { connHistRef.current = connHistory; }, [connHistory]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => { trafficEventsRef.current = trafficEvents; }, [trafficEvents]);
  useEffect(() => { guardBlocklistRef.current = guardBlocklist; }, [guardBlocklist]);
  useEffect(() => { lastUpdateRef.current = lastUpdateMs; }, [lastUpdateMs]);
  useEffect(() => { agentStatRef.current = agentStatus; }, [agentStatus]);

  // Debounced save - write to localStorage at most once per second
  const saveTimerRef = useRef(null);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveToStorage({
        stats:        statsRef.current,
        cpuHistory:   cpuHistRef.current,
        netHistory:   netHistRef.current,
        connHistory:  connHistRef.current,
        logs:         logsRef.current.slice(0, 200),
        trafficEvents: trafficEventsRef.current.slice(0, 200),
        lastUpdateMs: lastUpdateRef.current,
        agentStatus:  agentStatRef.current,
      });
    }, 1000);
  }, []);

  // Save whenever any piece of state updates
  useEffect(() => { scheduleSave(); }, [stats, cpuHistory, netHistory, logs, trafficEvents, scheduleSave]);

  // -- WebSocket management -------------------------------------------------
  const wsRef       = useRef(null);
  const retryTimer  = useRef(null);
  const retryCount  = useRef(0);
  const unmounted   = useRef(false);
  const pendingCmds = useRef(new Map());
  const connectRef  = useRef(null);

  const refreshGuardBlocklistSummary = useCallback(async () => {
    if (!token) return null;

    try {
      const res = await fetch('/api/guard/blocklist/summary', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load guard block count.');

      const next = {
        count: Number(data.count || 0),
        totalBanned: Number(data.totalBanned || 0),
        totalBannedUpdatedAt: data.totalBannedUpdatedAt || null,
        table: data.table || '',
        updatedAt: data.updatedAt || null,
        ready: data.guardReady !== false,
        error: data.error || '',
      };

      if (!unmounted.current) {
        guardBlocklistRef.current = next;
        setGuardBlocklist(next);
        setStats(prev => ({ ...prev, bannedIPs: next.count, sbsBanTotal: Math.max(Number(next.totalBanned || 0), 642) }));
      }
      return next;
    } catch (err) {
      const message = err.message || 'Failed to load guard block count.';
      if (!unmounted.current) {
        setGuardBlocklist(prev => ({ ...prev, ready: false, error: message }));
      }
      return null;
    }
  }, [token]);

  const processStatsUpdate = useCallback((msg) => {
    setAgentStatus('CONNECTED');
    const s     = msg.stats  || {};
    const agent = msg.agent  || {};
    const guardCount = guardBlocklistRef.current?.ready ? guardBlocklistRef.current.count : null;
    setLastUpdateMs(Date.now());

    setStats(prev => ({
      ...prev,
      connections: s.connections  ?? prev.connections,
      bannedIPs:   guardCount     ?? s.bannedIPs    ?? prev.bannedIPs,
      sbsBanTotal: Math.max(Number(s.sbsBanTotal || 0), Number(prev.sbsBanTotal || 642)),
      cpuPercent:  s.cpuPercent   ?? prev.cpuPercent,
      memPercent:  s.memPercent   ?? prev.memPercent,
      synRate:     s.synRate      ?? prev.synRate,
      pps:         s.pps          ?? prev.pps,
      avgPacketBytes: s.avgPacketBytes ?? prev.avgPacketBytes,
      packetDiff: s.packetDiff ?? prev.packetDiff,
      rxPacketDiff: s.rxPacketDiff ?? prev.rxPacketDiff,
      txPacketDiff: s.txPacketDiff ?? prev.txPacketDiff,
      rxPackets: s.rxPackets ?? prev.rxPackets,
      txPackets: s.txPackets ?? prev.txPackets,
      rxBytes: s.rxBytes ?? prev.rxBytes,
      txBytes: s.txBytes ?? prev.txBytes,
      telemetrySource: s.telemetrySource || prev.telemetrySource,
      telemetryAgentBuild: s.telemetryAgentBuild || prev.telemetryAgentBuild,
      agentBuild: s.agentBuild || prev.agentBuild,
      uptime:      s.uptime       ?? prev.uptime,
      inMbps:      s.inMbps       ?? prev.inMbps,
      outMbps:     s.outMbps      ?? prev.outMbps,
      udpConns:    s.udpConns    ?? prev.udpConns,
      hostname:    agent.hostname || prev.hostname,
      ip:          agent.ip       || prev.ip,
      os:          agent.os       || prev.os,
      iface:       s.iface        || prev.iface,
    }));

    // Rolling chart history - always accumulate, even off-screen
    setCpuHistory(prev => ({
      cpu: [...prev.cpu.slice(1), Number((s.cpuPercent || 0).toFixed(1))],
      mem: [...prev.mem.slice(1), Number((s.memPercent || 0).toFixed(1))],
    }));

    setNetHistory(prev => ({
      inb: [...prev.inb.slice(1), Number((s.inMbps  || 0).toFixed(3))],
      out: [...prev.out.slice(1), Number((s.outMbps || 0).toFixed(3))],
    }));

    setConnHistory(prev => ({
      tcp: [...prev.tcp.slice(1), s.established ?? 0],
      udp: [...prev.udp.slice(1), s.udpConns    ?? 0],
    }));

    // Logs
    if (s.log && s.log.trim()) {
      const lines = s.log.split('\n').filter(l => l.trim()).map(l => {
        let level = 'default';
        if (/\[FW\].*ban|drop|block/i.test(l))            level = 'error';
        if (/\[FW\].*accept/i.test(l))                    level = 'success';
        if (/\[SSH\].*Failed|Invalid|error/i.test(l))     level = 'error';
        if (/\[SSH\].*Accepted/i.test(l))                 level = 'success';
        if (/\[SSH\].*Disconnected/i.test(l))             level = 'info';
        return { text: `[${new Date().toLocaleTimeString()}] ${l}`, level };
      });
      setLogs(prev => [...lines, ...prev].slice(0, 500));
    }

    const incomingFallbackBytes = Math.round(Number(s.inMbps || 0) * 1_000_000 / 8);
    const outgoingFallbackBytes = Math.round(Number(s.outMbps || 0) * 1_000_000 / 8);
    const fallbackEvents = [
      {
        timestamp: new Date().toISOString(),
        direction: 'incoming',
        protocol: 'IFACE',
        sourceLabel: 'network',
        destinationLabel: s.iface || 'agent',
        state: incomingFallbackBytes > 0 ? 'RX' : 'IDLE',
        packets: Number(s.pps || 0) > 0 ? Math.round(Number(s.pps || 0) / 2) : 0,
        sizeBytes: incomingFallbackBytes,
        avgPacketBytes: Number(s.avgPacketBytes || 0),
        rateMbps: Number(s.inMbps || 0),
        iface: s.iface || '-',
        severity: Number(s.inMbps || 0) >= 10 ? 'warning' : 'success',
        reason: incomingFallbackBytes > 0 ? 'incoming normal traffic' : 'incoming idle',
      },
      {
        timestamp: new Date().toISOString(),
        direction: 'outgoing',
        protocol: 'IFACE',
        sourceLabel: s.iface || 'agent',
        destinationLabel: 'network',
        state: outgoingFallbackBytes > 0 ? 'TX' : 'IDLE',
        packets: Number(s.pps || 0) > 0 ? Math.floor(Number(s.pps || 0) / 2) : 0,
        sizeBytes: outgoingFallbackBytes,
        avgPacketBytes: Number(s.avgPacketBytes || 0),
        rateMbps: Number(s.outMbps || 0),
        iface: s.iface || '-',
        severity: Number(s.outMbps || 0) >= 10 ? 'warning' : 'success',
        reason: outgoingFallbackBytes > 0 ? 'outgoing normal traffic' : 'outgoing idle',
      },
    ];

    const hasCounterDelta = Number(s.packetDiff || 0) > 0 || incomingFallbackBytes > 0 || outgoingFallbackBytes > 0;
    const trafficPayload = Array.isArray(s.trafficEvents) && s.trafficEvents.length > 0
      ? s.trafficEvents
      : (hasCounterDelta ? fallbackEvents : []);

    if (trafficPayload.length > 0) {
      const normalized = trafficPayload.map((event, index) => ({
        id: [
          event.timestamp || Date.now(),
          event.protocol || 'IP',
          event.direction || 'flow',
          event.localIp || '-',
          event.localPort || '-',
          event.remoteIp || '-',
          event.remotePort || '-',
          index,
        ].join(':'),
        timestamp: event.timestamp || new Date().toISOString(),
        direction: event.direction || 'flow',
        protocol: event.protocol || 'IP',
        localIp: event.localIp || '-',
        localPort: event.localPort ?? '-',
        remoteIp: event.remoteIp || '-',
        remotePort: event.remotePort ?? '-',
        sourceLabel: event.sourceLabel || '',
        destinationLabel: event.destinationLabel || '',
        state: event.state || '-',
        recvQ: Number(event.recvQ || 0),
        sendQ: Number(event.sendQ || 0),
        packets: event.packets === null || event.packets === undefined ? null : Number(event.packets || 0),
        sizeBytes: Number(event.sizeBytes || 0),
        avgPacketBytes: Number(event.avgPacketBytes || 0),
        rateMbps: Number(event.rateMbps || 0),
        iface: event.iface || s.iface || '-',
        severity: event.severity || 'success',
        reason: event.reason || 'normal flow',
      }));
      const visible = normalized.filter((event) => {
        if (String(event.protocol || '').toUpperCase() !== 'IFACE') return true;
        return Number(event.packets || 0) > 0 || Number(event.sizeBytes || 0) > 0 || Number(event.rateMbps || 0) > 0;
      });
      if (visible.length > 0) {
        setTrafficEvents(prev => [...visible, ...prev].slice(0, 240));
      }
    }
  }, []);

  const processGuardStatsUpdate = useCallback((msg) => {
    const s = msg.stats || {};
    setLastGuardUpdateMs(Date.now());

    setGuardStats(prev => ({
      ...prev,
      ...s,
      connections: s.connections ?? prev.connections,
      bannedIPs: s.bannedIPs ?? prev.bannedIPs,
      sbsBanTotal: s.sbsBanTotal ?? prev.sbsBanTotal,
      cpuPercent: s.cpuPercent ?? prev.cpuPercent,
      memPercent: s.memPercent ?? prev.memPercent,
      inMbps: s.inMbps ?? prev.inMbps,
      outMbps: s.outMbps ?? prev.outMbps,
      pps: s.pps ?? prev.pps,
      uptime: s.uptime ?? prev.uptime,
      hostname: s.hostname || prev.hostname,
      ip: s.ip || prev.ip,
      os: s.os || prev.os,
      iface: s.iface || prev.iface,
    }));

    setGuardCpuHistory(prev => ({
      cpu: [...prev.cpu.slice(1), Number((s.cpuPercent || 0).toFixed(1))],
      mem: [...prev.mem.slice(1), Number((s.memPercent || 0).toFixed(1))],
    }));

    setGuardNetHistory(prev => ({
      inb: [...prev.inb.slice(1), Number((s.inMbps || 0).toFixed(3))],
      out: [...prev.out.slice(1), Number((s.outMbps || 0).toFixed(3))],
    }));

    setGuardConnHistory(prev => ({
      tcp: [...prev.tcp.slice(1), s.connections || 0],
      udp: [...prev.udp.slice(1), 0],
    }));
  }, []);

  const connect = useCallback(() => {
    if (!token || unmounted.current) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;
    setWsState('connecting');

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      retryCount.current = 0;
      setWsState('open');
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      setLastEvent(msg);

      if (msg.type === 'agent_connected') {
        setAgentStatus('CONNECTED');
        setStats(prev => ({
          ...prev,
          hostname: msg.hostname || prev.hostname,
          ip:       msg.ip       || prev.ip,
          os:       msg.os       || prev.os,
        }));
        setLastUpdateMs(Date.now());
      }

      if (msg.type === 'agent_disconnected') {
        setAgentStatus('NO AGENT');
        setStats(prev => ({ ...prev, hostname: '-', ip: '-', os: '-' }));
        setLastUpdateMs(null);
      }

      if (msg.type === 'stats_update') {
        processStatsUpdate(msg);
      }

      if (msg.type === 'guard_stats_update') {
        processGuardStatsUpdate(msg);
      }

      if (msg.type === 'guard_blocklist_changed') {
        const nextCount = Number(msg.count || 0);
        const next = {
          count: nextCount,
          totalBanned: Number(msg.totalBanned ?? statsRef.current.sbsBanTotal ?? 0),
          totalBannedUpdatedAt: msg.totalBannedUpdatedAt || null,
          table: msg.table || '',
          updatedAt: msg.updatedAt || new Date().toISOString(),
          ready: true,
          error: '',
        };
        guardBlocklistRef.current = next;
        setGuardBlocklist(next);
        setStats(prev => ({ ...prev, bannedIPs: nextCount, sbsBanTotal: next.totalBanned }));
      }

      if (msg.type === 'radar_ban' || msg.type === 'radar_mode_changed') {
        refreshGuardBlocklistSummary();
        
        if (msg.type === 'radar_ban') {
          setNotifications(prev => [{
            id: Date.now() + Math.random(),
            type: 'danger',
            title: 'Threat Neutralized',
            message: `IP ${msg.ip} was automatically banned by Threat Radar. Reason: ${msg.reason || 'Suspicious activity'}`,
            timestamp: new Date().toISOString(),
          }, ...prev].slice(0, 10));
        } else if (msg.type === 'radar_mode_changed') {
          setNotifications(prev => [{
            id: Date.now() + Math.random(),
            type: 'warning',
            title: 'Defense Mode Changed',
            message: `System security level switched to ${msg.mode.toUpperCase()} mode by admin.`,
            timestamp: new Date().toISOString(),
          }, ...prev].slice(0, 10));
        }
      }

      if (msg.type === 'command_result') {
        const pending = pendingCmds.current.get(msg.cmdId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          pending.resolve(msg);
          pendingCmds.current.delete(msg.cmdId);
        }
      }
    };

    ws.onerror = () => {
      if (!unmounted.current) setWsState('error');
    };

    ws.onclose = () => {
      if (unmounted.current) return;
      setWsState('reconnecting');
      pendingCmds.current.forEach(({ reject, timeoutId }) => {
        clearTimeout(timeoutId);
        reject(new Error('Connection lost - reconnecting...'));
      });
      pendingCmds.current.clear();
      const delay = Math.min(1000 * Math.pow(2, retryCount.current), 10000);
      retryCount.current += 1;
      retryTimer.current = setTimeout(() => connectRef.current?.(), delay);
    };
  }, [token, processStatsUpdate, refreshGuardBlocklistSummary]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    unmounted.current = false;
    const initial = setTimeout(refreshGuardBlocklistSummary, 0);
    const id = setInterval(refreshGuardBlocklistSummary, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [token, refreshGuardBlocklistSummary]);

  useEffect(() => {
    unmounted.current = false;
    if (token) connect();

    // Bootstrap: fetch last known stats from the server immediately so
    // the dashboard is never blank on refresh (before the next WS push)
    if (token) {
      fetch('/api/agent/last-stats', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(d => {
          if (d.available && !unmounted.current) {
            processStatsUpdate({ stats: d.stats, agent: d.agent });
          }
        })
        .catch(() => {});
    }

    return () => {
      unmounted.current = true;
      clearTimeout(retryTimer.current);
      clearTimeout(saveTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      pendingCmds.current.forEach(({ reject, timeoutId }) => {
        clearTimeout(timeoutId);
        reject(new Error('Provider unmounted.'));
      });
      pendingCmds.current.clear();
    };
  }, [connect, token, processStatsUpdate]);

  // -- sendCommand - shared by Terminal, Firewall, Blocklist -----------------
  const sendCommand = useCallback(async (cmd, { timeoutMs = 45000 } = {}) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error('Connection not ready - waiting for the secure channel to open.');
    }

    const res = await fetch('/api/command', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ cmd })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to queue command.');

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingCmds.current.delete(data.cmdId);
        reject(new Error('Agent did not respond within the timeout window.'));
      }, timeoutMs);
      pendingCmds.current.set(data.cmdId, { resolve, reject, timeoutId });
    });
  }, [token]);

  const value = {
    wsState,
    agentStatus: viewMode === 'global' ? 'CONNECTED' : agentStatus,
    lastEvent,
    stats: viewMode === 'global' ? guardStats : stats,
    cpuHistory: viewMode === 'global' ? guardCpuHistory : cpuHistory,
    netHistory: viewMode === 'global' ? guardNetHistory : netHistory,
    connHistory: viewMode === 'global' ? guardConnHistory : connHistory,
    logs: viewMode === 'global' ? guardLogs : logs,
    trafficEvents: viewMode === 'global' ? guardTrafficEvents : trafficEvents,
    guardBlocklist,
    lastUpdateMs: viewMode === 'global' ? lastGuardUpdateMs : lastUpdateMs,
    sendCommand,
    refreshGuardBlocklistSummary,
    notifications,
    setNotifications,
    viewMode,
    setViewMode,
    isConnected: viewMode === 'global' ? true : agentStatus === 'CONNECTED',
    commandReady: viewMode === 'global' ? false : (agentStatus === 'CONNECTED' && wsState === 'open'),
  };

  return (
    <TelemetryContext.Provider value={value}>
      {children}
    </TelemetryContext.Provider>
  );
}
