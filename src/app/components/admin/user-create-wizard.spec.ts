import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { UserCreateWizard } from './user-create-wizard';
import { AdminService } from '../../core/admin.service';

class FakeAdminService {
  createCalls: Array<Record<string, unknown>> = [];
  nextResult: unknown = {
    id: 'fake-id',
    username: 'alice',
    firstname: null,
    lastname: null,
    email: null,
    isAdmin: false,
    createdAt: '2026-06-25T19:00:00Z',
  };
  failWith: Error | null = null;

  async createUser(input: Record<string, unknown>): Promise<unknown> {
    this.createCalls.push(input);
    if (this.failWith) throw this.failWith;
    return this.nextResult;
  }
}

describe('UserCreateWizard', () => {
  let fixture: ComponentFixture<UserCreateWizard>;
  let component: UserCreateWizard;
  let admin: FakeAdminService;

  beforeEach(async () => {
    admin = new FakeAdminService();
    await TestBed.configureTestingModule({
      imports: [UserCreateWizard],
      providers: [{ provide: AdminService, useValue: admin }],
    }).compileComponents();

    fixture = TestBed.createComponent(UserCreateWizard);
    component = fixture.componentInstance;
    component.open = true;
    fixture.detectChanges();
  });

  it('starts on step 1 (welcome) with empty form', () => {
    expect(component.step()).toBe(1);
    expect(component.form.controls['username'].value).toBe('');
    expect(component.form.controls['password'].value).toBe('');
  });

  it('does not advance from step 2 until username, password and confirm match', () => {
    component.step.set(2);
    fixture.detectChanges();
    // Empty form: can't advance
    expect(component.canAdvance()).toBe(false);

    component.form.patchValue({ username: 'alice', password: 'short', confirm: 'short' });
    fixture.detectChanges();
    // Password under 8 chars
    expect(component.canAdvance()).toBe(false);

    component.form.patchValue({ password: 'longenough', confirm: 'different' });
    fixture.detectChanges();
    // Confirm mismatch
    expect(component.canAdvance()).toBe(false);

    component.form.patchValue({ confirm: 'longenough' });
    fixture.detectChanges();
    expect(component.canAdvance()).toBe(true);
  });

  it('advances step by step and blocks past the last', () => {
    component.step.set(1);
    component.next();
    expect(component.step()).toBe(2);
    // Step 2 needs valid username + password + confirm before advancing.
    component.form.patchValue({
      username: 'alice',
      password: 'longenough',
      confirm: 'longenough',
    });
    component.next();
    expect(component.step()).toBe(3);
    component.next();
    expect(component.step()).toBe(4);
    component.next();
    // Stays on step 4
    expect(component.step()).toBe(4);
  });

  it('back() walks steps backwards and is a no-op on step 1', () => {
    component.step.set(3);
    component.back();
    expect(component.step()).toBe(2);
    component.back();
    expect(component.step()).toBe(1);
    component.back();
    expect(component.step()).toBe(1);
  });

  it('submit() sends the expected payload and emits completed', async () => {
    let completedPayload: { username: string; isAdmin: boolean } | null = null;
    component.completed.subscribe((p) => (completedPayload = p));
    component.step.set(4);
    component.form.patchValue({
      username: 'alice',
      password: 'longenough',
      confirm: 'longenough',
      firstname: 'Alice',
      lastname: 'Liddell',
      email: 'alice@example.com',
    });
    component.isAdmin.set(true);

    await component.submit();

    // The OUTBOUND payload (what the wizard asks the backend to create)
    // is what the operator picked — isAdmin=true.
    expect(admin.createCalls).toEqual([
      {
        username: 'alice',
        password: 'longenough',
        firstname: 'Alice',
        lastname: 'Liddell',
        email: 'alice@example.com',
        isAdmin: true,
      },
    ]);
    // The COMPLETED event carries the server's confirmation, which in the
    // fake returns isAdmin=false regardless of input. This is intentional:
    // the wizard emits what the backend actually did, not what the operator
    // asked for (the server is the source of truth for any normalisation
    // or rejection).
    expect(completedPayload).toEqual({ username: 'alice', isAdmin: false });
    expect(component.submitting()).toBe(false);
  });

  it('submit() surfaces backend errors without resetting the form', async () => {
    admin.failWith = new Error('username already exists');
    component.step.set(4);
    component.form.patchValue({
      username: 'alice',
      password: 'longenough',
      confirm: 'longenough',
    });
    await component.submit();

    expect(component.error()).toContain('username already exists');
    expect(component.step()).toBe(4);
  });

  it('ngOnChanges resets to step 1 when re-opened', () => {
    component.step.set(3);
    component.form.patchValue({
      username: 'alice',
      password: 'longenough',
      confirm: 'longenough',
    });
    component.isAdmin.set(true);
    component.open = false;
    component.ngOnChanges();
    component.open = true;
    component.ngOnChanges();
    expect(component.step()).toBe(1);
    expect(component.form.controls['username'].value).toBe('');
    expect(component.isAdmin()).toBe(false);
  });

  it('emits dismissed when dismiss() is called and not submitting', () => {
    let dismissed = false;
    component.dismissed.subscribe(() => (dismissed = true));
    component.dismiss();
    expect(dismissed).toBe(true);
  });

  it('does not emit dismissed while submitting', () => {
    let dismissed = false;
    component.dismissed.subscribe(() => (dismissed = true));
    component.submitting.set(true);
    component.dismiss();
    expect(dismissed).toBe(false);
    component.submitting.set(false);
  });
});
