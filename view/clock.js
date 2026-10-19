(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetClock = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // 8:42 PM / Morndas, 17th of Last Seed
  function formatTime(hour, minute) {
    const safeHour = ((Math.floor(Number(hour)) % 24) + 24) % 24 || 0;
    const safeMinute = Math.min(59, Math.max(0, Math.floor(Number(minute)) || 0));
    const displayHour = safeHour % 12 === 0 ? 12 : safeHour % 12;
    return `${displayHour}:${String(safeMinute).padStart(2, '0')} ${safeHour < 12 ? 'AM' : 'PM'}`;
  }

  function ordinal(day) {
    const value = Math.max(1, Math.floor(Number(day)) || 1);
    const lastTwo = value % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
    return `${value}${['th', 'st', 'nd', 'rd'][value % 10] || 'th'}`;
  }

  function formatDate(data) {
    const parts = [];
    if (data && data.weekday) parts.push(`${data.weekday}, `);
    parts.push(ordinal(data && data.day));
    if (data && data.month) parts.push(` of ${data.month}`);
    return parts.join('');
  }

  return Object.freeze({ formatTime, formatDate, ordinal });
});
