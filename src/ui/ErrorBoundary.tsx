import { Component, type ErrorInfo, type ReactNode } from 'react';

// If a screen fails to draw, say so and offer a way back, instead of leaving
// a blank page. Nothing stored is lost: the data is in the browser's database.

interface Props {
  title: string;
  text: string;
  back: string;
  /** "Technical details" and "Reload the app". */
  details: string;
  reload: string;
  /** Changes when the user goes elsewhere, so the screen gets another try. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
  key: string;
  /** What failed and where, shown only on this screen (to screenshot when reporting it). */
  error?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey, error: undefined } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    // The app's own parts the error passed through (names of the screen's components, nothing the user entered).
    const where = (info.componentStack ?? '')
      .split('\n')
      .map((line) => /at (\w+)/.exec(line)?.[1])
      .filter((name): name is string => !!name && /^[A-Z]/.test(name))
      .slice(0, 6)
      .join(' ‹ ');
    const at = error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 4).join('\n') : '';
    this.setState({ error: [message, where && `in ${where}`, at !== message ? at : ''].filter(Boolean).join('\n') });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <h1>{this.props.title}</h1>
        <p>{this.props.text}</p>
        <div className="button-row">
          <a className="button button-primary" href="#/days">
            {this.props.back}
          </a>
          <button type="button" className="button" onClick={() => location.reload()}>
            {this.props.reload}
          </button>
        </div>
        {this.state.error && (
          <details open>
            <summary className="small">{this.props.details}</summary>
            <pre className="small error-details">{this.state.error}</pre>
          </details>
        )}
      </main>
    );
  }
}
