// Match the documented quota error, including D1's wrapped Error.cause.
// Generic D1 outages and numeric API error codes do not imply a daily limit.
export function isDailyReadLimit(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error !== null && error !== undefined && !seen.has(error)) {
    seen.add(error);
    const message = typeof error === 'string' ? error
      : typeof error === 'object' && 'message' in error ? error.message : undefined;
    if (typeof message === 'string' && /exceeded D1's free tier daily row read limit/i.test(message)) return true;
    error = typeof error === 'object' && 'cause' in error ? error.cause : undefined;
  }
  return false;
}

export function dailyReadLimitNotice(now = new Date()): { message: string; retryAfter: string } {
  // The daily quota resets at 00:00 UTC (09:00 JST), including before 9am JST.
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  const date = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric' }).format(reset);
  return {
    message: `本日のデータ利用上限に達したため、現在このページを表示できません。${date}の午前9時（日本時間）以降に、もう一度お試しください。`,
    retryAfter: reset.toUTCString(),
  };
}
