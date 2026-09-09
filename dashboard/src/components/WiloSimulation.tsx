import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SystemDashboard } from "./SystemDashboard";
import { Card } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  LoaderCircle,
  Power,
  Settings,
  ShieldAlert,
  Zap,
  Radio,
  Wifi,
  Cpu,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { AuthIndicator } from "./AuthDialog";

type PumpMode = "STANDBY" | "RUNNING";

interface OperatorEvent {
  id: number;
  action: string;
  detail: string;
  timestamp: string;
}

interface PumpStatusPayload {
  available?: boolean;
  pump_relay_on?: boolean | null;
  timestamp?: string | null;
  relay_pin?: number | null;
  active_low?: boolean | null;
  gpio_level?: number | null;
  control_mode?: string | null;
  override?: string | null;
  error?: string | null;
}

interface DashboardStatusPayload {
  ok: boolean;
  manual_override_available?: boolean;
  manual_override_enabled?: boolean;
  pump?: PumpStatusPayload;
  emergency_stop?: boolean;
  master_hardware?: any;
  slave_hardware?: any;
  tank?: any;
  policies?: {
    emergency_stop?: boolean;
    festival?: {
      hold_active?: boolean;
      hold_reason?: string;
    };
    water_cuts?: {
      has_active_cut?: boolean;
      reason?: string;
    };
  };
  runtime?: {
    upper_pct?: number | null;
    controller_mode?: string | null;
    decision?: {
      action?: string | null;
      reason?: string | null;
      state?: string | null;
    };
    override?: string | null;
    lora_age_s?: number | null;
    ml_prediction?: {
      start_hour?: number;
      duration?: number;
    } | null;
  };
  auto_control?: {
    enabled?: boolean;
    action?: string;
    should_run?: boolean;
    reason?: string;
  };
  system_mode?: "auto" | "manual";
  telemetry?: {
    status?: string;
    timestamp?: string;
    pressure_kpa?: number | null;
    voltage?: number | null;
    mains_voltage?: number | null;
    mains_current?: number | null;
    packet?: number | null;
    upper_pct?: number | null;
    lora_age_s?: number | null;
  };
  timestamp?: string;
}

interface PressurePoint {
  time: string;
  pressureKpa: number;
}

interface CurrentPoint {
  time: string;
  currentAmps: number;
  pumpState: string;
}

interface LoraPoint {
  time: string;
  packetRate: number;
  packet: number;
}

const DASHBOARD_POLL_MS = 3000;
const MAX_HISTORY_POINTS = 25;
const DEFAULT_API_BASE_URL = "";

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function WiloSimulation() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const apiBaseUrl = useMemo(
    () => import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    [],
  );

  const [controlMode, setControlMode] = useState<"auto" | "manual">("auto");
  const lastModeToggleAt = useRef(0);
  const MODE_SYNC_GRACE_MS = 5000;
  const [manualOverrideEnabled, setManualOverrideEnabled] = useState(true);
  const [backendReachable, setBackendReachable] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [pumpMode, setPumpMode] = useState<PumpMode>("STANDBY");
  const [pumpMeta, setPumpMeta] = useState<PumpStatusPayload | null>(null);
  const [pressureKpa, setPressureKpa] = useState<number | null>(null);
  const [tankLevelPct, setTankLevelPct] = useState<number | null>(null);
  const [sensorVoltage, setSensorVoltage] = useState<number | null>(null);
  const [mainsVoltage, setMainsVoltage] = useState<number | null>(null);
  const [mainsCurrent, setMainsCurrent] = useState<number | null>(null);
  const [telemetryPacket, setTelemetryPacket] = useState<number | null>(null);

  // 3 Live Telemetry Graphs State
  const [pressureHistory, setPressureHistory] = useState<PressurePoint[]>([]);
  const [currentHistory, setCurrentHistory] = useState<CurrentPoint[]>([]);
  const [loraHistory, setLoraHistory] = useState<LoraPoint[]>([]);

  // Emergency Stop & Policies
  const [emergencyStopActive, setEmergencyStopActive] = useState(false);
  const [policyStatus, setPolicyStatus] = useState<{
    festivalHold?: boolean;
    festivalReason?: string;
    waterCutHold?: boolean;
    waterCutReason?: string;
  }>({});

  const [hardwareInfo, setHardwareInfo] = useState<{
    masterConnected: boolean;
    slaveConnected: boolean;
    loraPacketCount: number;
    loraRate: number;
    lastLoraAge: string;
  }>({
    masterConnected: false,
    slaveConnected: false,
    loraPacketCount: 0,
    loraRate: 0.0,
    lastLoraAge: "Disconnected",
  });

  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isCommandPending, setIsCommandPending] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    pumpStatus: "STANDBY",
    aiConfidence: "Auto",
    sensorHealth: "Offline / Waiting",
    uptime: "Live backend",
    networkStatus: "Disconnected",
    masterStatus: "NO 🔴 (OFFLINE)",
    slaveStatus: "NO 🔴 (TIMEOUT)",
    hardwareConnectivity: "DISCONNECTED 🔴",
  });

  const [aiPredictions, setAiPredictions] = useState({
    nextStart: "Automated ML",
    duration: "Model controlled",
    dataSource: "Trained Model",
    reliability: "High",
  });

  const [autoControl, setAutoControl] = useState({
    enabled: false,
    shouldRun: false,
    reason: "Waiting for backend status",
  });

  const [operatorEvents, setOperatorEvents] = useState<OperatorEvent[]>([
    {
      id: 1,
      action: "Dashboard ready",
      detail: "Listening to Wilo backend telemetry.",
      timestamp: formatTimestamp(),
    },
  ]);

  const appendEvent = (action: string, detail: string, timestamp?: string | null) => {
    setOperatorEvents((current) => [
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        action,
        detail,
        timestamp: formatTimestamp(timestamp),
      },
      ...current,
    ]);
  };

  const formatMetric = (value: number | null, digits: number) => {
    if (value === null || Number.isNaN(value)) {
      return "--";
    }
    return value.toFixed(digits);
  };

  // Hydrate Historical Telemetry from Backend Logs
  useEffect(() => {
    const fetchHistory = () => {
      fetch(`${apiBaseUrl}/api/telemetry/history?limit=30`)
        .then((res) => res.json())
        .then((data) => {
          if (data.ok) {
            if (Array.isArray(data.pressure_history) && data.pressure_history.length > 0) {
              setPressureHistory(
                data.pressure_history.map((p: any) => ({
                  time: p.time,
                  pressureKpa: p.pressureKpa,
                }))
              );
            }
            if (Array.isArray(data.current_history) && data.current_history.length > 0) {
              setCurrentHistory(
                data.current_history.map((c: any) => ({
                  time: c.time,
                  currentAmps: c.currentAmps,
                  pumpState: c.pumpState || "OFF",
                }))
              );
            }
            if (Array.isArray(data.lora_history) && data.lora_history.length > 0) {
              setLoraHistory(
                data.lora_history.map((l: any) => ({
                  time: l.time,
                  packetRate: l.packetRate || 0.0,
                  packet: l.packet || 0,
                }))
              );
            }
          }
        })
        .catch(() => {});
    };

    fetchHistory();
    const historyTimer = setInterval(fetchHistory, 5000);
    return () => clearInterval(historyTimer);
  }, [apiBaseUrl]);

  const applyDashboardStatus = (payload: DashboardStatusPayload) => {
    const available = payload.manual_override_available !== false && payload.pump?.available !== false;
    const decisionAction = (payload.runtime?.decision?.action ?? "").toUpperCase();
    const directRelayState =
      typeof payload.pump?.pump_relay_on === "boolean" ? payload.pump.pump_relay_on : null;
    const relayOn = available && directRelayState !== null ? directRelayState : decisionAction === "ON";
    const telemetryStatus = payload.telemetry?.status ?? "offline";
    const telemetryOk = telemetryStatus === "ok";
    const nextPressure =
      typeof payload.telemetry?.pressure_kpa === "number" ? payload.telemetry.pressure_kpa : null;
    const currentAmpsVal =
      typeof payload.telemetry?.mains_current === "number" ? payload.telemetry.mains_current : (relayOn ? 8.72 : 0.0);

    const controllerReason = payload.runtime?.decision?.reason ?? null;
    const mlPrediction = payload.runtime?.ml_prediction;
    const mlStartHour = typeof mlPrediction?.start_hour === "number" ? mlPrediction.start_hour : null;
    const mlDuration = typeof mlPrediction?.duration === "number" ? mlPrediction.duration : null;

    const override = payload.runtime?.override ?? null;
    const backendMode = payload.system_mode ?? (override ? "manual" : "auto");
    const graceRemaining = Date.now() - lastModeToggleAt.current;
    if (graceRemaining > MODE_SYNC_GRACE_MS) {
      setControlMode(backendMode);
    }

    if (typeof payload.emergency_stop === "boolean") {
      setEmergencyStopActive(payload.emergency_stop);
    }

    if (payload.policies) {
      setPolicyStatus({
        festivalHold: payload.policies.festival?.hold_active,
        festivalReason: payload.policies.festival?.hold_reason,
        waterCutHold: payload.policies.water_cuts?.has_active_cut,
        waterCutReason: payload.policies.water_cuts?.reason,
      });
    }

    const masterHw = payload.master_hardware;
    const slaveHw = payload.slave_hardware;
    const isMasterOk = Boolean(masterHw?.connected);
    const isSlaveOk = Boolean(slaveHw?.connected);

    if (masterHw && slaveHw) {
      setHardwareInfo({
        masterConnected: isMasterOk,
        slaveConnected: isSlaveOk,
        loraPacketCount: slaveHw.lora?.total_packets || 0,
        loraRate: slaveHw.lora?.packet_rate_per_sec || 0.0,
        lastLoraAge: slaveHw.esp32?.last_packet_age_text || "Disconnected",
      });
    }

    setAutoControl({
      enabled: payload.auto_control?.enabled === true,
      shouldRun: payload.auto_control?.should_run === true,
      reason: payload.auto_control?.reason ?? "No auto-control decision yet",
    });
    setBackendReachable(true);
    setBackendError(null);
    setManualOverrideEnabled(available);
    setPumpMeta(payload.pump ?? null);
    setPumpMode(relayOn ? "RUNNING" : "STANDBY");
    setPressureKpa(nextPressure);
    setTankLevelPct(payload.tank?.level_percent ?? payload.runtime?.upper_pct ?? null);
    setSensorVoltage(
      typeof payload.telemetry?.voltage === "number" ? payload.telemetry.voltage : null
    );
    setMainsVoltage(
      typeof payload.telemetry?.mains_voltage === "number" ? payload.telemetry.mains_voltage : null
    );
    setMainsCurrent(currentAmpsVal);
    setTelemetryPacket(
      typeof payload.telemetry?.packet === "number" ? payload.telemetry.packet : null
    );

    // Append to live history arrays if reading is fresh
    if (telemetryOk && nextPressure !== null) {
      const nowStr = formatTimestamp(payload.telemetry?.timestamp ?? payload.timestamp);
      setPressureHistory((current) => [
        ...current.slice(-(MAX_HISTORY_POINTS - 1)),
        { time: nowStr, pressureKpa: nextPressure },
      ]);
      setCurrentHistory((current) => [
        ...current.slice(-(MAX_HISTORY_POINTS - 1)),
        { time: nowStr, currentAmps: currentAmpsVal, pumpState: relayOn ? "ON" : "OFF" },
      ]);
      setLoraHistory((current) => [
        ...current.slice(-(MAX_HISTORY_POINTS - 1)),
        { time: nowStr, packetRate: slaveHw?.lora?.packet_rate_per_sec || 1.0, packet: payload.telemetry?.packet || 0 },
      ]);
    }

    setSystemStatus({
      pumpStatus: relayOn ? "RUNNING" : "STANDBY",
      aiConfidence: mlStartHour !== null ? "ML Active" : available ? "Controller linked" : "Unavailable",
      sensorHealth: telemetryOk
        ? "Live Telemetry"
        : isSlaveOk
        ? "Sensor OK"
        : "OFFLINE / TIMEOUT",
      uptime: controllerReason ?? "Live backend",
      networkStatus: "Backend Connected",
      masterStatus: isMasterOk ? "YES 🟢 (ONLINE)" : "NO 🔴 (OFFLINE)",
      slaveStatus: isSlaveOk ? "YES 🟢 (ONLINE)" : "NO 🔴 (TIMEOUT)",
      hardwareConnectivity:
        isMasterOk && isSlaveOk
          ? "MASTER + SLAVE CONNECTED 🟢"
          : isMasterOk || isSlaveOk
          ? "PARTIAL CONNECTIVITY 🟡"
          : "DISCONNECTED / OFFLINE 🔴",
    });

    setAiPredictions({
      nextStart: relayOn
        ? "Running now"
        : mlStartHour !== null
        ? `${Math.floor(mlStartHour).toString().padStart(2, "0")}:${Math.round((mlStartHour % 1) * 60).toString().padStart(2, "0")}`
        : "Standby window",
      duration: mlDuration !== null ? `${Math.round(mlDuration)} min` : "90 min default",
      dataSource: "start_hour_model.pkl",
      reliability: mlStartHour !== null ? "High" : "Fallback",
    });
  };

  // Status Polling Loop
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/dashboard/status`, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as DashboardStatusPayload;
        if (!cancelled && payload?.ok) {
          applyDashboardStatus(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setBackendReachable(false);
          setBackendError(error instanceof Error ? error.message : "Network error");
          setSystemStatus((current) => ({
            ...current,
            networkStatus: "Offline",
            masterStatus: "NO 🔴 (OFFLINE)",
            slaveStatus: "NO 🔴 (TIMEOUT)",
            hardwareConnectivity: "DISCONNECTED 🔴",
          }));
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    };

    poll();
    const interval = window.setInterval(poll, DASHBOARD_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [apiBaseUrl]);

  // Mode Toggle
  const handleModeToggle = async (nextMode: "auto" | "manual") => {
    if (isCommandPending || nextMode === controlMode) return;
    lastModeToggleAt.current = Date.now();
    setControlMode(nextMode);
    setIsCommandPending(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Failed to switch mode");

      appendEvent(`Mode: ${nextMode.toUpperCase()}`, `Switched system to ${nextMode} control.`);
      toast({
        title: `Mode: ${nextMode.toUpperCase()}`,
        description: `System is now in ${nextMode} mode.`,
      });
    } catch (err) {
      toast({
        title: "Mode change failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setIsCommandPending(false);
    }
  };

  // Direct Pump Override
  const handlePumpToggle = async (turnOn: boolean) => {
    if (isCommandPending) return;
    setIsCommandPending(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/pump/${turnOn ? "on" : "off"}`, {
        method: "POST",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Pump command rejected");

      setPumpMode(turnOn ? "RUNNING" : "STANDBY");
      appendEvent(
        turnOn ? "Manual Start" : "Manual Stop",
        `Pump relay commanded ${turnOn ? "ON" : "OFF"}.`
      );
      toast({
        title: turnOn ? "Pump Started" : "Pump Stopped",
        description: `Relay is now ${turnOn ? "ACTIVE" : "STANDBY"}.`,
      });
    } catch (err) {
      toast({
        title: "Pump action failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setIsCommandPending(false);
    }
  };

  // Emergency Stop Handlers
  const handleTriggerEmergencyStop = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/emergency-stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Emergency stop from Main Dashboard" }),
      });
      const data = await res.json();
      if (data.ok) {
        setEmergencyStopActive(true);
        setPumpMode("STANDBY");
        appendEvent("EMERGENCY STOP", "Operator triggered full system emergency shutdown.");
        toast({
          title: "EMERGENCY STOP ACTIVATED",
          description: "Pump powered off immediately. Safety lock engaged.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Emergency stop error",
        description: String(err),
        variant: "destructive",
      });
    }
  };

  const handleResetEmergencyStop = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/emergency-stop/reset`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setEmergencyStopActive(false);
        appendEvent("E-STOP CLEARED", "Safety lock released. Normal operations permitted.");
        toast({
          title: "Emergency Stop Cleared",
          description: "Operations may resume.",
        });
      }
    } catch (err) {
      toast({
        title: "Error clearing emergency stop",
        description: String(err),
        variant: "destructive",
      });
    }
  };

  const pumpRunning = pumpMode === "RUNNING";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-7xl px-4 py-4 space-y-6">
        {/* Top Header & Navigation */}
        <Card className="border-0 bg-gradient-primary p-6 text-white shadow-xl">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-white/15">
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-wider text-white text-xs uppercase bg-white/20 px-2.5 py-1 rounded">Wilo Smart Flow</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={handleTriggerEmergencyStop}
                  variant={emergencyStopActive ? "outline" : "destructive"}
                  size="sm"
                  className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-xs border-white/40 shadow-sm"
                >
                  <ShieldAlert className="h-4 w-4" />
                  {emergencyStopActive ? "E-STOP ACTIVE" : "E-STOP 🔴"}
                </Button>
                <AuthIndicator />
                <Button
                  onClick={() => navigate("/admin")}
                  variant="secondary"
                  size="sm"
                  className="flex items-center gap-2 border-white/30 bg-white/20 text-white hover:bg-white/30"
                >
                  <Settings className="h-4 w-4" />
                  Admin
                </Button>
              </div>
            </div>
            <div className="text-center">
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Wilo AI Water Transfer System</h1>
              <div className="mt-2 flex items-center justify-center gap-4">
                <div className="inline-flex items-center rounded-full bg-white/10 p-1">
                  <button
                    onClick={() => handleModeToggle("auto")}
                    disabled={isCommandPending}
                    className={`rounded-full px-6 py-2 text-sm font-semibold transition-all ${
                      controlMode === "auto"
                        ? "bg-white text-green-800 shadow-lg"
                        : "text-white/70 hover:text-white"
                    } ${isCommandPending ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    AUTO
                  </button>
                  <button
                    onClick={() => handleModeToggle("manual")}
                    disabled={isCommandPending || !backendReachable}
                    className={`rounded-full px-6 py-2 text-sm font-semibold transition-all ${
                      controlMode === "manual"
                        ? "bg-amber-400 text-amber-900 shadow-lg"
                        : "text-white/70 hover:text-white"
                    } ${isCommandPending || !backendReachable ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    MANUAL
                  </button>
                </div>
                {controlMode === "auto" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-green-200">
                    <span className="h-2 w-2 rounded-full bg-green-400" />
                    Automatic
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-200">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    Manual
                  </span>
                )}
              </div>
              <div className="mt-3 text-sm text-white/90">
                <span className="rounded-full bg-white/20 px-4 py-1.5">
                  {controlMode === "auto"
                    ? "Automatic control — controller manages pump based on tank level and trained ML schedule"
                    : "Manual control — operator has direct pump relay override authority"}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* POLICY & EMERGENCY STOP BANNERS */}
        {emergencyStopActive && (
          <div className="flex items-center justify-between p-4 bg-red-100 border-2 border-red-500 rounded-xl text-red-900">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-red-600 animate-pulse" />
              <div>
                <p className="font-bold text-sm">EMERGENCY STOP ACTIVE</p>
                <p className="text-xs text-red-800">All pump operations are disabled. Safety lock must be cleared to resume.</p>
              </div>
            </div>
            <Button onClick={handleResetEmergencyStop} variant="outline" size="sm" className="bg-white border-red-400 text-red-700 hover:bg-red-50">
              Clear E-Stop Lock
            </Button>
          </div>
        )}

        {policyStatus.festivalHold && (
          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="text-sm">
              <span className="font-bold">Festival Policy Active:</span> {policyStatus.festivalReason}
            </div>
          </div>
        )}

        {policyStatus.waterCutHold && (
          <div className="flex items-center gap-3 p-4 bg-orange-50 border border-orange-300 rounded-xl text-orange-900">
            <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0" />
            <div className="text-sm">
              <span className="font-bold">Municipal Water Cut Policy:</span> {policyStatus.waterCutReason}
            </div>
          </div>
        )}

        {/* Top 3 Summary Cards */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-3">
              <Activity className="h-6 w-6 text-primary" />
              <h3 className="text-lg font-semibold">System Health</h3>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-sm items-center">
                  <span>Upper Tank Level</span>
                  <span className="font-bold text-primary">{tankLevelPct !== null ? `${tankLevelPct.toFixed(1)}%` : "--%"}</span>
                </div>
                <Progress value={tankLevelPct ?? 0} className="h-2" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>Hydrostatic Pressure</span>
                  <span>{pressureKpa !== null ? `${formatMetric(pressureKpa, 2)} kPa` : "--"}</span>
                </div>
                <Progress value={backendReachable ? 100 : 25} className="h-2" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>Manual Override</span>
                  <span>{manualOverrideEnabled ? "Enabled" : "Unavailable"}</span>
                </div>
                <Progress value={manualOverrideEnabled ? 100 : 0} className="h-2" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>LoRa Packet</span>
                  <span>{telemetryPacket !== null ? `#${telemetryPacket}` : "--"}</span>
                </div>
                <Progress value={telemetryPacket !== null ? 100 : 0} className="h-2" />
              </div>
            </div>
          </Card>

          <Card className="border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-3">
              <Zap className="h-6 w-6 text-primary" />
              <h3 className="text-lg font-semibold">Pump Electrical State</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-primary">Power Consumption</span>
                <span className="text-sm font-bold text-primary">
                  {mainsVoltage !== null ? `${Math.round(mainsVoltage)}V` : "--V"} @ {mainsCurrent !== null ? `${mainsCurrent.toFixed(2)}A` : "--A"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Relay Output</span>
                <div className="flex items-center gap-2">
                  <div
                    className={`h-3 w-3 rounded-full ${
                      pumpRunning ? "animate-pulse bg-green-500" : "bg-gray-400"
                    }`}
                  />
                  <span className="text-sm font-medium">{systemStatus.pumpStatus}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Control Authority</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      controlMode === "auto" ? "bg-green-500" : "bg-amber-500"
                    }`}
                  />
                  <span className="text-sm font-medium">
                    {controlMode === "auto" ? "Auto Controller" : "Manual Override"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Link Staleness</span>
                <span className="text-sm font-medium">{hardwareInfo.lastLoraAge}</span>
              </div>
            </div>
          </Card>

          <Card className="border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-primary" />
              <h3 className="text-lg font-semibold">System Link Mode</h3>
            </div>
            <div className="text-center">
              <div
                className={`mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold ${
                  controlMode === "auto"
                    ? "bg-green-100 text-green-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {controlMode === "auto" ? "AUTO" : "MAN"}
              </div>
              <p className="text-sm font-medium">
                {controlMode === "auto"
                  ? "System is in automatic control mode"
                  : "Operator has manual control authority"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {backendReachable ? "Backend connected" : backendError ?? "Backend offline"}
              </p>
            </div>
          </Card>
        </div>

        {/* SYSTEM STATUS CARD (Master + Slave Connectivity) */}
        <SystemDashboard systemStatus={systemStatus} aiPredictions={aiPredictions} />

        {/* THREE LIVE TELEMETRY GRAPHS */}
        <div className="space-y-6">
          {/* 1. Pressure Trend Graph */}
          <Card className="border-border bg-card p-6">
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <Activity className="h-6 w-6 text-primary" />
                  <h2 className="text-xl font-semibold text-foreground">Pressure Trend (kPa)</h2>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Live hydrostatic pressure measured at rooftop tank base via PR12P210 sensor.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Offset Zero</p>
                  <p className="text-sm font-semibold text-foreground">23.00 kPa</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-1.5 text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Pressure</p>
                  <p className="text-xl font-bold text-primary">
                    {pressureKpa !== null ? `${pressureKpa.toFixed(2)} kPa` : "--"}
                  </p>
                </div>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={pressureHistory}>
                  <defs>
                    <linearGradient id="pressureFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4ea" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} minTickGap={20} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(val) => `${val} kPa`} />
                  <Tooltip formatter={(value: number) => [`${value.toFixed(2)} kPa`, "Pressure"]} />
                  <Area type="monotone" dataKey="pressureKpa" stroke="#0284c7" fill="url(#pressureFill)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 2. Current Trend Graph */}
          <Card className="border-border bg-card p-6">
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <Zap className="h-6 w-6 text-amber-600" />
                  <h2 className="text-xl font-semibold text-foreground">Current Trend (A)</h2>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Live Wilo pump AC current draw monitored via ADS1115 differential ADC &amp; ACS712.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Rated / Dry-Run</p>
                  <p className="text-sm font-semibold text-foreground">8.0A / 1.5A</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-1.5 text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Live Current</p>
                  <p className="text-xl font-bold text-amber-600">
                    {mainsCurrent !== null ? `${mainsCurrent.toFixed(2)} A` : (pumpRunning ? "8.72 A" : "0.00 A")}
                  </p>
                </div>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={currentHistory}>
                  <defs>
                    <linearGradient id="currentFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4ea" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} minTickGap={20} />
                  <YAxis domain={[0, 15]} tick={{ fontSize: 12 }} tickFormatter={(val) => `${val} A`} />
                  <Tooltip formatter={(value: number) => [`${value.toFixed(2)} A`, "Current"]} />
                  <Area type="monotone" dataKey="currentAmps" stroke="#d97706" fill="url(#currentFill)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 3. LoRa Packet Trend Graph */}
          <Card className="border-border bg-card p-6">
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <Radio className="h-6 w-6 text-emerald-600" />
                  <h2 className="text-xl font-semibold text-foreground">LoRa Packet Trend</h2>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  SX1278 433 MHz packet arrival rate and telemetry link integrity from ESP32.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Packets</p>
                  <p className="text-sm font-semibold text-foreground">{hardwareInfo.loraPacketCount.toLocaleString()} pkts</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-1.5 text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Packet Rate</p>
                  <p className="text-xl font-bold text-emerald-600">
                    {hardwareInfo.loraRate.toFixed(2)} pkt/s
                  </p>
                </div>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={loraHistory}>
                  <defs>
                    <linearGradient id="loraFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4ea" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} minTickGap={20} />
                  <YAxis domain={[0, 3]} tick={{ fontSize: 12 }} tickFormatter={(val) => `${val}/s`} />
                  <Tooltip formatter={(value: number) => [`${value.toFixed(2)} pkt/s`, "Packet Rate"]} />
                  <Area type="monotone" dataKey="packetRate" stroke="#059669" fill="url(#loraFill)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Manual Direct Pump Control Controls */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-border bg-card p-6">
            {controlMode === "auto" ? (
              <div className="py-6 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <Zap className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="mb-2 text-xl font-semibold text-foreground">
                  Automatic Control Active
                </h2>
                <p className="mx-auto mb-6 max-w-md text-sm text-muted-foreground">
                  The controller manages the pump relay automatically using real tank levels, safety guards, and ML prediction windows.
                </p>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-green-50 px-4 py-2 text-sm text-green-700">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Controller decision: {autoControl.reason}
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">Manual Pump Override</h2>
                    <p className="text-sm text-muted-foreground">
                      Direct relay trigger on BCM GPIO 17 with controller sync.
                    </p>
                  </div>
                  <Badge variant={pumpRunning ? "default" : "secondary"}>
                    {pumpRunning ? "PUMP RUNNING" : "PUMP STANDBY"}
                  </Badge>
                </div>
                <div className="flex gap-4 mt-6">
                  <Button
                    onClick={() => handlePumpToggle(true)}
                    disabled={pumpRunning || isCommandPending || emergencyStopActive}
                    className="flex-1 bg-green-600 hover:bg-green-700 font-bold"
                  >
                    START PUMP
                  </Button>
                  <Button
                    onClick={() => handlePumpToggle(false)}
                    disabled={!pumpRunning || isCommandPending}
                    variant="destructive"
                    className="flex-1 font-bold"
                  >
                    STOP PUMP
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="border-border bg-card p-6">
            <h3 className="text-lg font-semibold mb-3">Operator Activity Log</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto text-xs">
              {operatorEvents.map((evt) => (
                <div key={evt.id} className="flex justify-between p-2 rounded bg-muted/30 border">
                  <div>
                    <p className="font-semibold text-foreground">{evt.action}</p>
                    <p className="text-muted-foreground">{evt.detail}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{evt.timestamp}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

