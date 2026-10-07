/** validate({ body, query, params }) with zod schemas. Parsed query lands on req.q (Express 5 query is read-only). */
export const validate = (schemas) => (req, res, next) => {
  if (schemas.params) req.params = schemas.params.parse(req.params ?? {});
  if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
  req.q = schemas.query ? schemas.query.parse(req.query ?? {}) : req.query;
  next();
};
