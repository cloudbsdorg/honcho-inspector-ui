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
    confirmButtonText?: string | null;
  }): void {
    component.open = opts.open ?? true;
    component.title = opts.title ?? 'Delete thing';
    component.description = opts.description ?? 'This cannot be undone.';
    component.dangerLevel = opts.dangerLevel ?? 'medium';
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

  it('confirm button is enabled by default when the dialog is open', () => {
    renderWith({ dangerLevel: 'medium' });
    const confirmBtn = fixture.nativeElement.querySelector(
      '[data-testid="confirm-destructive-confirm-medium"]',
    ) as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn.disabled).toBe(false);
  });

  it('confirm click always emits confirmed (no typed challenge required anymore)', () => {
    renderWith({ title: 'Delete session' });
    const emitSpy = vi.spyOn(component.confirmed, 'emit');
    component.onConfirm();
    expect(emitSpy).toHaveBeenCalledTimes(1);
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
    expect(emitSpy).not.toHaveBeenCalledTimes(1);
  });

  it('selects the right data-testid based on dangerLevel', () => {
    renderWith({ dangerLevel: 'low' });
    expect(
      fixture.nativeElement.querySelector('[data-testid="confirm-destructive-confirm-low"]'),
    ).toBeTruthy();
    renderWith({ dangerLevel: 'high' });
    expect(
      fixture.nativeElement.querySelector('[data-testid="confirm-destructive-confirm-high"]'),
    ).toBeTruthy();
  });

  it('uses "Delete forever" as the default label for danger=high when no override is given', () => {
    renderWith({ dangerLevel: 'high' });
    expect(component.resolvedLabel()).toBe('Delete forever');
  });

  it('uses the explicit confirmButtonText when provided', () => {
    renderWith({
      dangerLevel: 'high',
      confirmButtonText: 'Wipe all conclusions',
    });
    expect(component.resolvedLabel()).toBe('Wipe all conclusions');
  });

  it('confirmColor returns danger red for high', () => {
    renderWith({ dangerLevel: 'high' });
    expect(component.confirmColor()).toContain('--danger');
  });
});
