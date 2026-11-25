// Dates are shown in IST, the program's time zone, whatever the viewer's server runs in.

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export const formatDate = (date: Date) => dateFormat.format(date);
export const formatDateTime = (date: Date) => `${dateTimeFormat.format(date)} IST`;

export const signed = (points: number) => (points > 0 ? `+${points}` : String(points));

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
