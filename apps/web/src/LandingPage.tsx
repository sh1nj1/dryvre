import { useEffect } from "react";
import "./landing.css";

const workflow = [
  {
    number: "01",
    eyebrow: "Turn context into a contract",
    title: "An agent writes work where the thinking already lives.",
    body: "The PM Agent reads the launch brief and creates an editable task with an outcome, constraints, and verification steps in the same tree.",
    status: "Draft",
  },
  {
    number: "02",
    eyebrow: "Approve the boundary",
    title: "A human decides when execution begins.",
    body: "Moving the block to To do is an explicit approval. The task appears on the board without being copied into a separate tracker.",
    status: "To do",
  },
  {
    number: "03",
    eyebrow: "Ask instead of guessing",
    title: "Missing decisions return to your Inbox.",
    body: "The Developer Agent checks the completion contract first. If an approval is missing, the same task becomes Blocked and asks one focused question.",
    status: "Blocked",
  },
  {
    number: "04",
    eyebrow: "Finish with evidence",
    title: "Answers resume the loop all the way to Done.",
    body: "The agent executes, verifies the result, and records evidence as child blocks. Only verified work reaches Done.",
    status: "Done",
  },
];

function Brand() {
  return (
    <a className="landing-brand" href="#top" aria-label="Dryvre home">
      <span className="landing-brand-mark">D</span>
      <span>dryvre</span>
    </a>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function ProductPreview() {
  return (
    <div className="product-preview" aria-label="Dryvre product preview">
      <div className="preview-bar">
        <div className="preview-brand">
          <span>D</span>
          <strong>dryvre</strong>
        </div>
        <div className="preview-path">
          Product Studio&nbsp; / &nbsp;<strong>Launch Dryvre</strong>
        </div>
        <div className="preview-avatar">SO</div>
      </div>
      <div className="preview-body">
        <aside className="preview-tree">
          <span className="preview-label">Tree</span>
          <div className="preview-node">
            <i>⌄</i>
            <span>◈</span> Product Studio
          </div>
          <div className="preview-node selected">
            <i>⌄</i>
            <span>◫</span> Launch Dryvre
          </div>
          <div className="preview-node nested">
            <i /> <span>¶</span> Product thesis
          </div>
          <div className="preview-node nested">
            <i>⌄</i>
            <span>◎</span> Core experience
          </div>
          <div className="preview-node deep">
            <i /> <span>□</span> Three views, one tree
          </div>
          <div className="preview-node nested">
            <i /> <span>☑</span> Launch checklist
          </div>
        </aside>
        <div className="preview-document">
          <div className="preview-tabs">
            <span className="active">▤ Document</span>
            <span>▦ Board</span>
            <span>◉ Stream</span>
          </div>
          <article>
            <span className="preview-kicker">PRODUCT THESIS</span>
            <h3>Everything is a block.</h3>
            <p>
              Context, work, conversation, and AI output live together from the
              start.
            </p>
            <div className="preview-block">
              <span className="preview-check" />
              <div>
                <strong>Ship the public launch</strong>
                <small>One task, viewed as a document or board card.</small>
              </div>
              <em>IN PROGRESS</em>
            </div>
            <div className="preview-child">
              <span>↳</span>
              <strong>Verification</strong>
              <small>Deployment check passed · evidence attached</small>
            </div>
          </article>
        </div>
        <aside className="preview-context">
          <span className="preview-label">Block context</span>
          <div className="context-card">
            <small>SELECTED BLOCK</small>
            <strong>Ship the public launch</strong>
            <p>Everything the agent needs, auto-built from the tree.</p>
          </div>
          <span className="preview-label">AGENT LOOP</span>
          <div className="loop-step">
            <i className="done" /> Contract checked
          </div>
          <div className="loop-step">
            <i className="done" /> Approval received
          </div>
          <div className="loop-step">
            <i className="active" /> Verifying result
          </div>
        </aside>
      </div>
      <div className="preview-agent-toast">
        <span>✦</span>
        <div>
          <strong>Developer Agent</strong>
          <small>Result verified. Moving the same block to Done.</small>
        </div>
        <em>NOW</em>
      </div>
    </div>
  );
}

export default function LandingPage() {
  useEffect(() => {
    document.body.classList.add("landing-body");
    document.title = "Dryvre — Humans set intent. Agents close the loop.";
    return () => document.body.classList.remove("landing-body");
  }, []);

  return (
    <div className="landing-page" id="top">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="landing-nav">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#why">Why Dryvre</a>
          <a href="#workflow">How it works</a>
          <a href="#demo">Demo</a>
        </nav>
        <a className="nav-cta" href="/app">
          Start building <Arrow />
        </a>
      </header>

      <main id="main-content">
        <section className="landing-hero">
          <div className="hero-copy">
            <p className="hero-eyebrow">
              <span>✦</span> Loop engineering for people + agents
            </p>
            <h1>
              One tree.
              <br />
              <em>Every way</em> of working.
            </h1>
            <p className="hero-lede">
              Dryvre brings documents, tasks, conversations, and AI output into
              one living block tree—so people set intent and agents can finish
              the work.
            </p>
            <div className="hero-actions">
              <a className="primary-cta" href="/app">
                Start building <Arrow />
              </a>
              <a className="secondary-cta" href="#demo">
                <span className="play-icon">▶</span> Watch the story
              </a>
            </div>
            <p className="hero-note">
              <span /> Same blocks. Three views. No syncing.
            </p>
          </div>
          <ProductPreview />
        </section>

        <div className="claim-strip" aria-label="Dryvre views">
          <p>Write it once.</p>
          <div>
            <span>▤</span>
            <strong>Document</strong>
            <small>for context</small>
          </div>
          <i>→</i>
          <div>
            <span>▦</span>
            <strong>Board</strong>
            <small>for execution</small>
          </div>
          <i>→</i>
          <div>
            <span>◉</span>
            <strong>Stream</strong>
            <small>for decisions</small>
          </div>
        </div>

        <section className="problem-section section-shell" id="why">
          <div className="section-heading">
            <p className="section-eyebrow">The context-switching tax</p>
            <h2>
              Your tools split the loop.
              <br />
              Then you spend the day reconnecting it.
            </h2>
            <p>
              A spec becomes a ticket. The ticket creates a chat thread. The
              answer disappears from the document. Every handoff loses context.
            </p>
          </div>
          <div className="problem-grid">
            <article>
              <span className="problem-icon coral">▤</span>
              <p className="card-index">01 / DOCS</p>
              <h3>Knowledge goes stale.</h3>
              <p>
                Plans hold the why, but execution moves elsewhere. Results
                rarely make it back.
              </p>
            </article>
            <article>
              <span className="problem-icon violet">▦</span>
              <p className="card-index">02 / TRACKERS</p>
              <h3>Work loses its meaning.</h3>
              <p>
                Tasks preserve status, not the living context and decisions that
                make them executable.
              </p>
            </article>
            <article>
              <span className="problem-icon lime">◉</span>
              <p className="card-index">03 / CHAT</p>
              <h3>Decisions vanish.</h3>
              <p>
                Approvals and answers scroll away, while people and agents keep
                asking the same questions.
              </p>
            </article>
          </div>
        </section>

        <section className="tree-section">
          <div className="tree-copy">
            <p className="section-eyebrow light">One source of truth</p>
            <h2>
              The document is the plan.
              <br />
              The plan is the work.
            </h2>
            <p>
              Every heading, task, message, reference, and agent result is a
              first-class Markdown block. Change the view, not the data.
            </p>
            <ul>
              <li>
                <span>01</span>
                <div>
                  <strong>Markdown-first</strong>
                  <small>Readable by people, structured for agents.</small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Context by structure</strong>
                  <small>Subtrees and references define what AI reads.</small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Results write back</strong>
                  <small>
                    AI output stays editable, linked, and accountable.
                  </small>
                </div>
              </li>
            </ul>
          </div>
          <div
            className="tree-diagram"
            aria-label="A block tree connecting context, work, questions, and evidence"
          >
            <div className="diagram-root">
              <span>D</span>
              <div>
                <small>ROOT BLOCK</small>
                <strong>Launch Dryvre</strong>
              </div>
            </div>
            <div className="diagram-branches">
              <article>
                <i>¶</i>
                <small>CONTEXT</small>
                <strong>Product brief</strong>
                <em>Document</em>
              </article>
              <article>
                <i>□</i>
                <small>WORK</small>
                <strong>Public launch</strong>
                <em className="violet-text">To do</em>
              </article>
              <article>
                <i>◉</i>
                <small>QUESTION</small>
                <strong>Approval needed</strong>
                <em className="coral-text">Inbox</em>
              </article>
              <article>
                <i>✓</i>
                <small>EVIDENCE</small>
                <strong>Checks passed</strong>
                <em className="green-text">Done</em>
              </article>
            </div>
            <p>One identity across every view and state.</p>
          </div>
        </section>

        <section className="workflow-section section-shell" id="workflow">
          <div className="section-heading workflow-heading">
            <div>
              <p className="section-eyebrow">The human-agent loop</p>
              <h2>
                Agents do not guess
                <br />
                past a blocker.
              </h2>
            </div>
            <p>
              Dryvre makes the approval boundary visible. Agents inspect the
              contract, ask when intent is missing, resume with your answer, and
              finish with evidence.
            </p>
          </div>
          <div className="workflow-list">
            {workflow.map((step, index) => (
              <article key={step.number}>
                <div className="workflow-number">{step.number}</div>
                <div className="workflow-copy">
                  <p>{step.eyebrow}</p>
                  <h3>{step.title}</h3>
                  <span>{step.body}</span>
                </div>
                <div className={`workflow-status status-${index}`}>
                  <i />
                  {step.status}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="demo-section" id="demo">
          <div className="demo-heading">
            <div>
              <p className="section-eyebrow light">See the loop</p>
              <h2>
                From shared context
                <br />
                to verified work.
              </h2>
            </div>
            <p>
              A short walkthrough of the same blocks moving through Document,
              Board, and Stream—without conversion or copy-paste.
            </p>
          </div>
          <div className="video-frame">
            <div className="video-chrome">
              <span>
                <i />
                <i />
                <i />
              </span>
              <strong>Dryvre product walkthrough</strong>
              <em>00:58</em>
            </div>
            <video
              controls
              preload="metadata"
              poster="/dryvre-demo-poster.webp"
            >
              <source src="/dryvre-demo.mp4" type="video/mp4" />
              <track
                kind="captions"
                src="/dryvre-demo.vtt"
                srcLang="en"
                label="English"
              />
              Your browser does not support the video element.
            </video>
          </div>
        </section>

        <section className="final-cta">
          <div className="cta-orbit one" />
          <div className="cta-orbit two" />
          <p className="section-eyebrow">Close the loop</p>
          <h2>
            Humans set intent.
            <br />
            <em>Agents finish the work.</em>
          </h2>
          <a className="primary-cta light-cta" href="/app">
            Start building with Dryvre <Arrow />
          </a>
        </section>
      </main>

      <footer className="landing-footer">
        <Brand />
        <p>One tree for context, work, conversation, and AI output.</p>
        <a
          href="https://github.com/sh1nj1/dryvre"
          target="_blank"
          rel="noreferrer"
        >
          GitHub <Arrow />
        </a>
      </footer>
    </div>
  );
}
