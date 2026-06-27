import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MarkdownComponent } from './markdown.component';

/**
 * Regression coverage for the markdown rendering surface.
 *
 * <p>Every test below locks in a contract that the UI depends on.
 * A change that breaks one of these assertions is either a bug or
 * a deliberate behavior change that needs to update the call sites
 * (chat panel bubbles, dashboard representation card, memory
 * inspector popout) that depend on the behavior.
 *
 * <p>The component is marked {@code ViewEncapsulation.None} so the
 * styles apply to innerHTML-injected children. Don't change that
 * without re-reading the file header.
 */
describe('MarkdownComponent', () => {
  let fixture: ComponentFixture<MarkdownComponent>;
  let component: MarkdownComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(MarkdownComponent);
    component = fixture.componentInstance;
  });

  /**
   * Wait one microtask + one change-detection cycle so
   * {@code [innerHTML]} is committed and the testid we look
   * for is in the live DOM. {@code ngOnChanges} is async
   * because of the mermaid post-processing {@code queueMicrotask}.
   */
  async function render(source: string): Promise<DebugElement> {
    component.source = source;
    component.ngOnChanges({
      source: { previousValue: '', currentValue: source, firstChange: true, isFirstChange: () => true },
    } as any);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.debugElement;
  }

  function hostEl(de: DebugElement): HTMLElement {
    return de.query(By.css('.md-host'))?.nativeElement as HTMLElement;
  }

  describe('newlines', () => {
    it('treats a single newline as a hard break (renders <br>)', async () => {
      // Regression test: the Honcho representation for mlapointe
      // contains 27 timestamped entries separated by single \n
      // characters. Without breaks: true, all entries collapse
      // into one <p> with the text content run together (which is
      // what the user reported as "the newlines are not being
      // rendered"). With breaks: true, each \n becomes a <br> in
      // the rendered HTML and the entries display on separate
      // visual lines. A future "fix" that removes breaks: true
      // (e.g. someone who reads the CommonMark spec and decides
      // soft breaks should collapse) would re-introduce the
      // regression.
      const de = await render('line one\nline two\nline three');
      const host = hostEl(de);
      const brs = host.querySelectorAll('br');
      expect(brs.length).toBeGreaterThanOrEqual(2);
      // The three lines should be inside a single <p> (no blank
      // line between them).
      expect(host.querySelectorAll('p').length).toBe(1);
    });

    it('still treats a blank line as a paragraph break', async () => {
      // Regression test: breaks: true must NOT change the blank-
      // line-to-new-paragraph behavior. Two paragraphs separated
      // by a blank line should produce two <p> elements.
      const de = await render('first paragraph\n\nsecond paragraph');
      const host = hostEl(de);
      const ps = host.querySelectorAll('p');
      expect(ps.length).toBe(2);
      expect(ps[0].textContent).toContain('first paragraph');
      expect(ps[1].textContent).toContain('second paragraph');
    });
  });

  describe('headings', () => {
    it('renders ## Explicit Observations as a real <h2>', async () => {
      // Regression test: the Honcho representation starts with
      // "## Explicit Observations". The dashboard's inline view
      // depends on this being an <h2> element (not the literal
      // "##" text) so the CSS accent border and font-size
      // apply. A change that drops heading support (e.g. switches
      // to a different markdown parser without GFM) would break
      // the visual styling.
      const de = await render('## Explicit Observations\n\nbody text');
      const host = hostEl(de);
      const h2 = host.querySelector('h2');
      expect(h2).not.toBeNull();
      expect(h2?.textContent?.trim()).toBe('Explicit Observations');
      // The text "##" should not appear anywhere in the rendered HTML.
      expect(host.textContent).not.toContain('##');
    });
  });

  describe('code blocks', () => {
    it('wraps inline code in a <code> element', async () => {
      // Regression test: the Honcho representation contains
      // inline backtick code spans like `PUT /v3/...` and
      // `{metadata?}`. These must render as <code> so the CSS
      // pill style applies. A change that drops inline-code
      // rendering would make the code chips invisible.
      const de = await render('Use `npm install` to install');
      const host = hostEl(de);
      const code = host.querySelector('code');
      expect(code).not.toBeNull();
      expect(code?.textContent).toBe('npm install');
    });

    it('renders fenced code as <pre><code>', async () => {
      const de = await render('```\nconst x = 1;\n```');
      const host = hostEl(de);
      const pre = host.querySelector('pre');
      const code = pre?.querySelector('code');
      expect(pre).not.toBeNull();
      expect(code).not.toBeNull();
      expect(code?.textContent).toContain('const x = 1;');
    });
  });

  describe('lists', () => {
    it('renders unordered list items with the dashboard bullet glyph', async () => {
      // Regression test: the dashboard's other lists (peer card
      // bullets, sidebar items) use the `▸` glyph. The markdown
      // component's <li>::before rule applies the same glyph so
      // markdown lists match the rest of the UI. A change that
      // drops the ::before rule (or sets list-style: disc back)
      // would create visual inconsistency between markdown lists
      // and hand-coded lists.
      const de = await render('- first\n- second\n- third');
      const host = hostEl(de);
      const items = host.querySelectorAll('li');
      expect(items.length).toBe(3);
      // The bullet glyph is applied via ::before content, not in
      // the text node, so we check the computed style.
      const before = getComputedStyle(items[0], '::before');
      expect(before.content).toBe('"▸"');
    });
  });

  describe('XSS sanitization', () => {
    it('strips <script> tags from the rendered output', async () => {
      // Regression test: Honcho response bodies are user-
      // controlled (a peer could write hostile markdown). The
      // marked.parse output must be sanitized through DOMPurify
      // before [innerHTML]. A change that skips DOMPurify (or
      // adds an allow-list entry for <script>) is a security
      // regression. We verify the script tag is removed, the
      // literal text is preserved (so the user can see what
      // happened), but no script element is in the DOM.
      const de = await render('hello <script>alert(1)</script> world');
      const host = hostEl(de);
      expect(host.querySelector('script')).toBeNull();
      expect(host.textContent).toContain('hello');
      expect(host.textContent).toContain('world');
    });
  });

  describe('empty / null source', () => {
    it('renders empty string for empty source', async () => {
      const de = await render('');
      const host = hostEl(de);
      expect(host.innerHTML).toBe('');
    });
  });
});
