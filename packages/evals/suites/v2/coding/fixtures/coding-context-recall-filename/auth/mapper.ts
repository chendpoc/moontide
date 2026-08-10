import { NotFoundError } from './errors.js';
export const map = (e) => e instanceof NotFoundError ? 404 : 500;
