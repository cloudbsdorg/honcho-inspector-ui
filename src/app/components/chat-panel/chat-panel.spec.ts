import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatPanel } from './chat-panel';
import { HonchoService } from '../../core/honcho.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { ProfileService } from '../../core/profile.service';
import { Profile } from '../../core/models';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const USER = { id: 'u-1', username: 'alice', isAdmin: false, createdAt: '2026-01-01T00:00:00Z' };

const PROFILE: Profile = {
  id: 'p-a',
  userId: 'u-1',
  label: 'Personal',
  apiKeyEncrypted: 'ZW5j',
  baseUrl: 'https://honcho.example',
  workspaceId: 'default',
  honchoUserName: 'alice',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

async function loginAndInit() {
  localStorage.setItem('honcho-credentials', JSON.stringify({ sessionId: 'sess-abc', user: USER }));
  localStorage.setItem('honcho-active-profile', JSON.stringify(PROFILE.id));
}

/**
 * Manually drive an async iterable by emitting chunks one at a
 * time. The test calls {@link SseHarness.push} to enqueue the next
 * value the consumer's `for await` loop will see, and
 * {@link SseHarness.done} to terminate the stream. The harness
 * yields control between pushes so the consumer's signal updates
 * flush through Angular's change detection.
 *
 * <p>Implements the full `AsyncGenerator<T>` surface (`next`,
 * `return`, `throw`, `[Symbol.asyncIterator]`) so it can stand in
 * directly for the service's `chatStream()` return type without
 * an extra wrapper.
 */
class SseHarness {
  private readonly queue: { text: string; done: boolean }[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;
  private readonly iter = this.generate();
  push(text: string, done = false): Promise<void> {
    this.queue.push({ text, done });
    const w = this.waiter;
    this.waiter = null;
    w?.();
    return Promise.resolve();
  }
  end(): void {
    this.closed = true;
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }
  private async *generate(): AsyncGenerator<{ text: string; done: boolean }> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
  }
  next(value?: unknown) {
    return this.iter.next(value as never);
  }
  return(value?: unknown): Promise<IteratorResult<{ text: string; done: boolean }>> {
    this.end();
    return this.iter.return!(value as { text: string; done: boolean });
  }
  throw(e?: unknown) {
    return this.iter.throw!(e);
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}

describe('ChatPanel', () => {
  let fixture: ComponentFixture<ChatPanel>;
  let component: ChatPanel;
  let honcho: HonchoService;
  let auth: HonchoAuthService;
  let profiles: ProfileService;

  beforeEach(async () => {
    localStorage.clear();
    await loginAndInit();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ChatPanel],
    }).compileComponents();
    auth = TestBed.inject(HonchoAuthService);
    honcho = TestBed.inject(HonchoService);
    profiles = TestBed.inject(ProfileService);
    fixture = TestBed.createComponent(ChatPanel);
    component = fixture.componentInstance;
    component.peerId = 'alice';
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  it('should have an empty input value initially', () => {
    expect(component.inputValue()).toBe('');
  });

  it('should update input value signal as user types', () => {
    component.inputValue.set('hello world');
    expect(component.inputValue()).toBe('hello world');
  });

  it('should disable send when input is empty', () => {
    component.inputValue.set('');
    expect(component.canSend()).toBe(false);
  });

  it('should enable send when input is non-empty', () => {
    component.inputValue.set('tell me about yourself');
    expect(component.canSend()).toBe(true);
  });

  it('should disable send while waiting for a reply', () => {
    component.inputValue.set('hi');
    component.busy.set(true);
    expect(component.canSend()).toBe(false);
  });

  it('should call /api/peers/{id}/chat on send and append a user + assistant turn', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse('mock reply for alice'));
    component.inputValue.set('hi alice');
    await component.send();
    expect(component.turns().length).toBe(2);
    expect(component.turns()[0]!.role).toBe('user');
    expect(component.turns()[0]!.content).toBe('hi alice');
    expect(component.turns()[1]!.role).toBe('assistant');
    expect(component.turns()[1]!.content).toBe('mock reply for alice');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/peers/alice/chat'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should include X-Session-Id AND X-Honcho-Profile-Id in chat requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse('mock reply'));
    component.inputValue.set('hi');
    await component.send();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({
      'X-Session-Id': 'sess-abc',
      'X-Honcho-Profile-Id': 'p-a',
    });
  });

  it('should clear the input after a successful send', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse('reply'));
    component.inputValue.set('hi');
    await component.send();
    expect(component.inputValue()).toBe('');
  });

  it('should surface the honcho error in the error signal when chat fails (not as a turn)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 502));
    component.inputValue.set('hi');
    await component.send();
    expect(component.turns().length).toBe(1);
    expect(component.turns()[0]!.role).toBe('user');
    expect(component.error()).toContain('server error');
  });

  it('should clear the turns when peerId changes', () => {
    component.inputValue.set('hi');
    component.peerId = 'bob';
    component.ngOnChanges();
    expect(component.turns().length).toBe(0);
  });

  describe('streaming', () => {
    /**
     * Helper: replace `honcho.chatStream` with a function that
     * returns the given harness's iterator so the component's
     * `for await` loop sees exactly what the test enqueues.
     */
    function stubStream(harness: SseHarness) {
      // Return the harness itself — it implements AsyncIterable so
      // the consumer's `for await` loop binds via the harness's
      // [Symbol.asyncIterator]. (Returning the iterator object
      // directly fails the AsyncGenerator<T> type check.)
      return vi.spyOn(honcho, 'chatStream').mockImplementation((_peer, _q, _opts) => harness);
    }

    it('should update the streaming signal incrementally per chunk', async () => {
      const harness = new SseHarness();
      stubStream(harness);
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse('unused'));
      component.inputValue.set('hi alice');
      const sendPromise = component.send();
      // First chunk arrives; wait for the consumer to pick it up.
      await harness.push('Hello');
      await fixture.whenStable();
      expect(component.streamingAssistantTurn()).toBe('Hello');
      expect(component.turns().length).toBe(2);
      expect(component.turns()[0]!.role).toBe('user');
      expect(component.turns()[0]!.content).toBe('hi alice');
      expect(component.turns()[1]!.role).toBe('assistant');
      // The placeholder turn stays empty until the stream finalizes.
      expect(component.turns()[1]!.content).toBe('');
      // Push a second chunk and verify the signal grows.
      await harness.push(', world');
      await fixture.whenStable();
      expect(component.streamingAssistantTurn()).toBe('Hello, world');
      // End the stream so the send() promise resolves.
      await harness.push('', true);
      harness.end();
      await sendPromise;
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should commit the streamed text into the placeholder turn on done', async () => {
      const harness = new SseHarness();
      stubStream(harness);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse('unused'));
      component.inputValue.set('go');
      const sendPromise = component.send();
      await harness.push('The answer is ');
      await fixture.whenStable();
      await harness.push('42', true);
      harness.end();
      await sendPromise;
      // The placeholder turn at index 1 must now contain the full
      // streamed text. After commit, the busy state is false and
      // the streaming signal is reset to ''.
      expect(component.turns().length).toBe(2);
      expect(component.turns()[1]!.role).toBe('assistant');
      expect(component.turns()[1]!.content).toBe('The answer is 42');
      expect(component.busy()).toBe(false);
      expect(component.streamingAssistantTurn()).toBe('');
      expect(component.streamingDone()).toBe(false);
    });

    it('should abort the stream when cancel() is called mid-flight', async () => {
      const harness = new SseHarness();
      let capturedSignal: AbortSignal | null = null;
      vi.spyOn(honcho, 'chatStream').mockImplementation((_peer, _q, opts) => {
        capturedSignal = opts?.signal ?? null;
        return harness;
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse('unused'));
      component.inputValue.set('go');
      const sendPromise = component.send();
      await harness.push('partial');
      await fixture.whenStable();
      expect(capturedSignal).not.toBeNull();
      expect(capturedSignal!.aborted).toBe(false);
      // Operator clicks Cancel.
      component.cancel();
      expect(capturedSignal!.aborted).toBe(true);
      harness.end();
      await sendPromise;
      // The partial text was committed into the placeholder turn
      // because the for-await loop broke on the aborted check.
      expect(component.busy()).toBe(false);
      expect(component.turns()[1]!.content).toBe('partial');
    });

    it('should not duplicate the user turn when streaming is used', async () => {
      const harness = new SseHarness();
      stubStream(harness);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse('unused'));
      component.inputValue.set('single user turn');
      const sendPromise = component.send();
      await harness.push('hi back', true);
      harness.end();
      await sendPromise;
      const userTurns = component.turns().filter((t) => t.role === 'user');
      expect(userTurns.length).toBe(1);
      expect(userTurns[0]!.content).toBe('single user turn');
      // Plus exactly one assistant turn.
      expect(component.turns().filter((t) => t.role === 'assistant').length).toBe(1);
    });

    it('should drop the empty placeholder turn when the stream errors', async () => {
      const harness = new SseHarness();
      vi.spyOn(honcho, 'chatStream').mockImplementation(async function* () {
        // First yield an empty chunk so the consumer adds nothing,
        // then throw.
        yield { text: '', done: false };
        throw new Error('stream blew up');
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse('unused'));
      component.inputValue.set('hi');
      await component.send();
      expect(component.turns().length).toBe(1);
      expect(component.turns()[0]!.role).toBe('user');
      expect(component.error()).toContain('stream blew up');
      expect(component.busy()).toBe(false);
    });

    it('re-evaluates the streaming branch on streamingAssistantTurn updates (regression)', async () => {
      // Regression for the failure where the @if condition that
      // picks the streaming bubble had no signal-read dependency on
      // `streamingAssistantTurn()` — only `isLast`, `turn.role`,
      // and `busy()` — so under OnPush change detection the
      // branch never re-rendered as the SSE chunks arrived. The
      // operator saw the assistant turn appear all-at-once when
      // the stream finished. Fix: append `&& streamingAssistantTurn()
      // !== null` to the @if so a signal-read dependency is
      // registered on the condition itself.
      //
      // Strategy: stub `chatStream` with the existing harness,
      // start a send, push three chunks, and after each chunk
      // assert that the DOM re-rendered with the new
      // `streamingAssistantTurn` text — proving the @if branch's
      // signal-dependency machinery is intact.
      const harness = new SseHarness();
      stubStream(harness);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse('unused'));
      component.inputValue.set('hi alice');
      const sendPromise = component.send();
      // Chunk 1.
      await harness.push('Hello');
      fixture.detectChanges();
      expect(component.streamingAssistantTurn()).toBe('Hello');
      expect(component.busy()).toBe(true);
      let rendered = fixture.nativeElement.querySelector(
        '[data-testid="chat-stream-cursor"]',
      );
      expect(rendered).not.toBeNull();
      // The streaming bubble's <app-markdown> must reflect the
      // current streamingAssistantTurn value, not stale empty
      // content. Walk to its rendered .md-host and verify the
      // textContent matches.
      let streamingHost = findStreamingMarkdownHost(fixture.nativeElement);
      expect(streamingHost).not.toBeNull();
      expect(streamingHost!.textContent ?? '').toContain('Hello');
      // Chunk 2.
      await harness.push(', world');
      fixture.detectChanges();
      expect(component.streamingAssistantTurn()).toBe('Hello, world');
      streamingHost = findStreamingMarkdownHost(fixture.nativeElement);
      expect(streamingHost).not.toBeNull();
      expect(streamingHost!.textContent ?? '').toContain('Hello, world');
      // Chunk 3.
      await harness.push('!');
      fixture.detectChanges();
      expect(component.streamingAssistantTurn()).toBe('Hello, world!');
      streamingHost = findStreamingMarkdownHost(fixture.nativeElement);
      expect(streamingHost).not.toBeNull();
      expect(streamingHost!.textContent ?? '').toContain('Hello, world!');
      // End the stream.
      await harness.push('', true);
      harness.end();
      await sendPromise;
      fixture.detectChanges();
      // After completion the streaming bubble is gone and the
      // rendered bubble switches to the committed turn.content.
      rendered = fixture.nativeElement.querySelector(
        '[data-testid="chat-stream-cursor"]',
      );
      expect(rendered).toBeNull();
    });
  });
});

/**
 * Return the `.md-host` element rendered by the in-flight
 * `<app-markdown>` inside the streaming assistant bubble — i.e.
 * the markdown whose `[source]` is bound to
 * `streamingAssistantTurn()`. The streaming bubble always lives
 * inside the most recent `.flex.justify-start` turn, paired with
 * a `data-testid="chat-stream-cursor"` sibling that confirms this
 * is the in-flight branch (the committed branch has no cursor).
 *
 * Returns null if the cursor isn't present (no stream in flight).
 */
function findStreamingMarkdownHost(root: HTMLElement): HTMLElement | null {
  const cursor = root.querySelector('[data-testid="chat-stream-cursor"]');
  if (!cursor) return null;
  // The cursor sits in the same bubble as the streaming markdown;
  // walk up to that bubble's .md-host.
  const bubble = cursor.closest('.th-border');
  if (!bubble) return null;
  return bubble.querySelector('.md-host');
}
