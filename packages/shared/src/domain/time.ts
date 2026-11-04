const pad = (n: number) => n.toString().padStart(2, '0');

/** Local calendar date as `YYYY-MM-DD`. */
export const isoDate = (now: Date = new Date()) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** Local timestamp as `YYYY-MM-DD HH:mm`, the format used for fault and log records. */
export const formatTimestamp = (now: Date = new Date()) =>
  `${isoDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
