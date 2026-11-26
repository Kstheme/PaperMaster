export const normalizeKey = value => value.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
