import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex h-full w-full items-center justify-center bg-panel">
          <div className="flex flex-col items-center gap-3 max-w-sm text-center p-6">
            <AlertTriangle size={32} className="text-[#e5484d]" />
            <div className="text-sm font-semibold">Something went wrong</div>
            <div className="text-[11px] text-muted break-all">
              {this.state.error.message}
            </div>
            <button
              className="ww-btn"
              onClick={() => this.setState({ error: null })}
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
