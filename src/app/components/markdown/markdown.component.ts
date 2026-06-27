import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
  inject,
} from '@angular/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Reusable markdown renderer with XSS sanitization and optional
 * Mermaid diagram support. Use anywhere a Honcho response (chat
 * reply, representation body, conclusion content, search hit
 * snippet) is rendered as text.
 *
 * <h2>Why a custom component instead of ngx-markdown</h2>
 * ngx-markdown pulls in a stack of @angular/* dependencies and a
 * markdown-it config that's overkill for our needs. We render
 * GitHub-flavored markdown (the {@code marked} default) directly,
 * sanitize the HTML with DOMPurify, and run any {@code ```mermaid
 * ... ```} blocks through {@code mermaid} on the client. Less code
 * to load, less coupling, easier to audit for XSS surface.
 *
 * <h2>Why DOMPurify (XSS) is mandatory</h2>
 * Honcho's response body is user-controlled — a peer could write
 * {@code <script>alert(1)</script>} as their "memory" and the
 * dashboard would execute it on the next page load. The markdown
 * parser only escapes HTML in the markdown source; the rendered
 * HTML still contains raw {@code <script>} tags. DOMPurify strips
 * those before we set {@code innerHTML}.
 *
 * <h2>Why mermaid runs after view init, not on every change</h2>
 * {@code mermaid.render} is async (returns a Promise). We collect
 * every {@code pre.mermaid} node, await all renders, and apply
 * the resulting SVG into the DOM in one pass. Re-rendering on
 * every {@code @Input} change would re-create the SVGs and lose
 * the user's zoom/pan state in the browser. We track the last
 * input string and only re-run mermaid if it actually changed.
 */
@Component({
  /*
    The styles below MUST reach the inner HTML that marked
    generates and DOMPurify sanitizes, which is injected via
    [innerHTML] on the .md-host div. Angular's default emulated
    view encapsulation rewrites every selector to require a
    [_ngcontent-xxx] attribute on the matched element, but
    innerHTML-injected children do NOT receive that attribute
    — only the template elements do. So the .md-host h2 /
    .md-host p / etc. selectors would never match.

    Setting encapsulation: None is the right call here because:
      1. The .md-host class is owned by this component's template,
         so it can never collide with another component's usage.
      2. The .md-host rules are namespaced by their CSS class
         prefix anyway, so they won't leak into the rest of
         the app.
      3. The original emulated setup was already silently broken
         — the h1/h2/h3/h4 rules and the table cell rules never
         matched innerHTML-injected children, so the styling
         was only working for the `.md-host` line-height and
         the `:is(h1, h2, h3, h4)` rule (which actually does
         not work either, for the same reason).
  */
  encapsulation: ViewEncapsulation.None,
  selector: 'app-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="md-host" [innerHTML]="safeHtml"></div>
  `,
  styles: [`
    /*
      Markdown rendering surface. The styles here apply inside
      the <div class="md-host"> that the component's template
      owns. Three things to know about the design:

      1. The retro CRT theme the dashboard ships uses the
         --accent, --surface, --text, and --text-dim CSS custom
         properties (orange/cyan/magenta accent, surface card
         background, foreground, and muted text). Every rule
         below leans on these so the markdown matches the
         surrounding chrome.

      2. List bullets use the same triangular glyph (▸) the
         dashboards sidebar and card list use, instead of the
         browsers default disc. The list-style: none +
         ::before trick is the only way to get a custom bullet
         character in modern CSS.

      3. Code blocks get a monospace font stack AND a distinct
         background so they read as code at a glance. The
         :not(pre) > code selector scopes the inline-code style
         to non-block code only; code inside a pre element
         gets the block style with no extra inline background.
    */
    :host { display: block; }
    .md-host { line-height: 1.55; }

    /* Headings: bold + a thin accent rule under H1/H2/H3 to give
       the retro CRT section-divider feel. */
    .md-host :is(h1, h2, h3, h4) { font-weight: 700; margin: 0.8em 0 0.4em; }
    .md-host h1 { font-size: 1.6em; padding-bottom: 0.2em; border-bottom: 2px solid var(--accent); }
    .md-host h2 { font-size: 1.35em; padding-bottom: 0.15em; border-bottom: 1px solid color-mix(in srgb, var(--accent) 60%, transparent); }
    .md-host h3 { font-size: 1.15em; }
    .md-host h4 { font-size: 1.0em; opacity: 0.85; }
    .md-host :is(h1, h2, h3, h4):first-child { margin-top: 0; }

    .md-host p  { margin: 0.5em 0; }
    .md-host :is(ul, ol) { margin: 0.5em 0; padding-left: 0; list-style: none; }
    .md-host li { margin: 0.25em 0; padding-left: 1.2em; position: relative; }
    .md-host li::before {
      content: '▸';
      position: absolute;
      left: 0;
      color: var(--accent);
      font-weight: 700;
    }
    /* Nested lists indent further and use a smaller glyph so the
       hierarchy is visible at a glance. */
    .md-host li :is(ul, ol) { margin: 0.2em 0 0.2em 0.4em; }
    .md-host li li::before { content: '·'; color: color-mix(in srgb, var(--accent) 70%, transparent); }
    .md-host li li li::before { content: '›'; color: var(--text-dim); }

    /* Inline code: only applies to <code> NOT inside a <pre>.
       Block code gets the dedicated styling below. */
    .md-host :not(pre) > code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.9em;
      background: color-mix(in srgb, currentColor 10%, transparent);
      padding: 1px 5px;
      border-radius: 3px;
      border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    }

    /* Block code (fenced): distinct surface, monospace, scrollable
       on overflow, no inline-code background bleed. */
    .md-host pre {
      background: color-mix(in srgb, currentColor 6%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
      padding: 0.7em 0.9em;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.88em;
      line-height: 1.45;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      margin: 0.6em 0;
    }
    .md-host pre code {
      background: transparent;
      padding: 0;
      border: none;
      font-family: inherit;
      font-size: inherit;
    }

    .md-host a {
      color: var(--accent, #4a9);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .md-host a:hover { text-decoration: none; }

    /* Tables: header gets a distinct surface + bold text, body
       rows get a subtle zebra stripe for scannability. */
    .md-host table {
      border-collapse: collapse;
      margin: 0.6em 0;
      width: 100%;
      font-size: 0.92em;
    }
    .md-host th, .md-host td {
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      padding: 6px 10px;
      text-align: left;
    }
    .md-host th {
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      font-weight: 700;
      color: var(--accent);
    }
    .md-host tbody tr:nth-child(even) td {
      background: color-mix(in srgb, currentColor 4%, transparent);
    }
    .md-host tbody tr:hover td {
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }

    .md-host blockquote {
      margin: 0.6em 0;
      padding: 0.3em 0.8em;
      border-left: 3px solid var(--accent);
      opacity: 0.85;
      font-style: italic;
      background: color-mix(in srgb, var(--accent) 5%, transparent);
    }
    .md-host :is(pre, table, blockquote) { max-width: 100%; }
    .md-host hr { border: none; border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent); margin: 1em 0; }
    .md-host .mermaid { text-align: center; margin: 0.8em 0; }
    .md-host .mermaid svg { max-width: 100%; height: auto; }

    /* Inside a chat bubble (or any dark-surface container), the
       inline-code background should be a touch lighter so it
       stands out from the surrounding card. The chat panel
       sets background: var(--surface) on the bubble, so
       currentColor there resolves to the surface tint. */
    .md-host :not(pre) > code {
      /* Stack a thin border + a fill so the pill reads as a
         distinct token even on the user-bubble accent
         background. */
      box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 18%, transparent);
    }
  `],
})
export class MarkdownComponent implements OnChanges, AfterViewInit {
  @Input() source = '';
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLElement>;

  /**
   * Sanitized HTML ready for {@code [innerHTML]} binding.
   * Recomputed on every {@code source} change; mermaid diagrams
   * are post-processed asynchronously by {@link runMermaid}.
   */
  safeHtml = '';
  private lastRenderedSource = '';

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (!('source' in changes)) return;
    this.safeHtml = this.renderMarkdown(this.source);
    // Wait one microtask so the new safeHtml is committed to the
    // DOM before we look for <pre class="mermaid"> nodes.
    queueMicrotask(() => void this.runMermaid());
  }

  async ngAfterViewInit(): Promise<void> {
    // First render (e.g. when the input was set in the template
    // before change detection ran). OnChanges may not have fired.
    if (this.lastRenderedSource !== this.source) {
      this.safeHtml = this.renderMarkdown(this.source);
      queueMicrotask(() => void this.runMermaid());
    }
  }

  /**
   * Convert markdown to HTML, sanitize, and return. Mermaid blocks
   * pass through as {@code <pre class="mermaid">...code...</pre>}
   * and are rendered asynchronously by {@link runMermaid} after the
   * browser has committed the safeHtml to the DOM.
   */
  private renderMarkdown(md: string): string {
    if (!md) return '';
    // `breaks: true` makes marked treat a single newline as a hard
    // break (rendered as <br>) instead of collapsing it to a
    // space. The CommonMark spec calls a single newline a "soft
    // break" that most renderers collapse, but the markdown we
    // receive in practice — Honcho representations, chat replies,
    // peer cards — uses single newlines as actual line breaks
    // without blank lines between them (e.g. a list of timestamped
    // observations where each entry is on its own line). Without
    // breaks, all 27 entries in mlapointe's representation collapse
    // into a single <p> with the text content run together.
    // GFM's reference behavior is the same (breaks: true).
    //
    // marked.parse is synchronous for the default config. We use
    // the sync overload to keep this method side-effect free.
    const rawHtml = marked.parse(md, { async: false, breaks: true }) as string;
    this.lastRenderedSource = md;
    return DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline',
                  'polygon', 'text', 'tspan', 'defs', 'marker', 'foreignObject'],
      ADD_ATTR: ['class', 'viewBox', 'xmlns', 'd', 'fill', 'stroke',
                 'stroke-width', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry',
                 'width', 'height', 'transform', 'id', 'data-*'],
    });
  }

  /**
   * Find every {@code <pre class="mermaid">} node, hand it to
   * {@code mermaid.render}, and replace the placeholder with the
   * generated SVG. Runs once per source change (tracked by
   * {@link lastRenderedSource}).
   */
  private async runMermaid(): Promise<void> {
    const root = this.host?.nativeElement;
    if (!root) return;
    const blocks = Array.from(
      root.querySelectorAll<HTMLElement>('pre.mermaid'),
    );
    if (blocks.length === 0) return;
    // Dynamic-import mermaid the first time it's needed. It pulls
    // in ~600KB of d3, and the chat panel rarely has diagrams, so
    // avoid paying that cost on initial load.
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
    for (const block of blocks) {
      const code = block.textContent ?? '';
      const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
      try {
        const { svg } = await mermaid.render(id, code);
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid';
        wrapper.innerHTML = svg;
        block.replaceWith(wrapper);
      } catch (e) {
        // Mermaid parse error: keep the original <pre> so the
        // operator sees the source code and can fix the diagram.
        // The browser console logs the underlying syntax error.
        console.error('mermaid render failed:', e);
      }
    }
  }
}
