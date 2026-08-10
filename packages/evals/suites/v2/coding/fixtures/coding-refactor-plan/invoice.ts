export function lineTotal(q, p) { const tax = p * q * 0.1; return p * q + tax; }
export function shipTotal(w, p) { const tax = p * w * 0.1; return p * w + tax; }
