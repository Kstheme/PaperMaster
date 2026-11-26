import { AppError } from './errors.js';

export function readFirstReading(library) {
  return library.get('settings', 'firstReading')?.skipped === true;
}

export function saveFirstReading(library, input) {
  if (input?.skipped !== true) throw new AppError('请确认跳过首次阅读引导。');
  library.put('settings', { id: 'firstReading', skipped: true });
  return { skipped: true };
}
