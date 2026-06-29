import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmDestructiveDialog } from './confirm-destructive-dialog';

describe('ConfirmDestructiveDialog', () => {
  let fixture: ComponentFixture<ConfirmDestructiveDialog>;
  let component: ConfirmDestructiveDialog;

  function renderWith(opts: {
    open?: boolean;
    title?: string;
    description?: string;
    dangerLevel?: 'low' | 'medium' | 'high';
    typedConfirmation?: string | null;
    confirmButtonText?: string | null;
  }): void {
    component.open = opts.open ?? true;
    component.title = opts.title ?? 'Delete thing';
    component.description = opts.description ?? 'This cannot be undone.';
    component.dangerLevel = opts.dangerLevel ?? 'medium';
    component.typedConfirmation =
      opts.typedConfirmation !== undefined ? opts.typedConfirmation : null;
    component.confirmButtonText = opts.confirmButtonText ?? null;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [ConfirmDestructiveDialog] });
    fixture = TestBed.createComponent(ConfirmDestructiveDialog);
    component = fixture.componentInstance;
  });

  it('renders title + description when open', () => {
    renderWith({ open: true, title: 'Delete session', description: 'Be careful!' });
    const card = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-card"]',
    );
    expect(card).toBeTruthy();
    const titleEl = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-title"]',
    ) as HTMLElement;
    expect(titleEl.textContent?.trim()).toBe('Delete session');
    const descEl = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-description"]',
    ) as HTMLElement;
    expect(descEl.textContent?.trim()).toBe('Be careful!');
  });

  it('does not render when open is false', () => {
    renderWith({ open: false });
    expect(
      fixture.nativeElement.querySelector('[data-testid="confirm-destructive-card"]'),
    ).toBeNull();
  });

  it('confirm button is disabled until typed confirmation matches (case-sensitive)', () => {
    renderWith({ typedConfirmation: 'delete session abc' });
    const confirmBtn = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-confirm-medium"]',
    ) as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn.disabled).toBe(true);

    component.typedInput.set('Delete Session ABC');
    expect(component.canConfirm()).toBe(false);

    component.typedInput.set('delete session abc');
    expect(component.canConfirm()).toBe(true);
  });

  it('confirm button emits confirmed when typed confirmation matches', () => {
    renderWith({ typedConfirmation: 'delete 5 sessions' });
    const emitSpy = vi.spyOn(component.confirmed, 'emit');
    component.typedInput.set('delete 5 sessions');
    component.onConfirm();
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('confirm button click is no-op when typed confirmation does not match', () => {
    renderWith({ typedConfirmation: 'nuke workspace' });
    const emitSpy = vi.spyOn(component.confirmed, 'emit');
    component.typedInput.set('nuke space');
    component.onConfirm();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('confirm button enabled by default when typedConfirmation is null', () => {
    renderWith({ typedConfirmation: null });
    const confirmBtn = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-confirm-medium"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  it('Cancel button emits cancelled', () => {
    renderWith({ open: true });
    const emitSpy = vi.spyOn(component.cancelled, 'emit');
    const cancelBtn = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-cancel"]',
    ) as HTMLButtonElement;
    cancelBtn.click();
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('backdrop click emits cancelled', () => {
    renderWith({ open: true });
    const emitSpy = vi.spyOn(component.cancelled, 'emit');
    const overlay = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-overlay"]',
    ) as HTMLElement;
    overlay.click();
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('click on the modal panel does NOT emit cancelled (event stopped)', () => {
    renderWith({ open: true });
    const emitSpy = vi.spyOn(component.cancelled, 'emit');
    const card = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-card"]',
    ) as HTMLElement;
    card.click();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('escape key emits cancelled when open', () => {
    renderWith({ open: true });
    const emitSpy = vi.spyOn(component.cancelled, 'emit');
    component.onEscape();
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('escape key does NOT emit when closed', () => {
    renderWith({ open: false });
    const emitSpy = vi.spyOn(component.cancelled, 'emit');
    component.onEscape();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('selects the right data-testid based on dangerLevel', () => {
    renderWith({ dangerLevel: 'low', typedConfirmation: null });
    expect(
      fixture.nativeElement.querySelector('[data-testid="confirm-destructive-confirm-low"]'),
    ).toBeTruthy();
    renderWith({ dangerLevel: 'high', typedConfirmation: null });
    expect(
      fixture.nativeElement.querySelector('[data-testid="confirm-destructive-confirm-high"]'),
    ).toBeTruthy();
  });

  it('uses "Delete forever" as the default label for danger=high when no override is given', () => {
    renderWith({ dangerLevel: 'high', typedConfirmation: null });
    expect(component.resolvedLabel()).toBe('Delete forever');
  });

  it('uses the explicit confirmButtonText when provided', () => {
    renderWith({
      dangerLevel: 'high',
      typedConfirmation: null,
      confirmButtonText: 'Wipe all conclusions',
    });
    expect(component.resolvedLabel()).toBe('Wipe all conclusions');
  });

  it('confirmColor returns danger red for high', () => {
    renderWith({ dangerLevel: 'high' });
    expect(component.confirmColor()).toContain('--danger');
  });

  it('reset the typed input on each open transition so reopened dialogs do not retain old text', () => {
    component.open = false;
    component.typedInput.set('residue');
    component.open = true;
    fixture.detectChanges();
    expect(component.typedInput()).toBe('');
  });

  /** Regression guards for the typed-confirmation gating. */

  function typeInto(text: string): void {
    const inputEl = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-typed-input"]',
    ) as HTMLInputElement;
    inputEl.value = text;
    inputEl.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('disables the confirm button when typed input is empty', () => {
    renderWith({ typedConfirmation: 'delete conclusion' });
    const confirmBtn = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-confirm-medium"]',
    ) as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn.disabled).toBe(true);
  });

  it('does not emit confirmed when typed input is empty (button is clickable but guarded)', () => {
    renderWith({ typedConfirmation: 'delete conclusion' });
    const emitSpy = vi.spyOn(component.confirmed, 'emit');
    // jsdom suppresses click events on <button disabled>, so drive
    // the handler directly to verify the in-component guard.
    component.onConfirm();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('enables the confirm button when typed input matches exactly', () => {
    renderWith({ typedConfirmation: 'delete conclusion' });
    typeInto('delete conclusion');
    const confirmBtn = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-confirm-medium"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
    const emitSpy = vi.spyOn(component.confirmed, 'emit');
    confirmBtn.click();
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT enable the confirm button when typed input case-differs', () => {
    renderWith({ typedConfirmation: 'delete conclusion' });
    typeInto('Delete Conclusion');
    const confirmBtn = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-confirm-medium"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    expect(component.canConfirm()).toBe(false);
  });

  it('does NOT enable the confirm button when typed input differs by punctuation / whitespace', () => {
    renderWith({ typedConfirmation: 'delete conclusion' });
    typeInto(' Delete Conclusion');
    expect(
      (fixture.nativeElement.querySelector(
        '[data-testid="confirm-destructive-confirm-medium"]',
      ) as HTMLButtonElement).disabled,
    ).toBe(true);
    typeInto('delete conclusion ');
    expect(
      (fixture.nativeElement.querySelector(
        '[data-testid="confirm-destructive-confirm-medium"]',
      ) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('typing past the exact match then deleting down leaves the button disabled', () => {
    renderWith({ typedConfirmation: 'delete conclusion' });
    typeInto('delete conclusion extra');
    expect(component.canConfirm()).toBe(false);
    typeInto('delete conclusion');
    expect(component.canConfirm()).toBe(true);
    typeInto('delete conclusio');
    expect(component.canConfirm()).toBe(false);
  });
});
