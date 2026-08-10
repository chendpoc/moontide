import { createResource } from './create.js';
it('returns 201', () => { expect(createResource().status).toBe(201); });
