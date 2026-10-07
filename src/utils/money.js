export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
export const roundRupee = (n) => Math.round(Number(n));
export const addDays = (date, days) => new Date(new Date(date).getTime() + days * 86400000);
export const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};
export const nowIso = () => new Date().toISOString();
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}
