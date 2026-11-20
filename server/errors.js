export class AppError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requiredText(value, label, max, min = 1) {
  if (typeof value !== 'string' || value.length > max || value.trim().length < min) {
    throw new AppError(`${label}需要 ${min}–${max} 个字符。`);
  }
  return value.trim();
}
