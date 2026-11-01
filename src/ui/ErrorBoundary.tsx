import { Component, type ReactNode } from 'react';

// If a screen fails to draw, say so and offer a way back, instead of leaving
// a blank page. Nothing stored is lost: the data is in the browser's database.

interface Props {
  title: string;
  text: string;
  back: string;
  /** Changes when the user goes elsewhere, so the screen gets another try. */
  resetKey: string;
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <h1>{this.props.title}</h1>
        <p>{this.props.text}</p>
        <a className="button button-primary" href="#/days">
          {this.props.back}
        </a>
      </main>
    );
  }
}
