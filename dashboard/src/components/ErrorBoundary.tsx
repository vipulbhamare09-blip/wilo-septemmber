import React, { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
          <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-xl p-6 shadow-2xl space-y-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center text-red-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">System Interface Alert</h1>
            <p className="text-sm text-slate-400">
              The dashboard encountered an unexpected rendering error:
            </p>
            <div className="text-xs font-mono bg-slate-950 p-3 rounded border border-slate-800 text-red-300 text-left overflow-auto max-h-32">
              {this.state.error?.message || "Unknown error"}
            </div>
            <div className="pt-2 flex justify-center gap-3">
              <Button
                onClick={() => window.location.reload()}
                className="bg-cyan-600 hover:bg-cyan-700 text-white flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Reload Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
