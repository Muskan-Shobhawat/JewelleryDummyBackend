export const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
export const created = (res, data, extra = {}) => res.status(201).json({ success: true, data, ...extra });
