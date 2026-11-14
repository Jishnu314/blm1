import { Component } from "react";

// Without this, any mistake while a page is drawing leaves a blank white screen and
// no clue. With it, the person sees a sentence, a reload button, and the actual error
// text, which they can read out or screenshot.

export default class ErrorCatcher extends Component {
  state = { problem: null };

  static getDerivedStateFromError(problem) {
    return { problem };
  }

  componentDidCatch(problem, info) {
    console.error("The page crashed:", problem, info?.componentStack);
  }

  render() {
    const { problem } = this.state;
    if (!problem) return this.props.children;
    const said = String(problem?.message || problem);
    return (
      <div style={{ maxWidth: 440, margin: "12vh auto", padding: "0 20px", font: "16px/1.5 system-ui, sans-serif", color: "#101215" }}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Something went wrong on this page</h1>
        <p style={{ margin: "0 0 16px", color: "#555" }}>
          Your data is safe. Reload to try again. If it keeps happening, send the line below to whoever looks after this app.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: "10px 18px", font: "inherit", border: "1px solid #101215", background: "#101215", color: "#fff", borderRadius: 8, cursor: "pointer" }}
        >
          Reload
        </button>
        <pre style={{ marginTop: 20, padding: 12, background: "#f2f4f6", borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 }}>
          {said}
        </pre>
      </div>
    );
  }
}
