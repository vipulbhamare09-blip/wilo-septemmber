import { Card } from "@/components/ui/card";
import { StatusCard } from "./StatusCard";
import { Activity, Cpu, Wifi, Zap, Clock, Target, Radio } from "lucide-react";

interface SystemDashboardProps {
  systemStatus: {
    pumpStatus: string;
    aiConfidence: string;
    sensorHealth: string;
    uptime: string;
    networkStatus: string;
    masterStatus?: string;
    slaveStatus?: string;
    hardwareConnectivity?: string;
    hardwareDetails?: string;
  };
  aiPredictions: {
    nextStart: string;
    duration: string;
    dataSource: string;
    reliability: string;
  };
}

export function SystemDashboard({ systemStatus, aiPredictions }: SystemDashboardProps) {
  const getSensorVariant = (health?: string) => {
    if (!health) return "error";
    if (health.includes("Live") || health.includes("Active") || health.includes("OK")) return "success";
    if (health.includes("waiting") || health.includes("Waiting")) return "warning";
    return "error";
  };

  const getReliabilityVariant = (reliability?: string) => {
    if (!reliability) return "error";
    if (reliability === "High") return "success";
    if (reliability === "Medium") return "warning";
    return "error";
  };

  const isMasterOnline = Boolean(systemStatus.masterStatus && (systemStatus.masterStatus.includes("ONLINE") || systemStatus.masterStatus.includes("YES")));
  const isSlaveOnline = Boolean(systemStatus.slaveStatus && (systemStatus.slaveStatus.includes("ONLINE") || systemStatus.slaveStatus.includes("YES")));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <Card className="p-6 bg-card border-border">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">System Status & Hardware</h2>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
            isMasterOnline && isSlaveOnline
              ? "bg-green-100 text-green-700"
              : isMasterOnline || isSlaveOnline
              ? "bg-amber-100 text-amber-700"
              : "bg-red-100 text-red-700"
          }`}>
            {systemStatus.hardwareConnectivity || "DISCONNECTED 🔴"}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatusCard
            title="Pump Status"
            value={systemStatus.pumpStatus}
            variant={systemStatus.pumpStatus === "RUNNING" ? "success" : "default"}
            icon={<Zap className="h-4 w-4" />}
          />
          <StatusCard
            title="Master Motor (Pi)"
            value={systemStatus.masterStatus || "NO 🔴 (OFFLINE)"}
            variant={isMasterOnline ? "success" : "error"}
            icon={<Cpu className="h-4 w-4" />}
          />
          <StatusCard
            title="Slave Motor (ESP32)"
            value={systemStatus.slaveStatus || "NO 🔴 (TIMEOUT)"}
            variant={isSlaveOnline ? "success" : "error"}
            icon={<Radio className="h-4 w-4" />}
          />
          <StatusCard
            title="AI Confidence"
            value={systemStatus.aiConfidence}
            icon={<Target className="h-4 w-4" />}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatusCard
            title="Sensor Telemetry"
            value={systemStatus.sensorHealth}
            variant={getSensorVariant(systemStatus.sensorHealth)}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatusCard
            title="System Environment"
            value={systemStatus.uptime}
            icon={<Clock className="h-4 w-4" />}
          />
        </div>
      </Card>

      <Card className="p-6 bg-card border-border">
        <div className="flex items-center gap-3 mb-6">
          <Target className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold text-foreground">AI Predictions</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatusCard
            title="Next Start"
            value={aiPredictions.nextStart}
            icon={<Clock className="h-4 w-4" />}
          />
          <StatusCard
            title="Duration"
            value={aiPredictions.duration}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatusCard
            title="Data Source"
            value={aiPredictions.dataSource}
            icon={<Cpu className="h-4 w-4" />}
          />
          <StatusCard
            title="Reliability"
            value={aiPredictions.reliability}
            variant={getReliabilityVariant(aiPredictions.reliability)}
            icon={<Target className="h-4 w-4" />}
          />
        </div>
      </Card>
    </div>
  );
}
