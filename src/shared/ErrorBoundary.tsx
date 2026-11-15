import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /** What this boundary wraps, for the message ("the harness editor"). */
  label?: string
  /** Changing this value clears a caught error (e.g. a new project id). */
  resetKey?: unknown
}

interface State {
  error: Error | null
  resetKey: unknown
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the stack for bug reports (visible in DevTools / the terminal).
    console.error(`[WireWeaver] ${this.props.label ?? 'view'} crashed:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback
    return (
      <div role="alert" className="flex h-full w-full items-center justify-center bg-panel">
        <div className="flex max-w-md flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle size={32} className="text-danger" />
          <div className="text-sm font-semibold">
            Something went wrong in {this.props.label ?? 'this view'}.
          </div>
          <div className="text-xs text-muted">
            Your project is unchanged. Try again; if it keeps happening, save your work and restart
            WireWeaver.
          </div>
          <details className="w-full text-left text-[11px] text-muted">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all">{error.message}</pre>
          </details>
          <button className="ww-btn" onClick={() => this.setState({ error: null })}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      </div>
    )
  }
}
