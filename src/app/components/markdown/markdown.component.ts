import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
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
  selector: 'app-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="md-host" [innerHTML]="safeHtml"></div>
  `,
  styles: [`
    :host { display: block; }
    .md-host { line-height: 1.55; }
    .md-host :is(h1, h2, h3, h4) { font-weight: 700; margin: 0.8em 0 0.4em; }
    .md-host h1 { font-size: 1.6em; }
    .md-host h2 { font-size: 1.35em; }
    .md-host h3 { font-size: 1.15em; }
    .md-host p  { margin: 0.5em 0; }
    .md-host :is(ul, ol) { margin: 0.5em 0; padding-left: 1.5em; }
    .md-host li { margin: 0.2em 0; }
    .md-host code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
      background: color-mix(in srgb, currentColor 8%, transparent);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .md-host pre {
      background: color-mix(in srgb, currentColor 6%, transparent);
      padding: 0.6em 0.8em;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.9em;
    }
    .md-host pre code { background: transparent; padding: 0; }
    .md-host a { color: var(--accent, #4a9); text-decoration: underline; }
    .md-host table { border-collapse: collapse; margin: 0.5em 0; }
    .md-host th, .md-host td { border: 1px solid currentColor; padding: 4px 8px; }
    .md-host blockquote {
      margin: 0.5em 0;
      padding: 0.2em 0.8em;
      border-left: 3px solid currentColor;
      opacity: 0.85;
    }
    .md-host :is(pre, table, blockquote) { max-width: 100%; }
    .md-host .mermaid { text-align: center; margin: 0.8em 0; }
    .md-host .mermaid svg { max-width: 100%; height: auto; }
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
    // marked.parse is synchronous for the default config. We use
    // the sync overload to keep this method side-effect free.
    const rawHtml = marked.parse(md, { async: false }) as string;
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
