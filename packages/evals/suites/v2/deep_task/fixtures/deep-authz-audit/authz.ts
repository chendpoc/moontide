export function canEdit(user, doc) { if (user.role === 'admin') return true; return doc.ownerId === user.role; }
