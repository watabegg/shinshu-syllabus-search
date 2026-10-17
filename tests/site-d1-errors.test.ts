import { describe, expect, it } from 'vitest';
import { dailyReadLimitNotice, isDailyReadLimit } from '../src/lib/d1-errors';

const quota = "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";

describe('D1 daily read limit notice', () => {
  it('recognizes direct errors and wrapped causes without treating other failures as quotas', () => {
    expect(isDailyReadLimit(new Error(`D1_ERROR: ${quota}`))).toBe(true);
    expect(isDailyReadLimit(new Error('D1_ERROR', { cause: new Error(quota) }))).toBe(true);
    expect(isDailyReadLimit(new Error('D1 batch failed', { cause: quota }))).toBe(true);
    for (const other of [null, undefined, 7500, new Error('D1 unavailable'), new Error(quota.replace('read', 'write'))]) {
      expect(isDailyReadLimit(other)).toBe(false);
    }
    const circular = new Error('other');
    circular.cause = circular;
    expect(isDailyReadLimit(circular)).toBe(false);
  });

  it.each([
    ['2026-10-17T08:59:59+09:00', '10月17日', 'Sat, 17 Oct 2026 00:00:00 GMT'],
    ['2026-10-17T09:00:00+09:00', '10月18日', 'Sun, 18 Oct 2026 00:00:00 GMT'],
    ['2026-12-31T23:59:59+09:00', '1月1日', 'Fri, 01 Jan 2027 00:00:00 GMT'],
  ])('shows the next 9am in Japan at %s', (now, date, retryAfter) => {
    const notice = dailyReadLimitNotice(new Date(now));
    expect(notice.message).toContain(`${date}の午前9時（日本時間）`);
    expect(notice.message).not.toContain('D1');
    expect(notice.retryAfter).toBe(retryAfter);
  });
});
