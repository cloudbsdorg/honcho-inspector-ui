import { snakeToCamel } from './api-client';

describe('snakeToCamel', () => {
  it('passes primitives through unchanged', () => {
    expect(snakeToCamel('hello')).toBe('hello');
    expect(snakeToCamel(42)).toBe(42);
    expect(snakeToCamel(true)).toBe(true);
    expect(snakeToCamel(null)).toBeNull();
    expect(snakeToCamel(undefined)).toBeUndefined();
  });

  it('converts a single snake_case key', () => {
    expect(snakeToCamel({ users_total: 5 })).toEqual({ usersTotal: 5 });
    expect(snakeToCamel({ first_run: true })).toEqual({ firstRun: true });
  });

  it('converts nested objects recursively', () => {
    expect(
      snakeToCamel({
        users_total: 1,
        audit_log: {
          rows_total: 0,
          generated_at: '2026-01-01T00:00:00Z',
        },
      }),
    ).toEqual({
      usersTotal: 1,
      auditLog: {
        rowsTotal: 0,
        generatedAt: '2026-01-01T00:00:00Z',
      },
    });
  });

  it('walks arrays element-wise', () => {
    expect(snakeToCamel({ items: [{ created_at: 'a' }, { created_at: 'b' }] })).toEqual({
      items: [{ createdAt: 'a' }, { createdAt: 'b' }],
    });
  });

  it('leaves already-camelCase keys alone', () => {
    expect(snakeToCamel({ alreadyCamel: 'x', count42: 1 })).toEqual({
      alreadyCamel: 'x',
      count42: 1,
    });
  });

  it('handles an empty object and empty array', () => {
    expect(snakeToCamel({})).toEqual({});
    expect(snakeToCamel([])).toEqual([]);
  });

  it('handles a backend-shaped AdminDashboardOverview payload', () => {
    expect(
      snakeToCamel({
        users_total: 1,
        users_admins: 1,
        users_last7d: 1,
        users_last30d: 1,
        profiles_total: 1,
        audit_total: 0,
        audit_last30d: 0,
        generated_at: '2026-06-25T16:25:06Z',
      }),
    ).toEqual({
      usersTotal: 1,
      usersAdmins: 1,
      usersLast7d: 1,
      usersLast30d: 1,
      profilesTotal: 1,
      auditTotal: 0,
      auditLast30d: 0,
      generatedAt: '2026-06-25T16:25:06Z',
    });
  });

  it('does not double-convert already-camelCase keys mixed with snake keys', () => {
    // Mixed: ensure both shapes survive the same recursion pass.
    expect(
      snakeToCamel({
        user_count: 3,
        sessionCount: 7,
        nested: { node_id: 'n1', parentId: 'p1' },
      }),
    ).toEqual({
      userCount: 3,
      sessionCount: 7,
      nested: { nodeId: 'n1', parentId: 'p1' },
    });
  });
});
